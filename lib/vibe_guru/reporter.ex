defmodule VibeGuru.Reporter do
  @moduledoc """
  Behaviour for a **reporter** — the layer that renders `Finding`s to a sink.

  Reporters only ever consume findings; they never reach back into probes. Same
  `[Finding]`, many outputs:

    * `VibeGuru.Reporter.Json`     — `findings.json` for piping/programmatic use
    * `VibeGuru.Reporter.Markdown` — `report.md` + `CLAUDE.md` (agent-readable)
    * (later) MCP server, GitHub PR opener, Slack — the paid-tier connectors

  Keeping this a behaviour means new output formats — including client-specific ones —
  drop in without touching the rest of the pipeline.
  """

  @doc "Stable identifier, e.g. `:json`, `:markdown`."
  @callback id() :: atom()

  @doc """
  Render findings with a config map. Returns `{:ok, result}` where `result` is
  reporter-specific (a string, a written path, `:ok`, …).
  """
  @callback render([VibeGuru.Finding.t()], map()) :: {:ok, term()} | {:error, term()}
end
