defmodule VibeGuru.Pipeline do
  @moduledoc """
  Wires the four layers for a single vector run: Detector → Probe → Analyzer →
  Reporters. Returns the profile, raw evidence and findings so callers (CLI today,
  LiveView dashboard later) can render however they like.
  """

  alias VibeGuru.{Coverage, Detector, Finding}
  alias VibeGuru.Probes.Memory.Client, as: MemoryProbe
  alias VibeGuru.Analyzers.Memory, as: MemoryAnalyzer
  alias VibeGuru.Analyzers.Runtime, as: RuntimeAnalyzer
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
        storage_state: Keyword.get(opts, :storage_state),
        route_params: Keyword.get(opts, :route_params, %{}),
        on_log: Keyword.get(opts, :on_log, fn _ -> :ok end)
      }

    # One probe run feeds every analyzer: the browser session is the expensive part,
    # and Evidence is interpretation-free, so additional analyzers are free to add.
    with {:ok, evidence} <- MemoryProbe.run(profile, config),
         {:ok, findings} <- analyze_all([MemoryAnalyzer, RuntimeAnalyzer], evidence, config) do
      out_dir = Keyword.get(opts, :out_dir, File.cwd!())
      # Ensure the output directory exists so reporters don't silently fail with :enoent.
      File.mkdir_p!(out_dir)

      coverage = Coverage.from_evidence(evidence)

      report_config = %{
        out_dir: out_dir,
        profile: profile,
        evidence: evidence,
        coverage: coverage,
        vector: "memory.client"
      }

      reporters = Keyword.get(opts, :reporters, [Reporter.Json, Reporter.Markdown])
      outputs = Enum.map(reporters, fn r -> {r.id(), r.render(findings, report_config)} end)

      {:ok,
       %{
         profile: profile,
         evidence: evidence,
         coverage: coverage,
         findings: findings,
         outputs: outputs
       }}
    end
  end

  # Run every analyzer over the same evidence, concatenating their findings. A
  # single analyzer failing aborts the run rather than silently reporting a
  # partial picture — a "clean" result the user cannot trust is worse than an error.
  #
  # The combined list is re-sorted here, not at the call site. Each analyzer sorts
  # its own findings, but concatenating two sorted lists does not give a sorted one —
  # and every consumer downstream (both reporters, the CLI summary, the MCP server)
  # states or assumes "most severe first". Sorting once, here, is what makes that true
  # for all of them rather than for whichever one remembered to do it.
  defp analyze_all(analyzers, evidence, config) do
    analyzers
    |> Enum.reduce_while({:ok, []}, fn analyzer, {:ok, acc} ->
      case analyzer.analyze(evidence, config) do
        {:ok, findings} -> {:cont, {:ok, acc ++ findings}}
        {:error, reason} -> {:halt, {:error, {analyzer.id(), reason}}}
      end
    end)
    |> case do
      {:ok, findings} -> {:ok, Finding.sort(findings)}
      {:error, reason} -> {:error, reason}
    end
  end
end
