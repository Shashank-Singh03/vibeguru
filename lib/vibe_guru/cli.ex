defmodule VibeGuru.CLI do
  @moduledoc """
  Command-line entry point.

      vibeguru memory:client <url> [options]

  Options:
      --cycles N        interaction cycles to run (default 20; ~8 is plenty for a quick check)
      --settle MS       settle time per navigation in ms (default 500)
      --routes N        max routes to auto-crawl (default 8)
      --flow FILE       replay a recorded Playwright flow instead of auto-crawl
      --root DIR        project root for stack detection (default: cwd)
      --out DIR         where to write reports (default: cwd)
      --timeout MS      overall driver timeout (default 600000)
      --no-headless     show the browser window
      --quiet           suppress progress logs
  """

  alias VibeGuru.Pipeline

  @switches [
    cycles: :integer,
    settle: :integer,
    routes: :integer,
    flow: :string,
    root: :string,
    out: :string,
    timeout: :integer,
    headless: :boolean,
    quiet: :boolean
  ]

  def main(argv) do
    {opts, args, _invalid} = OptionParser.parse(argv, switches: @switches)

    case args do
      ["memory:client", url | _] -> run_memory_client(url, opts)
      _ -> usage()
    end
  end

  defp run_memory_client(url, opts) do
    quiet = Keyword.get(opts, :quiet, false)
    out_dir = Keyword.get(opts, :out, File.cwd!())

    info("Vibe Guru · memory.client → #{url}")

    pipeline_opts = [
      root: Keyword.get(opts, :root),
      cycles: Keyword.get(opts, :cycles, 20),
      settle_ms: Keyword.get(opts, :settle, 500),
      routes_limit: Keyword.get(opts, :routes, 8),
      headless: Keyword.get(opts, :headless, true),
      flow: Keyword.get(opts, :flow),
      timeout_ms: Keyword.get(opts, :timeout, 600_000),
      out_dir: out_dir,
      on_log: log_fn(quiet)
    ]

    case Pipeline.memory_client(url, pipeline_opts) do
      {:ok, result} ->
        print_summary(result, out_dir)
        if Enum.any?(result.findings, &(&1.severity in [:critical, :high])), do: System.halt(1)

      {:error, reason} ->
        IO.puts(:stderr, "\n✗ Run failed: #{inspect(reason)}")
        explain_error(reason)
        System.halt(2)
    end
  end

  defp print_summary(%{findings: findings, profile: profile}, out_dir) do
    IO.puts("\n" <> String.duplicate("─", 60))
    IO.puts("Detected: #{profile.stack}/#{profile.bundler || "?"} · router #{profile.router || "?"} · chart libs #{inspect(profile.chart_libs)}")

    if findings == [] do
      IO.puts("\n✓ No memory issues found. All routes returned to baseline after GC.")
    else
      counts = Enum.frequencies_by(findings, & &1.severity)
      IO.puts("\nFound #{length(findings)} issue(s): #{format_counts(counts)}\n")

      Enum.each(findings, fn f ->
        IO.puts("  [#{f.severity}] #{f.title}")
        IO.puts("      route #{Map.get(f.location, :route)} · #{f.signature} · #{f.confidence} confidence")
      end)
    end

    IO.puts("\nReports written to #{out_dir}:")
    IO.puts("  • CLAUDE.md                (hand this to your coding agent)")
    IO.puts("  • vibeguru-report.md       (human-readable)")
    IO.puts("  • vibeguru-findings.json   (machine-readable)")
    IO.puts(String.duplicate("─", 60))
  end

  defp format_counts(counts) do
    [:critical, :high, :medium, :low, :info]
    |> Enum.map(fn s -> {s, Map.get(counts, s, 0)} end)
    |> Enum.reject(fn {_s, c} -> c == 0 end)
    |> Enum.map_join(", ", fn {s, c} -> "#{c} #{s}" end)
  end

  defp log_fn(true), do: fn _ -> :ok end

  defp log_fn(false) do
    fn %{"message" => msg} = obj ->
      phase = Map.get(obj, "phase", "")
      level = Map.get(obj, "level", "info")
      prefix = if level == "warn", do: "⚠ ", else: "  "
      IO.puts(:stderr, "#{prefix}[#{phase}] #{msg}")
    end
  end

  defp explain_error({:driver_not_found, path}),
    do: IO.puts(:stderr, "  The Node driver was not found at #{path}. Run `npm install` in driver-node/.")

  defp explain_error(:node_not_found),
    do: IO.puts(:stderr, "  Node.js was not found on PATH. Install Node 18+ and retry.")

  defp explain_error({:timeout, ms}),
    do: IO.puts(:stderr, "  The run exceeded #{ms}ms. Lower --cycles or raise --timeout.")

  defp explain_error(_), do: :ok

  defp info(msg), do: IO.puts(msg)

  defp usage do
    IO.puts(@moduledoc)
    System.halt(64)
  end
end
