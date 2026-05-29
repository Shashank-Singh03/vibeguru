defmodule VibeGuru.Analyzer do
  @moduledoc """
  Behaviour for an **analyzer** — the layer that turns `Evidence` into `Finding`s.

  This is where all interpretation lives, and it is **deterministic**: thresholds,
  ratios, regex, statistical heuristics — never an LLM. One analyzer can consume
  evidence from several probes, and the same evidence can be re-analyzed cheaply
  (e.g. a custom client analyzer re-scoring without re-running the load test).

  The `memory` analyzer computes a recovery ratio and recognises a fixed catalogue of
  named signatures (detached_dom_leak, listener_leak, …), each mapping to one Finding.
  """

  @doc "Stable identifier, e.g. `:memory`."
  @callback id() :: atom()

  @doc """
  Analyze a batch of evidence with a config map, returning findings (or an error).
  Returning `{:ok, []}` is the healthy, no-issues result — not an error.
  """
  @callback analyze([VibeGuru.Evidence.t()], map()) ::
              {:ok, [VibeGuru.Finding.t()]} | {:error, term()}
end
