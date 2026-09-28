defmodule VibeGuru.Investigation do
  @moduledoc """
  Drives one symptom at a time from "something is wrong here" to "this is why".

  The survey pass reports facts with no explanation — `/charts` retains 178.8KB per
  visit, leaks 5 listeners per visit, and holds 2 MutationObservers per visit. Three
  findings, almost certainly one bug. This loop is what turns them into one cause with
  one fix.

  ## The loop spends nothing it does not have to

  Its first move on every symptom is to read the evidence the survey **already
  gathered**. A census ran during pass 0, so for `/charts` the loop can eliminate
  "retained DOM subtree" and support "unreleased subscription" before it costs a single
  millisecond. Many investigations resolve there, having run no probe at all.

  Only when the free evidence runs out does it ask the policy for something new.

  ## Budget is per run, not per symptom

  A symptom that resolves cheaply leaves more for the next one. When the run budget is
  gone the remaining symptoms are abandoned with a reason rather than silently dropped —
  an investigation that stopped early is a different thing from one that found nothing,
  and the report has to be able to say which.

  ## Causes absorb their siblings

  When a cause explains several findings, those findings are not investigated again. That
  is the difference between one answer and three restatements of the same question.
  """

  alias VibeGuru.{Evidence, Finding}
  alias VibeGuru.Investigation.State
  alias VibeGuru.Investigation.Policy.Rules

  @default_budget %{ms_left: 120_000, probes_left: 8, depth: 0, max_depth: 3}
  @default_symptoms 5

  @type outcome :: %{
          causes: [map()],
          unresolved: [map()],
          budget: map()
        }

  @doc """
  Investigate the findings from a survey pass.

  Options:

    * `:facts`        — detector output, so the policy never guesses at what is known
    * `:probes`       — catalog of what can be run, with cost and what each discriminates
    * `:policy`       — defaults to `Policy.Rules`
    * `:run_probe`    — `fn probe_id, focus -> {:ok, result} | {:error, reason} end`.
                        Without one, the loop still works off already-gathered evidence
                        and abandons anything that would need a new measurement.
    * `:budget`, `:max_symptoms`
  """
  @spec run([Finding.t()], [Evidence.t()], keyword()) :: outcome()
  def run(findings, evidence, opts \\ []) do
    policy = Keyword.get(opts, :policy, Rules)
    budget = Keyword.get(opts, :budget, @default_budget)

    context = %{
      facts: Keyword.get(opts, :facts, %{}),
      probes: Keyword.get(opts, :probes, []),
      policy: policy,
      run_probe: Keyword.get(opts, :run_probe, &no_runner/2),
      evidence: evidence,
      findings: findings
    }

    findings
    |> symptoms(Keyword.get(opts, :max_symptoms, @default_symptoms))
    |> Enum.reduce(%{causes: [], unresolved: [], budget: budget, explained: MapSet.new()}, fn
      finding, acc -> investigate(finding, context, acc)
    end)
    |> finish()
  end

  # Worst first, because a budget that runs out should cost you the least important
  # answers rather than an arbitrary slice.
  defp symptoms(findings, limit) do
    findings
    |> Finding.sort()
    |> Enum.take(limit)
  end

  defp investigate(finding, context, acc) do
    key = finding_key(finding)

    # A cause already accounted for this finding. Investigating it again would produce
    # the same answer with a different title.
    if MapSet.member?(acc.explained, key) do
      acc
    else
      finding
      |> initial_state(context, acc.budget)
      |> seed(context.evidence)
      |> step(context, [])
      |> absorb(finding, acc)
    end
  end

  defp initial_state(finding, context, budget) do
    State.new(finding,
      siblings: siblings(finding, context.findings),
      facts: context.facts,
      probes: context.probes,
      budget: budget
    )
  end

  # Other findings on the same route. A cause that explains all of them is the outcome
  # worth having, and it cannot be claimed without knowing what else is there.
  defp siblings(finding, findings) do
    route = Map.get(finding.location, :route)

    Enum.filter(findings, fn other ->
      other.id != finding.id and Map.get(other.location, :route) == route
    end)
  end

  # --- the loop -----------------------------------------------------------

  defp step(state, context, decisions) do
    decision = context.policy.next_step(state)
    trail = decisions ++ [decision]

    case decision do
      {:conclude, cause} ->
        {:resolved, cause, state, trail}

      {:abandon, reason} ->
        {:unresolved, reason, state, trail}

      {:probe, probe_id, focus} ->
        state
        |> execute(probe_id, focus, context)
        |> step(context, trail)
    end
  end

  # Recording happens whether the probe succeeded or not. A failed probe still consumed
  # an attempt, and without recording it the loop would ask for the same probe forever.
  defp execute(state, probe_id, focus, context) do
    case context.run_probe.(probe_id, focus) do
      {:ok, result} ->
        State.record(state, probe_id, result, Map.get(result, :updates, %{}))

      {:error, reason} ->
        State.record(
          state,
          probe_id,
          %{cost_ms: 0, summary: "probe failed: #{inspect(reason)}"},
          %{}
        )
    end
  end

  defp no_runner(_probe_id, _focus), do: {:error, :no_probe_runner}

  # --- results ------------------------------------------------------------

  defp absorb({:resolved, cause, state, trail}, finding, acc) do
    explained = Enum.reduce(cause.explains, acc.explained, &MapSet.put(&2, &1))

    %{
      acc
      | causes: acc.causes ++ [record(finding, state, trail, cause: cause)],
        budget: state.budget,
        explained: MapSet.put(explained, finding_key(finding))
    }
  end

  defp absorb({:unresolved, reason, state, trail}, finding, acc) do
    %{
      acc
      | unresolved: acc.unresolved ++ [record(finding, state, trail, reason: reason)],
        budget: state.budget
    }
  end

  # The decision trail travels with the result. A path a model chose has to be auditable
  # after the fact, and a path rules chose has to be replayable.
  defp record(finding, state, trail, extra) do
    Map.merge(
      %{
        symptom: state.symptom,
        finding_id: finding.id,
        decisions: trail,
        probes_run: State.attempted(state)
      },
      Map.new(extra)
    )
  end

  defp finish(acc), do: Map.take(acc, [:causes, :unresolved, :budget])

  defp finding_key(%Finding{} = f),
    do: "#{f.signature}@#{Map.get(f.location, :route, "/")}"

  # --- free evidence ------------------------------------------------------

  @doc """
  Update hypotheses from evidence the survey already collected.

  This is the step that makes most investigations free, and it does two jobs. It applies
  what the existing evidence shows, and it records **which probes the survey already
  ran** — because a probe whose evidence is already in hand must not be asked for again.
  Getting that wrong means paying a second time for an answer you have.
  """
  @spec seed(State.t(), [Evidence.t()]) :: State.t()
  def seed(%State{} = state, evidence) do
    route = state.symptom.route

    [
      {"memory.client", samples(evidence, route), &dom_reading/1},
      {"census.client", censuses(evidence, route), &census_reading/1}
    ]
    |> Enum.reduce(state, fn
      {_probe, [], _read}, acc -> acc
      {probe, found, read}, acc -> seed_step(acc, probe, read.(found))
    end)
  end

  # A probe whose evidence exists is recorded even when it changed nothing: it ran, it
  # answered, and asking for it again would buy the same answer twice.
  defp seed_step(state, probe, updates) do
    hypotheses = Enum.map(state.hypotheses, &apply_seed(&1, updates))

    step = %{
      probe: probe,
      cost_ms: 0,
      result: summarize(updates),
      changed: hypotheses != state.hypotheses
    }

    %{state | hypotheses: hypotheses, history: state.history ++ [step]}
  end

  defp apply_seed(hypothesis, updates) do
    case Map.get(updates, hypothesis.id) do
      nil -> hypothesis
      {status, because} -> %{hypothesis | status: status, because: because}
    end
  end

  # Node counts flat across cycles means nothing detached is being held, whatever else is
  # wrong. Eliminating a candidate for free is worth as much as supporting one.
  defp dom_reading(samples) do
    deltas =
      samples
      |> Enum.map(&Map.get(&1.data, "nodes"))
      |> Enum.filter(&is_number/1)
      |> Enum.chunk_every(2, 1, :discard)
      |> Enum.map(fn [a, b] -> b - a end)

    cond do
      deltas == [] ->
        %{}

      Enum.all?(deltas, &(&1 < 100)) ->
        %{retained_dom_subtree: {:eliminated, "node count flat across cycles"}}

      true ->
        %{}
    end
  end

  # A class whose live count climbs every visit is a subscription nobody released — and
  # a census that found nothing growing is evidence against one, not an absence of
  # evidence.
  defp census_reading(censuses) do
    growing =
      censuses
      |> census_growth()
      |> Enum.filter(fn {_class, delta} -> delta > 0 end)

    case growing do
      [] ->
        %{unreleased_subscription: {:eliminated, "no live instance counts grew"}}

      classes ->
        names = classes |> Enum.map(fn {class, _} -> class end) |> Enum.sort() |> Enum.join(", ")
        %{unreleased_subscription: {:supported, "live #{names} count grows every visit"}}
    end
  end

  defp census_growth(censuses) do
    censuses
    |> Enum.flat_map(fn ev -> ev.data |> Map.get("counts", %{}) |> Enum.to_list() end)
    |> Enum.group_by(fn {class, _} -> class end, fn {_, count} -> count end)
    |> Enum.map(fn {class, counts} ->
      numbers = Enum.filter(counts, &is_number/1)
      {class, if(length(numbers) < 2, do: 0, else: List.last(numbers) - List.first(numbers))}
    end)
  end

  defp samples(evidence, route),
    do:
      Enum.filter(
        evidence,
        &(&1.kind == :sample and &1.phase == :cycle and route_of(&1) == route)
      )

  defp censuses(evidence, route),
    do: Enum.filter(evidence, &(&1.kind == :census and route_of(&1) == route))

  defp route_of(%{context: context}), do: Map.get(context || %{}, "route", "/")

  defp summarize(updates) do
    updates
    |> Enum.map(fn {id, {status, because}} -> "#{id}: #{status} (#{because})" end)
    |> Enum.join("; ")
  end
end
