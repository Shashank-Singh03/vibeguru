defmodule Vibecheck.Probe do
  @moduledoc """
  Behaviour for a **probe** — the layer that *gathers evidence*. A probe observes the
  target (drives a browser, hammers HTTP, reads a config) and returns raw
  `Vibecheck.Evidence`. It must not interpret: no severity, no findings.

  Adding a new vector's data-collection = implementing these four callbacks. This is
  the primary extension point (incl. paid-tier custom probes), which is why probes are
  decoupled from analyzers and reporters — a custom probe drops in without a fork.

  Probe types, by how they gather evidence:

    * **black-box** — HTTP only; universal.
    * **gray-box**  — reads the local filesystem (configs, logs, repo).
    * **white-box** — needs cooperation from the target (an in-app lib / a driven browser).

  `memory.client` is a white-box-ish probe: it drives a real headless browser via CDP.
  """

  @doc "Stable identifier, e.g. `:\"memory.client\"`."
  @callback id() :: atom()

  @doc "Whether this probe is relevant to the detected stack."
  @callback applies_to?(Vibecheck.StackProfile.t()) :: boolean()

  @doc """
  Rough cost, so the UI/CLI can warn before running expensive probes.

    * `:cheap`     — seconds, no load
    * `:medium`    — tens of seconds
    * `:expensive` — minutes / sustained interaction or load
  """
  @callback cost() :: :cheap | :medium | :expensive

  @doc """
  Run the probe against a detected stack with a config map, returning gathered
  evidence (or an error). Implementations should be crash-isolated by the caller.
  """
  @callback run(Vibecheck.StackProfile.t(), map()) ::
              {:ok, [Vibecheck.Evidence.t()]} | {:error, term()}
end
