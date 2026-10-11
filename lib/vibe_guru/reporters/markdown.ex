defmodule VibeGuru.Reporter.Markdown do
  @moduledoc """
  Writes two markdown artifacts from the same findings:

    * `vibeguru-report.md` — human-readable summary (table + per-finding detail)
    * `CLAUDE.md` — agent-readable: a task list of `ai_prompt` blocks a coding agent
      (Claude Code / Cursor) can act on directly. This is the product's core output.
  """

  @behaviour VibeGuru.Reporter

  alias VibeGuru.{Coverage, StackProfile, Result}

  @impl true
  def id, do: :markdown

  @impl true
  def render(findings, config) do
    out_dir = Map.fetch!(config, :out_dir)
    profile = config[:profile]
    vector = Map.get(config, :vector, "memory.client")

    coverage = Map.get(config, :coverage)

    assessment =
      Map.get_lazy(config, :assessment, fn ->
        Result.assess(findings, config[:evidence] || [], coverage, %{})
      end)

    report_path = Path.join(out_dir, "vibeguru-report.md")
    claude_path = Path.join(out_dir, "CLAUDE.md")

    with :ok <-
           File.write(report_path, human_report(findings, profile, vector, coverage, assessment)),
         :ok <-
           File.write(
             claude_path,
             result_block(assessment) <> claude_md(findings, vector, coverage)
           ) do
      {:ok, %{report: report_path, claude: claude_path}}
    end
  end

  # --- human report -------------------------------------------------------

  defp human_report(findings, profile, vector, coverage, assessment) do
    """
    # Vibe Guru Report — #{vector}

    Generated: #{now()}
    #{profile_line(profile)}

    ## Summary

    #{result_block(assessment)}
    #{summary_table(findings)}
    #{coverage_block(coverage)}

    ## Findings

    #{if findings == [], do: "No findings detected within the measured scope.", else: Enum.map_join(findings, "\n", &finding_section/1)}

    ## Interpretation and reproduction

    Findings are heuristic interpretations of the retained evidence in `vibeguru-findings.json`.
    Route coverage checks navigation, not business correctness. Source frames are clues;
    asynchronous events may originate in an earlier view. Reproduce the finding using the
    reported URL, routes, cycles and settle time, apply a reviewed fix, then repeat under
    the same conditions. Business outcomes are evaluated only where an explicit
    journey assertion was supplied; other outcomes still require verification.
    """
  end

  defp summary_table([]),
    do:
      "No findings crossed the configured thresholds. Check validity and coverage before relying on this result."

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
    - **Evidence references:** #{Enum.join(f.evidence_refs, ", ")}
    """
  end

  # --- CLAUDE.md (agent-readable) -----------------------------------------

  defp claude_md(findings, vector, coverage),
    do: claude_body(findings, vector) <> coverage_block(coverage)

  defp claude_body([], _vector) do
    """
    # Vibe Guru

    No findings crossed the configured thresholds. Read the verdict, validity and coverage
    above before reporting this scoped verification as complete.
    """
  end

  defp claude_body(findings, _vector) do
    """
    # Vibe Guru findings

    Vibe Guru ran the configured routes or supplied journey in a real browser and
    recorded what happened within that scope —
    what the app retained after forced garbage collection, what it logged, what it
    threw, and what it requested.

    Each finding interprets measured evidence; suspected causes require reproduction
    and human triage. Work through them top to bottom; they are
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

  defp result_block(assessment) do
    reasons = Enum.map_join(assessment.validity_reasons, "\n", &"- `#{&1}`")

    "**#{assessment.verdict}** — #{Result.message(assessment.verdict)}\n\n" <>
      if(reasons == "", do: "", else: "### Measurement limits\n\n#{reasons}\n\n") <>
      "Run conditions: `#{Jason.encode!(assessment.run)}`\n\n"
  end

  # Stated in the agent-facing file too: an agent that treats a low-coverage pass
  # as "done" will report work as verified that was never looked at.
  defp coverage_block(nil), do: ""

  defp coverage_block(coverage) do
    gaps =
      case Coverage.gaps(coverage) do
        [] -> ""
        list -> "\n" <> Enum.map_join(list, "\n", &"- #{&1}")
      end

    header = if Coverage.low?(coverage), do: "## Coverage (low)", else: "## Coverage"

    "\n#{header}\n\n#{Coverage.summary(coverage)}#{gaps}\n"
  end

  defp profile_line(%StackProfile{} = p) do
    libs = if p.chart_libs == [], do: "none", else: Enum.join(p.chart_libs, ", ")

    "Target: #{p.url} · stack: #{p.stack} · bundler: #{p.bundler || "—"} · router: #{p.router || "—"} · chart libs: #{libs} · source maps: #{p.source_maps}"
  end

  defp profile_line(_), do: ""

  defp format_metrics(metrics) when map_size(metrics) == 0, do: "—"

  defp format_metrics(metrics) do
    metrics
    |> Enum.map_join(", ", fn {k, v} ->
      value = if is_list(v) or is_map(v), do: Jason.encode!(v), else: to_string(v)
      "#{k}=#{value}"
    end)
  end

  defp now, do: DateTime.utc_now() |> DateTime.to_iso8601()
end
