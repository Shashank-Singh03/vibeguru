"use strict";

// What the agent actually reads. These tests exist because the rendering IS the
// product surface for MCP: the analysis can be perfect and still be useless if the
// text that comes back is vague, bloated, or drops the fix.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { renderReport, renderFinding, filterFindings } = require("../mcp/render");
const { validReport } = require("./helpers/valid-report");

const report = validReport({ cycles: 4, routes: ["/", "/render-loop", "/log-error"], findings: require("./fixtures/findings.json").findings });
const [loop, consoleErr, slow] = report.findings;

// The prose blocks are hard-wrapped, so assert against a flattened copy.
const flat = (s) => s.replace(/\s+/g, " ");

test("a clean run reports PASS and says what was actually checked", () => {
  const out = renderReport({ ...report, verdict: "PASS", findings: [] });

  assert.match(out, /^PASS/);
  assert.match(out, /react\/vite at http:\/\/localhost:5173/);
  // The all-clear has to name the guarantee, or it reads as "we didn't look".
  assert.match(flat(out), /No blocking issues detected within the tested scope/);
  assert.match(flat(out), /does not establish business correctness/);
});

test("a failing run leads with the verdict and the severity tally", () => {
  const out = renderReport(report, { cycles: 4 });

  assert.match(out, /^FAIL — 3 findings \(1 critical, 1 high, 1 medium\)/);
  assert.match(out, /react\/vite at http:\/\/localhost:5173/);
  assert.match(out, /4 mount\/unmount cycles/);
});

test("a single finding is not pluralised", () => {
  const out = renderReport({ ...report, findings: [loop] });
  assert.match(out, /1 finding \(/);
});

test("each finding carries signature, route, confidence, cause and fix", () => {
  const out = renderFinding(loop);

  assert.match(out, /\[critical\] render_loop · \/render-loop · high confidence/);
  assert.match(out, /23967 times\/second/);
  assert.match(out, /fix\s+Break the state-update cycle/);
});

test("a real source location beats the route-shaped fallback", () => {
  // Runtime findings know the file; that is strictly more useful than "/log-error".
  assert.match(renderFinding(consoleErr), /where\s+http:\/\/localhost:5173\/src\/pages\/LogError\.jsx:21:12/);

  // Memory findings still only know the route — and must say so rather than invent one.
  assert.match(renderFinding(slow), /where\s+\//);
});

test("long prose is truncated so one finding cannot flood the context", () => {
  const wordy = {
    ...loop,
    summary: "x".repeat(2000),
    fix: { summary: "y".repeat(1000), hint: "z".repeat(1000), files_to_check: [] },
  };
  const out = renderFinding(wordy);

  assert.ok(out.length < 900, `expected a bounded finding, got ${out.length} chars`);
  assert.match(out, /…/);
});

test("the whole report stays bounded for an agent to read", () => {
  // Detailed measurements stay in the evidence file; the text should be actionable.
  const out = renderReport(report, { cycles: 4 });
  assert.ok(out.length < 2600, `report was ${out.length} chars`);
});

test("output tells the agent what to do next", () => {
  const out = renderReport(report, { cycles: 4 });
  assert.match(out, /call verify_runtime again/);
});

test("a written report is pointed at, not pasted", () => {
  const dir = path.join("some", "project");
  const out = renderReport(report, { cycles: 4, wroteReport: true, outDir: dir });

  assert.ok(out.includes(dir));
  assert.match(out, /CLAUDE\.md/);
});

test("more findings than the cap are counted, not silently dropped", () => {
  const many = { ...report, findings: Array.from({ length: 42 }, () => loop) };
  const out = renderReport(many);

  assert.match(out, /FAIL — 42 findings/);
  assert.match(out, /…and 12 more, ordered by severity\./);
});

test("severity filtering is a floor, not an exact match", () => {
  const high = filterFindings(report, { severity: "high" });
  assert.deepEqual(
    high.findings.map((f) => f.signature),
    ["render_loop", "console_error"],
    "critical must be included when asking for high or worse"
  );

  const critical = filterFindings(report, { severity: "critical" });
  assert.equal(critical.findings.length, 1);
});

test("route filtering narrows to one view", () => {
  const only = filterFindings(report, { route: "/log-error" });

  assert.equal(only.findings.length, 1);
  assert.equal(only.findings[0].signature, "console_error");
});

test("filtering leaves the original report untouched", () => {
  filterFindings(report, { severity: "critical" });
  assert.equal(report.findings.length, 3, "filtering must not mutate the cached run");
});

test("a malformed report reports ERROR without throwing", () => {
  // A truncated or half-written findings file must not take the server down.
  assert.match(renderReport({}), /^ERROR/);
  assert.match(renderReport({ findings: null }), /^ERROR/);
});

// --- coverage -------------------------------------------------------------

const lowCoverageReport = validReport({ routes: ["/"], unreachable: [
    { path: "/admin", reason: "auth_required" },
    { path: "/billing", reason: "auth_required" },
    { path: "/users/[id]", reason: "dynamic" },
  ] });
const lowCoverage = lowCoverageReport.coverage;

test("a clean run with low coverage is INCONCLUSIVE, not PASS", () => {
  // The whole point: an agent told PASS after seeing a fraction of the app will
  // report work as verified that was never looked at.
  const out = renderReport(lowCoverageReport);

  assert.match(out, /^INCONCLUSIVE/);
  assert.doesNotMatch(out, /^PASS/m);
  assert.match(flat(out), /not the same as the app being healthy/);
});

test("a clean run with full coverage still passes", () => {
  const out = renderReport(validReport({ routes: ["/", "/a"] }));
  assert.match(out, /^PASS/);
});

test("a run with missing coverage is inconclusive", () => {
  // Missing scope cannot establish a clean verdict.
  const out = renderReport({ ...report, verdict: "PASS", findings: [], coverage: null });
  assert.match(out, /^INCONCLUSIVE/);
});

test("coverage gaps are grouped by cause, biggest first", () => {
  const out = renderReport(lowCoverageReport);

  assert.match(out, /Coverage: 1 of 4 routes reached \(25%\)/);
  const auth = out.indexOf("2 need authentication");
  const dyn = out.indexOf("1 take a dynamic segment");
  assert.ok(auth !== -1 && dyn !== -1, "both causes should be listed");
  assert.ok(auth < dyn, "the larger gap should be reported first");
});

test("coverage is reported alongside findings too", () => {
  const out = renderReport({ ...report, coverage: null }, { cycles: 4 });
  assert.doesNotMatch(out, /Coverage:/, "no coverage data means no coverage line");

  const withCov = renderReport({ ...report, coverage: lowCoverage }, { cycles: 4 });
  assert.match(withCov, /Coverage: 1 of 4 routes reached/);
  assert.match(withCov, /^FAIL/);
});
