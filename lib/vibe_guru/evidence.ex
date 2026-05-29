defmodule VibeGuru.Evidence do
  @moduledoc """
  A single raw, interpretation-free *fact* produced by a probe.

  Evidence is deliberately dumb. It carries numbers and context, never opinion:
  no severity, no "this is a leak", no fix suggestion. That separation is the core
  of the architecture — an `Analyzer` turns many `Evidence` into `Finding`s, and
  because evidence is just data it can be cached and re-analyzed for free (re-running
  analysis never re-runs the expensive probe).

  One run of the `memory.client` probe typically emits:

    * many `:sample` evidences  — one per cycle (heap, DOM nodes, listeners, documents)
    * `:sample` for the baseline and cooldown phases (distinguished by `:phase`)
    * one `:snapshot`           — heap-snapshot diff (detached DOM node counts)
    * one `:profile`            — allocation sampling (hotspot stacks → source files)
    * `:config` / `:marker`     — run metadata (cycles, target url, GC points)
  """

  @type kind :: :sample | :snapshot | :profile | :config | :marker
  @type phase :: :baseline | :cycle | :cooldown | nil

  @type t :: %__MODULE__{
          id: String.t(),
          probe_id: atom(),
          kind: kind(),
          phase: phase(),
          cycle: non_neg_integer() | nil,
          timestamp: integer() | nil,
          context: map(),
          data: map()
        }

  @enforce_keys [:id, :probe_id, :kind]
  defstruct id: nil,
            probe_id: nil,
            kind: nil,
            phase: nil,
            cycle: nil,
            timestamp: nil,
            context: %{},
            data: %{}

  @doc """
  Build an Evidence, auto-assigning a stable id when one is not supplied.

  The id is derived from probe + kind + (phase/cycle) so repeated runs produce
  stable, referenceable ids that `Finding.evidence_refs` can point at.
  """
  @spec new(atom(), kind(), keyword()) :: t()
  def new(probe_id, kind, opts \\ []) do
    phase = Keyword.get(opts, :phase)
    cycle = Keyword.get(opts, :cycle)

    id =
      Keyword.get_lazy(opts, :id, fn ->
        suffix =
          [phase, cycle]
          |> Enum.reject(&is_nil/1)
          |> Enum.map_join("_", &to_string/1)

        ["ev", to_string(probe_id), to_string(kind), suffix]
        |> Enum.reject(&(&1 == ""))
        |> Enum.join("_")
      end)

    %__MODULE__{
      id: id,
      probe_id: probe_id,
      kind: kind,
      phase: phase,
      cycle: cycle,
      timestamp: Keyword.get(opts, :timestamp),
      context: Keyword.get(opts, :context, %{}),
      data: Keyword.get(opts, :data, %{})
    }
  end

  @doc "Plain-map form for JSON reporters."
  @spec to_map(t()) :: map()
  def to_map(%__MODULE__{} = e) do
    %{
      id: e.id,
      probe_id: e.probe_id,
      kind: e.kind,
      phase: e.phase,
      cycle: e.cycle,
      timestamp: e.timestamp,
      context: e.context,
      data: e.data
    }
  end
end
