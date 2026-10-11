"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { validReport } = require("./helpers/valid-report.js");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibeguru-dashboard-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("vibeguru-dashboard-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.mkdir(path.join(root, "dashboard"));
  await fs.mkdir(path.join(root, "reports/campaign-1700000000000-test"), { recursive: true });
  const write = async (file, value) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), typeof value === "string" ? value : JSON.stringify(value)); };
  await write("dashboard/vectors.json", [{ id: "response-order", stage: "implemented", name: "Response order" }, { id: "future", stage: "planned", name: "Future" }]);
  await write("dashboard/activity.json", []);
  await write("dashboard/index.html", "<!doctype html><title>Dashboard</title>");
  const folder = "reports/campaign-1700000000000-test";
  const reportPath = `${folder}/gateway-race-original-race-reordered/vibeguru-findings.json`;
  const report = validReport({ mode: "flow", findings: [{ signature: "journey_assertion_failed", vector: "journey.client",
    severity: "high", summary: "Newer response was overwritten", location: { route: "recorded flow" }, metrics: { assertion_id: "latest-refresh-wins" } }] });
  // Deliberately optimistic saved verdict: dashboard must independently reassess it.
  report.verdict = "PASS";
  await write(reportPath, report);
  await write(`${folder}/results.json`, [{ app: "gateway-race-original", variant: "race-reordered", report: path.join(root, reportPath), expectation: { met: true, mismatches: [] } }]);
  await write(`${folder}/summary.json`, { created_at: "2026-10-09T12:00:00Z", met_expectations: 1, declared_expectation_cases: 1 });
  return { root, write, folder, reportPath, report };
}

test("dashboard keeps app FAIL separate from a matched expected experiment and planned vectors", async t => {
  const { root } = await fixture(t);
  const { createCollector } = await import("../scripts/lib/dashboard-data.mjs");
  const collector = createCollector(root), data = await collector.snapshot();
  assert.equal(data.cases[0].verdict, "FAIL");
  assert.equal(data.cases[0].expectation.met, true);
  assert.equal(data.cases[0].source_kind, "existing-behavior");
  assert.equal(data.summary.fail, 1); assert.equal(data.summary.pass, 0);
  assert.equal(data.summary.expected_matched, 1);
  assert.equal(data.vectors.find(vector => vector.id === "future").case_count, 0);
  assert.equal(data.vectors.find(vector => vector.id === "future").latest_verdict, null);
  const detail = await collector.caseDetail(data.cases[0].id);
  assert.equal(detail.verdict, "FAIL");
  assert.ok(detail.artifact_paths.some(item => item.label === "Findings JSON"));
  assert.equal(await collector.caseDetail("unknown-case"), null);
});

test("dashboard discovery skips source/dependency copies and detects changed, corrupt or missing reports", async t => {
  const { root, write, folder, reportPath } = await fixture(t);
  const { createCollector } = await import("../scripts/lib/dashboard-data.mjs");
  await write("reports/copied-app/package.json", {});
  await write("reports/copied-app/nested/vibeguru-findings.json", validReport());
  const collector = createCollector(root), first = await collector.snapshot();
  assert.equal(first.cases.length, 1, "copied application trees are not scanned as test output");
  assert.equal((await collector.snapshot()).revision, first.revision, "time alone must not cause refresh loops");
  await write(reportPath, { schema_version: 2, findings: [null], evidence: { wrong: true } });
  const corrupt = await collector.snapshot();
  assert.notEqual(corrupt.revision, first.revision);
  assert.equal(corrupt.cases[0].verdict, "ERROR");
  await fs.unlink(path.join(root, reportPath));
  const missing = await collector.snapshot();
  assert.equal(missing.cases[0].verdict, "ERROR");
  assert.ok(missing.warnings.length);
  await write(`${folder}/results.json`, "{unfinished");
  assert.ok((await collector.snapshot()).warnings.some(warning => warning.includes("results.json")));
});

test("blocking findings do not hide incomplete scope in browser timing analytics", async t => {
  const { root, write, reportPath, report } = await fixture(t);
  const { createCollector } = await import("../scripts/lib/dashboard-data.mjs");
  const collector = createCollector(root);
  const complete = await collector.snapshot();
  assert.equal(complete.cases[0].verdict, "FAIL");
  assert.equal(complete.cases[0].scope_complete, true);
  assert.equal(complete.timing.browser_groups[0].samples, 1);
  report.validity_reasons = ["failed_interactions"];
  report.measurement_validity.scope = { status: "partial", reasons: ["failed_interactions"] };
  await write(reportPath, report);
  const partial = await collector.snapshot();
  assert.equal(partial.cases[0].verdict, "FAIL", "Blocking app finding remains visible");
  assert.equal(partial.cases[0].scope_complete, false);
  assert.equal(partial.timing.browser_groups.length, 0);
  assert.equal(partial.timing.incomplete_browser_cases, 1);
});

test("source changes during execution invalidate experiment success without hiding app failures", async t => {
  const { root, write, folder, reportPath, report } = await fixture(t);
  await write(reportPath, validReport({ mode: "flow" }));
  await write(`${folder}/results.json`, [{ app: "controlled-fixture", variant: "normal", source_kind: "control",
    report: path.join(root, reportPath), execution_identity_stable: false, expectation: { met: true, mismatches: [] } }]);
  const { createCollector } = await import("../scripts/lib/dashboard-data.mjs");
  const collector = createCollector(root), partial = await collector.snapshot();
  assert.equal(partial.cases[0].verdict, "INCONCLUSIVE");
  assert.equal(partial.cases[0].source_kind, "control");
  assert.equal(partial.cases[0].expectation.met, false);
  assert.equal(partial.summary.expected_matched, 0);
  assert.ok((await collector.caseDetail(partial.cases[0].id)).validity_reasons.includes("Execution source changed during case"));
  await write(reportPath, report);
  assert.equal((await collector.snapshot()).cases[0].verdict, "FAIL", "Observed application failure survives incomplete execution conditions");
});

test("artifact access stays inside report directories and rejects source files and traversal", async t => {
  const { root, write, reportPath } = await fixture(t);
  const { artifactPath } = await import("../scripts/lib/dashboard-data.mjs");
  await write("package.json", { private: true });
  await write("reports/.env", "SECRET=not-an-artifact");
  assert.equal(await artifactPath(root, reportPath), await fs.realpath(path.join(root, reportPath)));
  for (const name of ["package.json", "reports/../package.json", "reports/.env", "reports", "bad\0path"]) {
    await assert.rejects(artifactPath(root, name));
  }
});

test("dashboard HTTP API, event refresh and read-only boundary work end to end", async t => {
  const { root, write, reportPath } = await fixture(t);
  const { createDashboardServer } = await import("../scripts/dashboard.mjs");
  const app = await createDashboardServer({ root, port: 0, pollMs: 50 });
  t.after(() => app.close());
  const first = await (await fetch(`${app.url}/api/dashboard`)).json();
  const events = await fetch(`${app.url}/api/events`);
  const reader = events.body.getReader(), decoder = new TextDecoder();
  assert.match(decoder.decode((await reader.read()).value), /event: refresh/);
  await write(reportPath, validReport());
  await app.refresh();
  assert.match(decoder.decode((await reader.read()).value), /event: refresh/);
  await reader.cancel();
  const next = await (await fetch(`${app.url}/api/dashboard`)).json();
  assert.notEqual(next.revision, first.revision); assert.equal(next.cases[0].verdict, "PASS");
  assert.equal((await fetch(`${app.url}/api/case?id=${encodeURIComponent(next.cases[0].id)}`)).status, 200);
  assert.equal((await fetch(`${app.url}/artifact?path=${encodeURIComponent(reportPath)}`)).status, 200);
  assert.equal((await fetch(`${app.url}/artifact?path=package.json`)).status, 404);
  assert.equal((await fetch(`${app.url}/`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${app.url}/api/dashboard`, { headers: { Origin: "null" } })).status, 403);
  assert.equal((await fetch(`${app.url}/api/dashboard`, { headers: { Origin: "http://example.com" } })).status, 403);
  assert.equal((await fetch(`${app.url}/api/dashboard`)).status, 200, "malformed origins cannot crash the server");
});

test("test history preserves failed TAP details and cannot report success for zero or absent tests", async () => {
  const { parseTap } = await import("../scripts/lib/test-history.mjs");
  const failed = parseTap("not ok 1 - latest state\n  error: old response won\n# tests 1\n# pass 0\n# fail 1\n# skipped 0\n", 1);
  assert.equal(failed.status, "FAIL"); assert.equal(failed.failed, 1);
  assert.match(failed.failures[0].message, /old response won/);
  assert.equal(parseTap("# tests 0\n# pass 0\n# fail 0\n", 0).status, "ERROR");
  assert.equal(parseTap("", 0).status, "ERROR");
  assert.equal(parseTap("# tests 2\n# pass 0\n# fail 0\n# skipped 2\n", 0).status, "ERROR");
  assert.equal(parseTap("# tests 2\n# pass 2\n# fail 0\n# skipped 0\n", 0).status, "PASS");
});

test("new vectors can use declarative matching while planned vectors never claim exercised coverage", async () => {
  const { vectorIds } = await import("../scripts/lib/dashboard-data.mjs");
  const report = validReport({ mode: "flow" });
  report.run.journeyChecks = ["retry-recovered"];
  const registry = [
    { id: "retry", stage: "implemented", match: { assertion_ids: ["retry-recovered"] } },
    { id: "response-order", stage: "planned" },
    { id: "future", stage: "planned", match: { variants: ["race-reordered"] } }
  ];
  assert.deepEqual(vectorIds(report, { app: "gateway-race-original", variant: "race-reordered" }, registry), ["retry"]);
});

test("target check charts count only their declared invariant and expose missing or duplicate cycle records", async t => {
  const { root, write, reportPath } = await fixture(t);
  const { createCollector, assertionCoverage } = await import("../scripts/lib/dashboard-data.mjs");
  const report = validReport({ mode: "flow" });
  report.run.journeyChecks = ["target", "other"];
  report.evidence.find(event => event.kind === "run_result").data.journeyChecks = ["target", "other"];
  for (let cycle = 1; cycle <= 3; cycle++) for (const id of ["target", "other"]) report.evidence.push({
    id: `${id}-${cycle}`, kind: "journey_assertion", phase: "cycle", cycle, context: {},
    data: { assertionId: id, status: id === "target" && cycle < 3 ? "pass" : "fail" }
  });
  report.evidence_count = report.evidence.length;
  await write(reportPath, report);
  await write("dashboard/vectors.json", [
    { id: "target-vector", name: "Target vector", stage: "implemented", match: { assertion_ids: ["target"] } },
    { id: "planned-vector", name: "Planned", stage: "planned", match: { assertion_ids: ["other"] } }
  ]);
  const collector = createCollector(root), data = await collector.snapshot();
  assert.deepEqual(data.vectors[0].target_checks, { ids: ["target"], expected: 3, passed: 2, failed: 1, unverified: 0 });
  assert.equal(data.vectors[0].assertions_failed, 4, "Whole-case totals stay separate from target counts");
  assert.equal(data.vectors[1].target_checks, null);
  assert.equal(data.vectors[1].case_count, 0);
  report.evidence = report.evidence.filter(event => event.id !== "target-2");
  report.evidence.push({ ...report.evidence.find(event => event.id === "target-1"), id: "target-1-duplicate" });
  assert.deepEqual(assertionCoverage(report)[0], { id: "target", expected: 3, passed: 0, failed: 1, unverified: 2 });
  report.run.cycles = 1000000000;
  assert.deepEqual(assertionCoverage(report), [], "Malformed cycle counts cannot expand the collector workload");
});
