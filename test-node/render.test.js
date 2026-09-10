"use strict";

// What the agent actually reads. These tests exist because the rendering IS the
// product surface for MCP: the analysis can be perfect and still be useless if the
// text that comes back is vague, bloated, or drops the fix.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const { renderReport, renderFinding, filterFindings } = require("../mcp/render");

const report = require("./fixtures/findings.json");
const [loop, consoleErr, slow] = report.findings;

// The prose blocks are hard-wrapped, so assert against a flattened copy.
const flat = (s) => s.replace(/\s+/g, " ");

test("a clean run reports PASS and says what was actually checked", () => {
  const out = renderReport({ ...report, findings: [] });

  assert.match(out, /^PASS/);
  assert.match(out, /react\/vite at http:\/\/localhost:5173/);
  // The all-clear has to name the guarantee, or it reads as "we didn't look".
  assert.match(flat(out), /returned memory to baseline/);
  assert.match(flat(out), /threw, logged an error, or failed a request/);
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

test("the whole report stays small enough to be worth calling", () => {
  // The pitch is a verdict for ~1-2k tokens rather than ~114k of browser driving.
  // ~4 chars/token, so a 3-finding report has no business exceeding a few thousand.
  const out = renderReport(report, { cycles: 4 });
  assert.ok(out.length < 2600, `report was ${out.length} chars; the token claim is the product`);
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

test("a malformed report degrades to PASS rather than throwing", () => {
  // A truncated or half-written findings file must not take the server down.
  assert.doesNotThrow(() => renderReport({}));
  assert.doesNotThrow(() => renderReport({ findings: null }));
});
