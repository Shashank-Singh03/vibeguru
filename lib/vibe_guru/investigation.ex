defmodule VibeGuru.Investigation do
  @moduledoc """
  Experimental, bounded investigation of individual findings. Survey observations may
  support hypotheses, but flat or unavailable counts do not eliminate possible causes.
  Findings on the same route remain independent. Results preserve the decision trail,
  observations and unresolved hypotheses; a hypothesis is not a verified cause or fix.
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

    {selected, deferred} =
      findings
      |> Finding.sort()
      |> Enum.split(Keyword.get(opts, :max_symptoms, @default_symptoms))

    investigated =
      Enum.reduce(
        selected,
        %{causes: [], unresolved: [], budget: budget, explained: MapSet.new()},
        fn
          finding, acc -> investigate(finding, context, acc)
        end
      )

    Enum.reduce(deferred, investigated, fn finding, acc ->
      state = initial_state(finding, context, acc.budget)
      %{acc | unresolved: acc.unresolved ++ [record(finding, state, [], reason: :symptom_limit)]}
    end)
    |> finish()
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

  # Co-located findings are context, not evidence of a shared cause.
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
    started = System.monotonic_time(:millisecond)
    outcome = context.run_probe.(probe_id, focus)
    elapsed = System.monotonic_time(:millisecond) - started

    case outcome do
      {:ok, result} ->
        reported = Map.get(result, :cost_ms, 0)
        cost = if is_number(reported) and reported >= 0, do: max(elapsed, reported), else: elapsed

        updates =
          if get_in(result, [:measurement_validity, :status]) in [:partial, :unavailable],
            do: %{},
            else: Map.get(result, :updates, %{})

        State.record(state, probe_id, Map.put(result, :cost_ms, cost), updates)

      {:error, reason} ->
        State.record(
          state,
          probe_id,
          %{cost_ms: elapsed, summary: "probe failed: #{inspect(reason)}", error: reason},
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
        probes_run: State.attempted(state),
        hypotheses: state.hypotheses,
        history: state.history
      },
      Map.new(extra)
    )
  end

  defp finish(acc), do: Map.take(acc, [:causes, :unresolved, :budget])

  defp finding_key(%Finding{} = f), do: f.id

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
      {probe, found, read}, acc -> seed_step(acc, probe, read.(found), found)
    end)
  end

  # A probe whose evidence exists is recorded even when it changed nothing: it ran, it
  # answered, and asking for it again would buy the same answer twice.
  defp seed_step(state, probe, updates, evidence) do
    hypotheses = Enum.map(state.hypotheses, &apply_seed(&1, updates))

    step = %{
      probe: probe,
      source: :survey,
      cost_ms: 0,
      result:
        if(map_size(updates) == 0,
          do: "observations do not settle a hypothesis",
          else: summarize(updates)
        ),
      observations: Enum.map(evidence, &Evidence.to_map/1),
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

  # Counts are aggregate observations, not retaining paths. Small positive growth and
  # missing values must not be turned into evidence that no DOM objects are retained.
  defp dom_reading(samples) do
    numbers = Enum.map(samples, &Map.get(&1.data, "nodes"))

    if length(numbers) >= 2 and Enum.all?(numbers, &numeric?/1) and
         Enum.all?(samples, &(&1.data["gcOk"] == true)) and increasing?(numbers) do
      %{
        retained_dom_subtree:
          {:supported,
           "DOM node counts increased between sampled visits; retaining paths are unverified"}
      }
    else
      %{}
    end
  end

  # Valid growing counts support an investigation lead. They do not establish the
  # owning component or rule out subscriptions invisible to the global census.
  defp census_reading(censuses) do
    growing =
      censuses
      |> census_growth()
      |> Enum.filter(fn {_class, delta} -> delta > 0 end)

    case growing do
      [] ->
        %{}

      classes ->
        names = classes |> Enum.map(fn {class, _} -> class end) |> Enum.sort() |> Enum.join(", ")

        %{
          unreleased_subscription:
            {:supported,
             "live #{names} counts increased between sampled visits; ownership and cleanup are unverified"}
        }
    end
  end

  defp census_growth(censuses) do
    censuses
    |> Enum.flat_map(fn ev ->
      case Map.get(ev.data, "counts") do
        counts when is_map(counts) -> Map.keys(counts)
        _ -> []
      end
    end)
    |> Enum.uniq()
    |> Enum.map(fn class ->
      counts =
        Enum.map(censuses, fn ev ->
          case Map.get(ev.data, "counts") do
            counts when is_map(counts) -> Map.get(counts, class)
            _ -> nil
          end
        end)

      valid = length(counts) >= 2 and Enum.all?(counts, &(is_integer(&1) and &1 >= 0))

      {class,
       if(valid and increasing?(counts), do: List.last(counts) - List.first(counts), else: 0)}
    end)
  end

  defp numeric?(value), do: is_number(value) and value >= 0

  defp increasing?(values),
    do: values |> Enum.chunk_every(2, 1, :discard) |> Enum.all?(fn [a, b] -> b > a end)

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
