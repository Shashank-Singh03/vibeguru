"use strict";

// render.js — turn a findings report into the text an agent reads.
//
// This file is where the product's central claim gets honoured or thrown away. The
// pitch is that an agent learns what broke for a fraction of what it costs to drive
// a browser itself and reason about screenshots, so the output has to stay dense:
// every line either tells the agent what is wrong, where, or what to do about it.
// Raw metric dumps and restated boilerplate are what turn a cheap answer into an
// expensive one.

// Enough of the analyzer's own wording to be actionable, cut before it turns into an
// essay. The full text is always available in the findings JSON.
const MAX_SUMMARY = 240;
const MAX_HINT = 260;
const MAX_FINDINGS = 30;

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"];

function truncate(text, limit) {
  if (!text) return "";
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

function severityTally(findings) {
  const counts = new Map();
  for (const f of findings) counts.set(f.severity, (counts.get(f.severity) || 0) + 1);

  return SEVERITY_ORDER.filter((s) => counts.has(s))
    .map((s) => `${counts.get(s)} ${s}`)
    .join(", ");
}

function describeTarget(report) {
  const p = report.profile;
  if (!p) return "";

  const stack = [p.stack, p.bundler].filter(Boolean).join("/");
  return [stack, p.url].filter(Boolean).join(" at ");
}

// Prefer a real source location over the analyzer's fallback phrasing. Runtime
// findings carry a frame (file:line:col) or the offending URL; memory findings can
// still only name the route, which is exactly what source-map support would fix.
function whereOf(finding) {
  const source = finding.metrics?.source;
  if (source && source !== "unknown") return source;

  const file = finding.fix?.files_to_check?.[0];
  if (file) return file;

  return finding.location?.route || "unknown";
}

function renderFinding(finding) {
  const route = finding.location?.route || "—";
  const lines = [
    `[${finding.severity}] ${finding.signature} · ${route} · ${finding.confidence} confidence`,
    `  ${truncate(finding.summary, MAX_SUMMARY)}`,
    `  where  ${whereOf(finding)}`,
  ];

  const fix = [finding.fix?.summary, finding.fix?.hint].filter(Boolean).join(". ");
  if (fix) lines.push(`  fix    ${truncate(fix, MAX_HINT)}`);

  return lines.join("\n");
}

/** "9 of 10 routes (90%)" — the denominator is the point. */
function describeCoverage(coverage) {
  const visited = (coverage.visited || []).length;
  const known = coverage.routes_known ?? visited;
  const pct = Math.round((coverage.ratio ?? 1) * 100);
  return `${visited} of ${known} routes reached (${pct}%)`;
}

/** Coverage lines for the report tail: what was missed, grouped by cause. */
function coverageGaps(coverage) {
  if (!coverage) return [];

  const lines = ["", `Coverage: ${describeCoverage(coverage)}.`];
  const byReason = new Map();

  for (const entry of coverage.unreachable || []) {
    const list = byReason.get(entry.reason) || [];
    list.push(entry.path);
    byReason.set(entry.reason, list);
  }

  // One actionable line per cause, biggest gap first, so the agent is not handed a
  // list of paths it has to classify itself.
  const explain = {
    auth_required: "need authentication",
    dynamic: "take a dynamic segment with no configured value",
    over_limit: "were beyond the route limit",
    redirected: "redirected elsewhere and never rendered",
    navigation_failed: "could not be navigated to",
  };

  for (const [reason, paths] of [...byReason.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const shown = paths.slice(0, 5).join(", ") + (paths.length > 5 ? ", …" : "");
    lines.push(`  ${paths.length} ${explain[reason] || reason}: ${shown}`);
  }

  return lines;
}

/**
 * Render a full report. `verdict` is the headline an agent can act on without
 * reading further: whether the change it just made is safe to call done.
 */
function renderReport(report, { cycles, wroteReport, outDir } = {}) {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const target = describeTarget(report);

  const coverage = report.coverage || null;

  if (findings.length === 0) {
    // A pass is only a pass if the run actually saw the app. An agent told "PASS"
    // after three of nineteen routes were reached will report work as verified that
    // was never looked at — so the verdict itself changes, not just a footnote.
    if (coverage && coverage.low) {
      return [
        `INCONCLUSIVE — no issues found, but only ${describeCoverage(coverage)}.`,
        "",
        "Nothing was wrong with what could be reached, which is not the same as the app",
        "being healthy. Treat this as unverified rather than passing.",
        ...coverageGaps(coverage),
      ].join("\n");
    }

    return [
      `PASS — no issues found${target ? ` in ${target}` : ""}.`,
      "",
      "Every route returned memory to baseline after forced GC, and none threw, logged an",
      "error, or failed a request while it was exercised.",
      ...coverageGaps(coverage),
    ].join("\n");
  }

  const shown = findings.slice(0, MAX_FINDINGS);
  const head = [
    `FAIL — ${findings.length} finding${findings.length === 1 ? "" : "s"} (${severityTally(findings)})${
      target ? ` in ${target}` : ""
    }.`,
    cycles ? `Measured over ${cycles} mount/unmount cycles per route.` : "",
    "",
  ].filter((l) => l !== "");

  const body = shown.map(renderFinding).join("\n\n");

  const tail = [""];
  if (findings.length > shown.length) {
    tail.push(`…and ${findings.length - shown.length} more, ordered by severity.`);
  }
  tail.push("Fix the most severe first, then call verify_runtime again to confirm they are gone.");
  tail.push(...coverageGaps(coverage));
  if (wroteReport && outDir) {
    tail.push(`Full report written to ${outDir} (CLAUDE.md, vibeguru-report.md, vibeguru-findings.json).`);
  }

  return [...head, body, ...tail].join("\n");
}

/** Filter a report's findings in place-ish, returning a new report object. */
function filterFindings(report, { severity, route } = {}) {
  let findings = Array.isArray(report.findings) ? report.findings : [];

  if (severity) {
    const floor = SEVERITY_ORDER.indexOf(severity);
    if (floor !== -1) {
      findings = findings.filter((f) => SEVERITY_ORDER.indexOf(f.severity) <= floor);
    }
  }

  if (route) {
    findings = findings.filter((f) => f.location?.route === route);
  }

  return { ...report, findings };
}

module.exports = { renderReport, renderFinding, filterFindings, SEVERITY_ORDER };
