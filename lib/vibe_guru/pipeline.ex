defmodule VibeGuru.Pipeline do
  @moduledoc """
  Wires the four layers for a single vector run: Detector → Probe → Analyzer →
  Reporters. Returns the profile, raw evidence and findings so callers (CLI today,
  LiveView dashboard later) can render however they like.
  """

  alias VibeGuru.{Detector, Finding}
  alias VibeGuru.Probes.Memory.Client, as: MemoryProbe
  alias VibeGuru.Analyzers.Memory, as: MemoryAnalyzer
  alias VibeGuru.Reporter

  @doc """
  Run the `memory.client` vector against `url`.

  Options: `:root`, `:cycles`, `:settle_ms`, `:routes_limit`, `:headless`, `:flow`,
  `:out_dir`, `:on_log`, `:reporters` (list of reporter modules), `:timeout_ms`.
  """
  @spec memory_client(String.t(), keyword()) ::
          {:ok, map()} | {:error, term()}
  def memory_client(url, opts \\ []) do
    profile = Detector.detect(url, opts)

    config =
      %{
        profile: profile,
        cycles: Keyword.get(opts, :cycles, 20),
        settle_ms: Keyword.get(opts, :settle_ms, 500),
        routes_limit: Keyword.get(opts, :routes_limit, 8),
        headless: Keyword.get(opts, :headless, true),
        flow: Keyword.get(opts, :flow),
        mode: if(Keyword.get(opts, :flow), do: "flow", else: "auto"),
        timeout_ms: Keyword.get(opts, :timeout_ms, 600_000),
        on_log: Keyword.get(opts, :on_log, fn _ -> :ok end)
      }

    with {:ok, evidence} <- MemoryProbe.run(profile, config),
         {:ok, findings} <- MemoryAnalyzer.analyze(evidence, config) do
      out_dir = Keyword.get(opts, :out_dir, File.cwd!())
      # Ensure the output directory exists so reporters don't silently fail with :enoent.
      File.mkdir_p!(out_dir)

      report_config = %{
        out_dir: out_dir,
        profile: profile,
        evidence: evidence,
        vector: "memory.client"
      }

      reporters = Keyword.get(opts, :reporters, [Reporter.Json, Reporter.Markdown])
      outputs = Enum.map(reporters, fn r -> {r.id(), r.render(findings, report_config)} end)

      {:ok,
       %{
         profile: profile,
         evidence: evidence,
         findings: Finding.sort(findings),
         outputs: outputs
       }}
    end
  end
end
