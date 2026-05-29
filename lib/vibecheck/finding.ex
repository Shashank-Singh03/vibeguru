defmodule Vibecheck.Finding do
  @moduledoc """
  An interpreted *conclusion* produced by an `Analyzer` from one or more `Evidence`.

  A Finding is the opinionated half of the pipeline: it has a severity, a confidence,
  a human title, and — critically for Vibecheck — an `:ai_prompt`: a pre-templated,
  agent-ready instruction block written so a coding agent (Claude/Cursor) can act on
  it directly. The `:ai_prompt` is generated deterministically from the signature and
  the measured numbers; **no LLM is involved at generation time** (zero API cost).

  We never claim the exact buggy line. We name the *signature*, the *numbers*, and the
  most likely *file/component* (via source maps), then hand it to the user's agent.
  """

  @type severity :: :critical | :high | :medium | :low | :info
  @type confidence :: :high | :medium | :low

  @type t :: %__MODULE__{
          id: String.t(),
          vector: atom(),
          signature: atom(),
          severity: severity(),
          confidence: confidence(),
          title: String.t(),
          summary: String.t(),
          evidence_refs: [String.t()],
          metrics: map(),
          location: map(),
          fix: map(),
          ai_prompt: String.t() | nil
        }

  @enforce_keys [:id, :vector, :signature, :severity, :title]
  defstruct id: nil,
            vector: nil,
            signature: nil,
            severity: nil,
            confidence: :medium,
            title: nil,
            summary: "",
            evidence_refs: [],
            metrics: %{},
            location: %{},
            fix: %{},
            ai_prompt: nil

  @severity_rank %{critical: 0, high: 1, medium: 2, low: 3, info: 4}

  @doc "Sort findings most-severe first (stable within a severity)."
  @spec sort([t()]) :: [t()]
  def sort(findings) do
    Enum.sort_by(findings, &Map.fetch!(@severity_rank, &1.severity))
  end

  @doc "Plain-map form for JSON reporters."
  @spec to_map(t()) :: map()
  def to_map(%__MODULE__{} = f) do
    %{
      id: f.id,
      vector: f.vector,
      signature: f.signature,
      severity: f.severity,
      confidence: f.confidence,
      title: f.title,
      summary: f.summary,
      evidence_refs: f.evidence_refs,
      metrics: f.metrics,
      location: f.location,
      fix: f.fix,
      ai_prompt: f.ai_prompt
    }
  end
end
