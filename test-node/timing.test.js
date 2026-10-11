"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("timing distributions reject unknown durations and use nearest-rank p95", async () => {
  const { distribution } = await import("../scripts/lib/timing.mjs");
  assert.deepEqual(distribution([null, undefined, "3", NaN, Infinity, -1]), { samples: 0, median_ms: null, p95_ms: null, min_ms: null, max_ms: null });
  assert.deepEqual(distribution([30, 10, 20, 40, null]), { samples: 4, median_ms: 25, p95_ms: 40, min_ms: 10, max_ms: 40 });
  assert.equal(distribution(Array.from({ length: 20 }, (_, i) => i + 1)).p95_ms, 19);
});

test("timing retains failures, separates parent commands and excludes interrupted samples", async () => {
  const { timingAnalytics } = await import("../scripts/lib/timing.mjs");
  const record = (id, suite, status, duration_ms, rest = {}) => ({ id, suite, status, duration_ms, started_at: "2026-10-11T00:00:00Z", finished_at: "2026-10-11T00:01:00Z", ...rest });
  const data = timingAnalytics([
    record("all", "Full repository check", "PASS", 100), record("node", "Node tests", "PASS", 80),
    record("node", "Node tests", "PASS", 80), record("bad", "Node tests", "FAIL", 20),
    record("running", "Node tests", "RUNNING", 400), record("missing", "Node tests", "PASS", null),
    record("unfinished", "Node tests", "PASS", 900, { finished_at: null })
  ], [
    { app: "a", variant: "normal", cycles: 4, verdict: "PASS", scope_complete: true, duration_ms: 40 },
    { app: "a", variant: "normal", cycles: 4, verdict: "FAIL", scope_complete: true, duration_ms: 60 },
    { app: "a", variant: "normal", cycles: 12, verdict: "PASS", scope_complete: true, duration_ms: 140 },
    { app: "a", variant: "normal", cycles: 4, verdict: "INCONCLUSIVE", duration_ms: 500 },
    { app: "a", variant: "normal", cycles: 4, verdict: "FAIL", scope_complete: false, duration_ms: 900 }
  ]);
  assert.equal(data.suite_groups[0].median_ms, 100, "parent wall time is not summed with child time");
  const node = data.suite_groups.find(group => group.suite === "Node tests");
  assert.equal(node.samples, 2); assert.equal(node.median_ms, 50); assert.equal(node.failed, 1);
  assert.equal(data.unmeasured_suites, 3);
  assert.equal(data.browser_groups.length, 2); assert.equal(data.browser_groups[0].median_ms, 50);
  assert.equal(data.incomplete_browser_cases, 2);
});

test("focused and unspecified Elixir samples never join the explicit repository suite", async () => {
  const { timingAnalytics } = await import("../scripts/lib/timing.mjs");
  const record = { suite: "Elixir tests", status: "PASS", started_at: "2026-10-11T00:00:00Z", finished_at: "2026-10-11T00:01:00Z" };
  const data = timingAnalytics([
    { ...record, id: "full", tests: 200, scope: "repository", duration_ms: 5000 },
    { ...record, id: "old", tests: 200, duration_ms: 4000 },
    { ...record, id: "focused", tests: 13, duration_ms: 400 }
  ], []);
  assert.equal(data.suite_groups.find(group => group.suite === "Elixir tests").median_ms, 5000);
  assert.equal(data.suite_groups.length, 3);
  assert.ok(data.suite_groups.some(group => group.suite.includes("13 tests") && group.median_ms === 400));
});
