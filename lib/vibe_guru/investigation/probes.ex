defmodule VibeGuru.Investigation.Probes do
  @moduledoc """
  What the loop can actually run, and the catalog it offers the policy.

  Two halves, kept together because they have to agree: the catalog describes what each
  probe costs and which hypotheses it can settle, and the runner executes one. A catalog
  entry for a probe that cannot run would have the policy confidently choose something
  that then fails — so `available/0` lists only what is implemented, and the rest is
  documented as planned rather than offered.
  """

  alias VibeGuru.Probes.Heap.Snapshot

  # `discriminates` is the field that matters: a probe worth running is one that can
  # change a hypothesis still in play, whatever it costs. `cost` only breaks ties among
  # probes that are all informative, and it means what a probe does to the run — a heap
  # snapshot pauses the world — rather than how long it takes.
  @catalog [
    %{
      id: "census.client",
      cost: :cheap,
      typical_ms: 120,
      discriminates: [:retained_global_instance, :unreleased_subscription],
      note: "runs during the survey; sees only classes on global scope",
      available: true
    },
    %{
      id: "heap.snapshot",
      cost: :medium,
      typical_ms: 3000,
      discriminates: [:retained_library_object, :unbounded_cache],
      note: "sees module-scoped classes the census cannot reach",
      available: true
    },
    %{
      id: "allocation.sample",
      cost: :medium,
      typical_ms: 4000,
      discriminates: [:unbounded_cache, :retained_library_object],
      note: "planned — would yield file:line for the allocating stack",
      available: false
    },
    %{
      id: "listener.census",
      cost: :cheap,
      typical_ms: 200,
      discriminates: [:unreleased_subscription],
      note: "planned — listeners grouped by target and type",
      available: false
    }
  ]

  @doc "Probes the loop can actually run, in the shape the policy expects."
  @spec available() :: [map()]
  def available do
    @catalog
    |> Enum.filter(& &1.available)
    |> Enum.map(&Map.drop(&1, [:available]))
  end

  @doc "Every probe, implemented or not, for documentation and tests."
  @spec catalog() :: [map()]
  def catalog, do: @catalog

  @doc """
  Build the `:run_probe` function the investigation loop calls.

  Anything not implemented returns an error rather than raising: the loop records a
  failed probe and moves on, which is how an investigation degrades to "could not
  determine" instead of taking down a run that already has findings.
  """
  @spec runner(VibeGuru.StackProfile.t(), keyword()) ::
          (String.t(), map() -> {:ok, map()} | {:error, term()})
  def runner(profile, opts \\ []) do
    fn probe_id, focus -> run(probe_id, profile, focus, opts) end
  end

  defp run("heap.snapshot", profile, focus, opts), do: Snapshot.investigate(profile, focus, opts)

  # census.client has no focused mode: it runs during the survey, and the loop reads that
  # evidence for free rather than paying to repeat it.
  defp run("census.client", _profile, _focus, _opts),
    do: {:error, {:survey_only, "census.client evidence is gathered during the survey pass"}}

  defp run(probe_id, _profile, _focus, _opts), do: {:error, {:not_implemented, probe_id}}
end
