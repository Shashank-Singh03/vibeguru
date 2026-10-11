defmodule VibeGuru.Pipeline do
  @moduledoc """
  Wires the four layers for a single vector run: Detector → Probe → Analyzer →
  Reporters. Returns the profile, raw evidence and findings so callers (CLI today,
  standalone HTML reports and other customer tooling) can render however they like.
  """

  alias VibeGuru.{CensusTargets, Coverage, Detector, Finding, Result}
  alias VibeGuru.Probes.Memory.Client, as: MemoryProbe
  alias VibeGuru.Analyzers.Memory, as: MemoryAnalyzer
  alias VibeGuru.Analyzers.Runtime, as: RuntimeAnalyzer
  alias VibeGuru.Analyzers.Census, as: CensusAnalyzer
  alias VibeGuru.Analyzers.Journey, as: JourneyAnalyzer
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
        route_expectations: Keyword.get(opts, :route_expectations, %{}),
        thresholds: Keyword.get(opts, :thresholds, %{}),
        driver_path: Keyword.get(opts, :driver_path),
        census_targets:
          CensusTargets.for_profile(profile, Keyword.get(opts, :census_targets, [])),
        on_log: Keyword.get(opts, :on_log, fn _ -> :ok end)
      }

    # One probe run feeds every analyzer: the browser session is the expensive part,
    # and Evidence is interpretation-free, so additional analyzers are free to add.
    with {:ok, evidence} <- MemoryProbe.run(profile, config),
         {:ok, findings} <-
           analyze_all(
             [MemoryAnalyzer, RuntimeAnalyzer, CensusAnalyzer, JourneyAnalyzer],
             evidence,
             config
           ) do
      out_dir = Keyword.get(opts, :out_dir, File.cwd!())
      coverage = Coverage.from_evidence(evidence)
      findings = Result.attach_evidence(findings, evidence)
      assessment = Result.assess(findings, evidence, coverage, config)

      report_config = %{
        out_dir: out_dir,
        profile: profile,
        evidence: evidence,
        coverage: coverage,
        vector: "memory.client",
        assessment: assessment
      }

      reporters = Keyword.get(opts, :reporters, [Reporter.Json, Reporter.Markdown, Reporter.Html])

      with {:ok, outputs} <- write_reports(reporters, findings, report_config) do
        {:ok,
         Map.merge(assessment, %{
           profile: profile,
           evidence: evidence,
           coverage: coverage,
           findings: findings,
           outputs: outputs
         })}
      else
        {:error, reason} -> {:error, {:report_write_failed, reason}}
      end
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
      input =
        if analyzer in [MemoryAnalyzer, CensusAnalyzer] and not Result.retention_valid?(evidence),
          do: [],
          else: evidence

      case analyzer.analyze(input, config) do
        {:ok, findings} -> {:cont, {:ok, acc ++ findings}}
        {:error, reason} -> {:halt, {:error, {analyzer.id(), reason}}}
      end
    end)
    |> case do
      {:ok, findings} -> {:ok, Finding.sort(findings)}
      {:error, reason} -> {:error, reason}
    end
  end

  defp render_all(reporters, findings, config) do
    Enum.reduce_while(reporters, {:ok, []}, fn reporter, {:ok, outputs} ->
      rendered =
        try do
          reporter.render(findings, config)
        rescue
          error -> {:error, {:reporter_exception, Exception.message(error)}}
        end

      case rendered do
        {:ok, paths} -> {:cont, {:ok, outputs ++ [{reporter.id(), {:ok, paths}}]}}
        {:error, reason} -> {:halt, {:error, {reporter.id(), reason}}}
      end
    end)
  end

  # Render the complete set before touching any previously delivered reports.
  # Publish JSON last so persisted consumers never read a newly incomplete set.
  defp write_reports(reporters, findings, config) do
    out_dir = Path.expand(config.out_dir)
    run_id = Base.url_encode64(:crypto.strong_rand_bytes(12), padding: false)
    stage = Path.join(out_dir, ".vibeguru-report-#{run_id}")

    with :ok <- File.mkdir_p(out_dir), :ok <- File.mkdir(stage) do
      try do
        with {:ok, outputs} <- render_all(reporters, findings, %{config | out_dir: stage}),
             :ok <- publish_reports(stage, out_dir) do
          {:ok, relocate_paths(outputs, stage, config.out_dir)}
        end
      after
        if Path.dirname(Path.expand(stage)) == out_dir and
             String.starts_with?(Path.basename(stage), ".vibeguru-report-") do
          File.rm_rf(stage)
        end
      end
    end
  end

  defp publish_reports(stage, out_dir) do
    backup = Path.join(stage, "previous")

    with {:ok, files} <- File.ls(stage),
         :ok <- File.mkdir(backup),
         :ok <- backup_reports(files, out_dir, backup) do
      files = Enum.sort_by(files, &(&1 == "vibeguru-findings.json"))

      Enum.reduce_while(files, {:ok, []}, fn name, {:ok, written} ->
        case File.cp(Path.join(stage, name), Path.join(out_dir, name)) do
          :ok ->
            {:cont, {:ok, [name | written]}}

          {:error, reason} ->
            # Include the failed copy: a filesystem error may have truncated it.
            rollback = rollback_reports([name | written], out_dir, backup)
            {:halt, {:error, {:report_publish_failed, name, reason, rollback}}}
        end
      end)
      |> case do
        {:ok, _} -> :ok
        error -> error
      end
    end
  end

  defp backup_reports(files, out_dir, backup) do
    Enum.reduce_while(files, :ok, fn name, :ok ->
      path = Path.join(out_dir, name)

      result =
        case File.stat(path) do
          {:ok, %{type: :regular}} -> File.cp(path, Path.join(backup, name))
          {:ok, _} -> {:error, {:invalid_report_destination, name}}
          {:error, :enoent} -> :ok
          error -> error
        end

      if result == :ok, do: {:cont, :ok}, else: {:halt, result}
    end)
  end

  defp rollback_reports(files, out_dir, backup) do
    Enum.reduce(files, [], fn name, failures ->
      previous = Path.join(backup, name)

      result =
        if File.exists?(previous),
          do: File.cp(previous, Path.join(out_dir, name)),
          else: File.rm(Path.join(out_dir, name))

      if result in [:ok, {:error, :enoent}], do: failures, else: [{name, result} | failures]
    end)
  end

  defp relocate_paths(value, stage, out_dir) when is_binary(value),
    do: String.replace_prefix(value, stage, out_dir)

  defp relocate_paths(value, stage, out_dir) when is_map(value),
    do: Map.new(value, fn {k, v} -> {k, relocate_paths(v, stage, out_dir)} end)

  defp relocate_paths(value, stage, out_dir) when is_list(value),
    do: Enum.map(value, &relocate_paths(&1, stage, out_dir))

  defp relocate_paths(value, stage, out_dir) when is_tuple(value),
    do: value |> Tuple.to_list() |> relocate_paths(stage, out_dir) |> List.to_tuple()

  defp relocate_paths(value, _, _), do: value
end
