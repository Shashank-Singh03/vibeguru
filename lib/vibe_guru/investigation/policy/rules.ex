defmodule VibeGuru.Investigation.Policy.Rules do
  @moduledoc """
  The hand-written experimental policy: deterministic probe selection and explicitly
  qualified hypotheses. Constructor hints guide measurement; counts do not establish
  ownership, a source location, a specific fix, or a common cause for sibling findings.

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

  # A selected hypothesis is still unverified. Library presence informs measurement,
  # never ownership, source attribution or a specific cleanup change.
  @causes %{
    retained_library_object: %{
      what: "measurements support an object-retention hypothesis; ownership is unverified",
      fix: "trace retaining references before selecting a cleanup change"
    },
    retained_global_instance: %{
      what: "measurements support a retained-resource hypothesis; its lifetime is unverified",
      fix: "inspect resource ownership and expected lifetime before changing cleanup"
    },
    unreleased_subscription: %{
      what: "measurements support a subscription-retention hypothesis; the owner is unverified",
      fix: "trace listener or subscription ownership and verify a candidate cleanup change"
    },
    retained_dom_subtree: %{
      what:
        "measurements support a DOM-retention hypothesis; retaining references are unverified",
      fix: "inspect retaining paths and distinguish detached nodes from expected live state"
    },
    unbounded_cache: %{
      what: "measurements support a container-growth hypothesis; cache ownership is unverified",
      fix: "inspect container owners and expected cache bounds before changing behavior"
    },
    runaway_render: %{
      what: "measurements support excessive DOM activity; a render cycle is unverified",
      fix: "profile updates and inspect the state-update cycle before selecting a fix"
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
    last = List.last(history)
    last[:source] != :survey and not Map.get(last, :changed, false)
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
        what: "measurements support a retention hypothesis; ownership is unverified",
        fix: "collect retaining-path evidence before selecting a cleanup change"
      })

    %{
      id: id,
      what: template.what,
      where: state.symptom.route,
      location_kind: :observed_route,
      status: :hypothesis,
      verified: false,
      fix: template.fix,
      explains: explains(state),
      because: because
    }
  end

  # Co-location does not establish a shared cause. Keep other findings independent.
  defp explains(%State{} = state) do
    [state.symptom.finding_id]
  end
end
