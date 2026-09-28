defmodule VibeGuru.Investigation.Policy.Rules do
  @moduledoc """
  The hand-written policy: free, instant, and identical on every run.

  Worked example — `/charts`, which produces three findings today that are one bug:

      symptom   route_heap_growth @ /charts, 178.8KB per visit, 4 of 4 visits
      step 1    census.client   cheapest probe that can settle anything
                                → MutationObserver +2/visit; Chart not visible
                                  (module-scoped import, so the census cannot see it)
      step 2    heap.snapshot   the only probe that reaches module-scoped classes
                                → 4 retained Chart instances
      conclude  retained_library_object — chart.destroy() is never called,
                which explains the heap growth, the listener leak AND the
                retained MutationObservers

  Three findings, one cause, one fix. That collapse is the whole point of investigating
  rather than reporting.

  ## The algorithm

  Stop conditions first, then pick the cheapest probe that can still change something:

    1. one hypothesis supported and the rest eliminated  → conclude
    2. budget or depth spent                             → abandon(:budget)
    3. the last probe changed nothing                    → abandon(:stalled)
    4. no untried probe discriminates anything live      → abandon(:exhausted)
    5. otherwise                                         → cheapest useful probe

  Rule 3 is the one usually left out. Without it the loop grinds through its whole budget
  learning nothing, which is the expensive failure rather than the obvious one.

  Ties break on typical duration and then on id, so the same state always yields the same
  decision. That determinism is not incidental — it is what lets a CI gate replay a path.
  """

  @behaviour VibeGuru.Investigation.Policy

  alias VibeGuru.Investigation.State

  @cost_order %{"cheap" => 0, "medium" => 1, "expensive" => 2, cheap: 0, medium: 1, expensive: 2}

  # What a settled hypothesis means in words a developer can act on. Library-specific
  # detail is filled in from `facts` where the detector knows enough to be specific.
  @causes %{
    retained_library_object: %{
      what: "a library object is retained on every visit",
      fix: "dispose it in the unmount path"
    },
    retained_global_instance: %{
      what: "a global resource is created on mount and never released",
      fix: "release it in the effect cleanup"
    },
    unreleased_subscription: %{
      what: "a subscription or listener outlives the component that created it",
      fix: "unsubscribe in the effect cleanup"
    },
    retained_dom_subtree: %{
      what: "DOM nodes are held after unmount",
      fix: "drop the references that keep the detached nodes alive"
    },
    unbounded_cache: %{
      what: "a module-scoped structure grows on every visit and is never cleared",
      fix: "bound the structure, or clear it when the view unmounts"
    },
    runaway_render: %{
      what: "the component re-renders continuously while mounted",
      fix: "break the state-update cycle in the effect"
    }
  }

  @impl true
  def id, do: :rules

  @impl true
  def next_step(%State{} = state) do
    cond do
      settled?(state) -> {:conclude, cause(state)}
      spent?(state) -> {:abandon, :budget}
      stalled?(state) -> {:abandon, :stalled}
      true -> choose(state)
    end
  end

  # --- stop conditions ----------------------------------------------------

  # Exactly one explanation left standing. Two supported hypotheses is not a conclusion,
  # it is a reason to keep probing.
  defp settled?(%State{} = state) do
    live = State.live(state)

    match?([%{status: :supported}], live)
  end

  defp spent?(%State{budget: budget}) do
    budget.ms_left <= 0 or budget.probes_left <= 0 or budget.depth >= budget.max_depth
  end

  defp stalled?(%State{history: []}), do: false

  defp stalled?(%State{history: history}) do
    not (history |> List.last() |> Map.get(:changed, false))
  end

  # --- choosing -----------------------------------------------------------

  defp choose(%State{} = state) do
    case candidates(state) do
      [] ->
        {:abandon, :exhausted}

      probes ->
        probe = best(probes)
        {:probe, probe.id, focus(state, probe)}
    end
  end

  # A probe is worth running only if it can change a hypothesis that is still live, and
  # only if it has not already been tried. Cost is irrelevant to a probe that cannot
  # inform the question.
  defp candidates(%State{} = state) do
    tried = State.attempted(state)
    live = state |> State.live() |> Enum.map(& &1.id) |> MapSet.new()

    Enum.filter(state.probes, fn probe ->
      probe.id not in tried and informative?(probe, live)
    end)
  end

  defp informative?(probe, live) do
    probe
    |> Map.get(:discriminates, [])
    |> Enum.any?(&MapSet.member?(live, &1))
  end

  # Cheapest first; ties broken by duration, then id, so the order is total and the same
  # state always produces the same decision.
  defp best(probes) do
    Enum.min_by(probes, fn probe ->
      {
        Map.get(@cost_order, Map.get(probe, :cost, :medium), 1),
        Map.get(probe, :typical_ms, 0),
        to_string(probe.id)
      }
    end)
  end

  # Point the probe at the route under investigation, and pass on anything a cheaper
  # probe already learned so an expensive one looks in the right place.
  defp focus(%State{} = state, probe) do
    base = %{route: state.symptom.route}

    case constructor_hint(state) do
      nil -> base
      hint -> if wants_hint?(probe), do: Map.put(base, :constructor_hint, hint), else: base
    end
  end

  defp wants_hint?(probe), do: :retained_library_object in Map.get(probe, :discriminates, [])

  # The detector already knows which libraries are present; if one of them is the likely
  # culprit, say so rather than making the snapshot probe scan blind.
  defp constructor_hint(%State{facts: facts}) do
    facts
    |> Map.get(:chart_libs, [])
    |> Enum.find_value(fn
      :chartjs -> "Chart"
      :three -> "WebGLRenderer"
      :echarts -> "ECharts"
      _ -> nil
    end)
  end

  # --- conclusion ---------------------------------------------------------

  defp cause(%State{} = state) do
    [%{id: id, because: because}] = State.live(state)

    template =
      Map.get(@causes, id, %{
        what: "an object is retained per visit",
        fix: "release it on unmount"
      })

    %{
      id: id,
      what: specific(id, state) || template.what,
      where: state.symptom.route,
      fix: specific_fix(id, state) || template.fix,
      explains: explains(state),
      because: because
    }
  end

  # Every finding on this route that this cause accounts for, including the symptom that
  # started the investigation. Reporting one cause instead of three findings is the
  # difference between a list someone triages and something they can act on.
  defp explains(%State{} = state) do
    [state.symptom | state.siblings]
    |> Enum.map(&"#{&1.signature}@#{&1.route}")
    |> Enum.uniq()
  end

  defp specific(:retained_library_object, state) do
    case constructor_hint(state) do
      nil -> nil
      class -> "a #{class} instance is created on every visit and never released"
    end
  end

  defp specific(_, _), do: nil

  defp specific_fix(:retained_library_object, state) do
    case constructor_hint(state) do
      "Chart" -> "call chart.destroy() in the effect cleanup"
      "WebGLRenderer" -> "call renderer.dispose() and lose the WebGL context in the cleanup"
      "ECharts" -> "call chart.dispose() in the effect cleanup"
      _ -> nil
    end
  end

  defp specific_fix(_, _), do: nil
end
