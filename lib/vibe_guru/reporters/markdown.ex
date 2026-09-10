defmodule VibeGuru.Reporter.Markdown do
  @moduledoc """
  Writes two markdown artifacts from the same findings:

    * `vibeguru-report.md` — human-readable summary (table + per-finding detail)
    * `CLAUDE.md` — agent-readable: a task list of `ai_prompt` blocks a coding agent
      (Claude Code / Cursor) can act on directly. This is the product's core output.
  """

  @behaviour VibeGuru.Reporter

  alias VibeGuru.StackProfile

  @impl true
  def id, do: :markdown

  @impl true
  def render(findings, config) do
    out_dir = Map.fetch!(config, :out_dir)
    profile = config[:profile]
    vector = Map.get(config, :vector, "memory.client")

    report_path = Path.join(out_dir, "vibeguru-report.md")
    claude_path = Path.join(out_dir, "CLAUDE.md")

    with :ok <- File.write(report_path, human_report(findings, profile, vector)),
         :ok <- File.write(claude_path, claude_md(findings, vector)) do
      {:ok, %{report: report_path, claude: claude_path}}
    end
  end

  # --- human report -------------------------------------------------------

  defp human_report(findings, profile, vector) do
    """
    # Vibe Guru Report — #{vector}

    Generated: #{now()}
    #{profile_line(profile)}

    ## Summary

    #{summary_table(findings)}

    ## Findings

    #{if findings == [], do: "No issues found. 🎉", else: Enum.map_join(findings, "\n", &finding_section/1)}
    """
  end

  defp summary_table([]),
    do:
      "**No issues found.** Every route returned memory to baseline after GC, and none " <>
        "threw, logged an error, or failed a request while it was exercised."

  defp summary_table(findings) do
    counts = Enum.frequencies_by(findings, & &1.severity)

    rows =
      [:critical, :high, :medium, :low, :info]
      |> Enum.map(fn s -> {s, Map.get(counts, s, 0)} end)
      |> Enum.reject(fn {_s, c} -> c == 0 end)
      |> Enum.map_join("\n", fn {s, c} -> "| #{s} | #{c} |" end)

    """
    | Severity | Count |
    |---|---|
    #{rows}

    **Total: #{length(findings)} finding(s).**
    """
  end

  defp finding_section(f) do
    """
    ### [#{f.severity}] #{f.title}

    - **Signature:** `#{f.signature}` · **Confidence:** #{f.confidence} · **Route:** `#{Map.get(f.location, :route, "—")}`
    - #{f.summary}
    - **Metrics:** #{format_metrics(f.metrics)}
    - **Fix:** #{f.fix[:summary]} — #{f.fix[:hint]}
    """
  end

  # --- CLAUDE.md (agent-readable) -----------------------------------------

  defp claude_md([], _vector) do
    """
    # Vibe Guru

    Vibe Guru exercised this app in a real browser and found **no issues**. No action needed.
    """
  end

  defp claude_md(findings, _vector) do
    """
    # Vibe Guru findings

    Vibe Guru ran this app in a real browser: it visited every route it could reach,
    mounted and unmounted each one repeatedly, and recorded what actually happened —
    what the app retained after forced garbage collection, what it logged, what it
    threw, and what it requested.

    Every issue below was **measured, not inferred**, and each carries its own
    evidence and its own next action. Work through them top to bottom; they are
    ordered most severe first. Re-run `vibeguru run` afterwards to confirm a fix.

    #{Enum.with_index(findings, 1) |> Enum.map_join("\n", fn {f, i} -> claude_item(f, i) end)}
    """
  end

  defp claude_item(f, i) do
    """
    ## #{i}. #{f.title}  _(#{f.severity}, #{f.signature})_

    ```
    #{f.ai_prompt}
    ```
    """
  end

  # --- helpers ------------------------------------------------------------

  defp profile_line(%StackProfile{} = p) do
    libs = if p.chart_libs == [], do: "none", else: Enum.join(p.chart_libs, ", ")

    "Target: #{p.url} · stack: #{p.stack} · bundler: #{p.bundler || "—"} · router: #{p.router || "—"} · chart libs: #{libs} · source maps: #{p.source_maps}"
  end

  defp profile_line(_), do: ""

  defp format_metrics(metrics) when map_size(metrics) == 0, do: "—"

  defp format_metrics(metrics) do
    metrics
    |> Enum.map_join(", ", fn {k, v} -> "#{k}=#{v}" end)
  end

  defp now, do: DateTime.utc_now() |> DateTime.to_iso8601()
end
