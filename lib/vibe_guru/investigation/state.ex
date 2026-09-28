defmodule VibeGuru.Investigation.State do
  @moduledoc """
  Everything a policy needs to decide what to measure next, and nothing else.

  One state describes one **symptom** under investigation — a single finding from the
  survey pass, plus whatever later probes have established about it. Keeping the unit
  that small is what makes each decision cheap to send, easy to audit, and safe to
  abandon: running out of budget costs you the tail of the list rather than the run.

  The two rules this shape follows from:

    * **The detector establishes what is true; the policy decides what to do about it.**
      `facts` exist so a policy never has to guess at something already known. If
      `module_scoped_imports` is true, a policy should not have to work out that
      `census.client` cannot see library classes here — the fact tells it.

    * **Summaries, never raw evidence.** A run emits 44+ samples. `symptom.measurement`
      is prose because the decision turns on magnitude and consistency, not on the delta
      chain. Sending the chain would cost more than the browser driving this exists to
      replace.

  See `docs/ARCHITECTURE-investigation.md` for the wire format and the reasoning.
  """

  alias VibeGuru.Finding

  @type status :: :open | :supported | :eliminated
  @type hypothesis :: %{id: atom(), status: status(), because: String.t() | nil}

  @type t :: %__MODULE__{
          symptom: map(),
          siblings: [map()],
          facts: map(),
          hypotheses: [hypothesis()],
          history: [map()],
          probes: [map()],
          budget: map()
        }

  @enforce_keys [:symptom]
  defstruct symptom: nil,
            # Other findings on the same target. A cause that explains three findings at
            # once is the difference between a report someone triages and one they act on,
            # and a policy cannot claim that without seeing the siblings.
            siblings: [],
            facts: %{},
            hypotheses: [],
            history: [],
            probes: [],
            budget: %{ms_left: 120_000, probes_left: 8, depth: 0, max_depth: 3}

  # Which explanations are live for a given signature. Deliberately a closed set: a
  # policy chooses from known causes rather than inventing one, which is what keeps the
  # output typed and the findings comparable across runs.
  @candidates %{
    route_heap_growth: [
      :retained_dom_subtree,
      :retained_library_object,
      :unbounded_cache,
      :unreleased_subscription
    ],
    detached_dom_leak: [:retained_dom_subtree, :unbounded_cache],
    listener_leak: [:unreleased_subscription, :retained_library_object],
    retained_instances: [:retained_global_instance, :unreleased_subscription],
    render_loop: [:runaway_render],
    slow_recovery: [:unbounded_cache, :retained_library_object]
  }

  @doc """
  Build the state for one symptom.

  Options: `:siblings`, `:facts`, `:probes`, `:budget`.
  """
  @spec new(Finding.t(), keyword()) :: t()
  def new(%Finding{} = finding, opts \\ []) do
    %__MODULE__{
      symptom: symptom(finding),
      siblings: opts |> Keyword.get(:siblings, []) |> Enum.map(&symptom/1),
      facts: Keyword.get(opts, :facts, %{}),
      hypotheses: candidates_for(finding.signature),
      probes: Keyword.get(opts, :probes, []),
      budget: Keyword.get(opts, :budget, %__MODULE__{symptom: nil}.budget)
    }
  end

  defp symptom(%Finding{} = f) do
    %{
      signature: f.signature,
      route: Map.get(f.location, :route, "/"),
      severity: f.severity,
      measurement: f.summary
    }
  end

  defp symptom(%{} = already_shaped), do: already_shaped

  defp candidates_for(signature) do
    @candidates
    |> Map.get(signature, [])
    |> Enum.map(&%{id: &1, status: :open, because: nil})
  end

  @doc "Hypotheses still worth spending a probe on."
  @spec live(t()) :: [hypothesis()]
  def live(%__MODULE__{hypotheses: hypotheses}),
    do: Enum.filter(hypotheses, &(&1.status != :eliminated))

  @doc "Hypotheses the evidence currently points at."
  @spec supported(t()) :: [hypothesis()]
  def supported(%__MODULE__{hypotheses: hypotheses}),
    do: Enum.filter(hypotheses, &(&1.status == :supported))

  @doc "Probe ids already run for this symptom — running one twice learns nothing."
  @spec attempted(t()) :: [String.t()]
  def attempted(%__MODULE__{history: history}), do: Enum.map(history, & &1.probe)

  @doc """
  Record a probe result and the hypothesis updates it produced.

  `updates` is a map of `hypothesis_id => {status, because}`. Whether anything actually
  moved is stored on the step, because a probe that changed nothing is how the loop
  detects it has stalled.
  """
  @spec record(t(), String.t(), map(), map()) :: t()
  def record(%__MODULE__{} = state, probe_id, result, updates \\ %{}) do
    hypotheses = Enum.map(state.hypotheses, &apply_update(&1, updates))

    step = %{
      probe: probe_id,
      cost_ms: Map.get(result, :cost_ms, 0),
      result: Map.get(result, :summary, ""),
      changed: hypotheses != state.hypotheses
    }

    %{
      state
      | hypotheses: hypotheses,
        history: state.history ++ [step],
        budget: spend(state.budget, step.cost_ms)
    }
  end

  defp apply_update(hypothesis, updates) do
    case Map.get(updates, hypothesis.id) do
      nil -> hypothesis
      {status, because} -> %{hypothesis | status: status, because: because}
      status when is_atom(status) -> %{hypothesis | status: status}
    end
  end

  defp spend(budget, cost_ms) do
    %{
      budget
      | ms_left: max(0, budget.ms_left - cost_ms),
        probes_left: max(0, budget.probes_left - 1),
        depth: budget.depth + 1
    }
  end

  @doc "Plain-map form, which is what a remote policy receives."
  @spec to_map(t()) :: map()
  def to_map(%__MODULE__{} = state) do
    %{
      symptom: state.symptom,
      siblings: state.siblings,
      facts: state.facts,
      hypotheses: state.hypotheses,
      history: state.history,
      probes: state.probes,
      budget: state.budget
    }
  end
end
