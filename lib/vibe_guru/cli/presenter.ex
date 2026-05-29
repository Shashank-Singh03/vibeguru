defmodule VibeGuru.CLI.Presenter do
  @moduledoc """
  All terminal output for the CLI lives here, so command modules stay focused on
  control flow and the wording/format is consistent in one place.
  """

  alias VibeGuru.{Config, Finding}

  @rule String.duplicate("─", 60)
  @severity_order [:critical, :high, :medium, :low, :info]

  @spec banner(String.t()) :: :ok
  def banner(url), do: IO.puts("Vibe Guru · memory.client → #{url}")

  @spec info(String.t()) :: :ok
  def info(msg), do: IO.puts(msg)

  @doc "Report what `init` detected and wrote."
  @spec init_done(VibeGuru.Project.t(), Config.t(), Path.t()) :: :ok
  def init_done(project, %Config{} = config, path) do
    IO.puts("\n#{@rule}")
    IO.puts("Detected #{project.framework}/#{project.bundler || "?"} app")
    IO.puts("  dev command : #{config.dev_command || "—  (start your app yourself)"}")
    IO.puts("  target URL  : #{config.url}")
    IO.puts("  wrote       : #{path}")
    IO.puts("\nNext step:  vibeguru run")
    IO.puts(@rule)
  end

  @doc "Print the findings summary and where the reports were written."
  @spec summary(map(), Path.t()) :: :ok
  def summary(%{findings: findings, profile: profile}, out_dir) do
    IO.puts("\n#{@rule}")

    IO.puts(
      "Detected: #{profile.stack}/#{profile.bundler || "?"} · router #{profile.router || "?"} · chart libs #{inspect(profile.chart_libs)}"
    )

    print_findings(findings)
    print_outputs(out_dir)
    IO.puts(@rule)
  end

  @doc "Build the progress-log callback passed to the pipeline. `quiet` silences it."
  @spec log_fn(boolean()) :: (map() -> :ok)
  def log_fn(true), do: fn _ -> :ok end

  def log_fn(false) do
    fn event ->
      phase = Map.get(event, "phase", "")
      prefix = if Map.get(event, "level") == "warn", do: "⚠ ", else: "  "
      IO.puts(:stderr, "#{prefix}[#{phase}] #{Map.get(event, "message", "")}")
    end
  end

  @doc "Print a friendly explanation for a failure reason and return a halt code."
  @spec error(term()) :: {:halt, non_neg_integer()}
  def error(reason) do
    IO.puts(:stderr, "\n✗ #{explain(reason)}")
    {:halt, 2}
  end

  @doc "No config found — tell the user to run init."
  @spec no_config(Path.t()) :: {:halt, non_neg_integer()}
  def no_config(root) do
    IO.puts(:stderr, "\n✗ No vibeguru.json found in #{root}.")
    IO.puts(:stderr, "  Run `vibeguru init` first (it detects your stack and writes the config).")
    {:halt, 2}
  end

  @doc "Print usage and return the conventional usage-error halt code."
  @spec usage() :: {:halt, non_neg_integer()}
  def usage do
    IO.puts("""
    Vibe Guru — frontend memory analysis for vibe coders

    Usage:
      vibeguru init [--root DIR] [--url URL] [--port N]
          Detect the app and write vibeguru.json.

      vibeguru run [--root DIR] [--out DIR] [--cycles N] [--flow FILE] [--no-headless] [--quiet]
          Start the app if needed, analyze it, and write CLAUDE.md + reports.

      vibeguru memory:client <url> [--cycles N] [--flow FILE] [--out DIR]
          Low-level: analyze an already-running URL (no config, no autostart).
    """)

    {:halt, 64}
  end

  # --- internals ----------------------------------------------------------

  defp print_findings([]) do
    IO.puts("\n✓ No memory issues found. All routes returned to baseline after GC.")
  end

  defp print_findings(findings) do
    IO.puts("\nFound #{length(findings)} issue(s): #{counts(findings)}\n")
    Enum.each(findings, &print_finding/1)
  end

  defp print_finding(%Finding{} = f) do
    IO.puts("  [#{f.severity}] #{f.title}")

    IO.puts(
      "      route #{Map.get(f.location, :route)} · #{f.signature} · #{f.confidence} confidence"
    )
  end

  defp print_outputs(out_dir) do
    IO.puts("\nReports written to #{out_dir}:")
    IO.puts("  • CLAUDE.md                (hand this to your coding agent)")
    IO.puts("  • vibeguru-report.md       (human-readable)")
    IO.puts("  • vibeguru-findings.json   (machine-readable)")
  end

  defp counts(findings) do
    tally = Enum.frequencies_by(findings, & &1.severity)

    @severity_order
    |> Enum.map(&{&1, Map.get(tally, &1, 0)})
    |> Enum.reject(fn {_severity, count} -> count == 0 end)
    |> Enum.map_join(", ", fn {severity, count} -> "#{count} #{severity}" end)
  end

  defp explain({:driver_not_found, path}),
    do: "Browser driver not found at #{path}. Run `npm install` in driver-node/."

  defp explain(:node_not_found), do: "Node.js was not found on PATH. Install Node 18+ and retry."

  defp explain(:no_target),
    do: "No reachable URL and no dev_command in vibeguru.json. Set one or start your app."

  defp explain({:dev_server, {:timeout, log}}),
    do: "Dev server did not become ready in time. See #{log}."

  defp explain({:dev_server, {:dev_server_exited, log}}),
    do: "Dev server exited on startup. See #{log}."

  defp explain({:timeout, ms}), do: "The run exceeded #{ms}ms. Lower --cycles or raise --timeout."

  defp explain({:config_write_failed, reason}),
    do: "Could not write vibeguru.json: #{inspect(reason)}."

  defp explain(other), do: "Run failed: #{inspect(other)}"
end
