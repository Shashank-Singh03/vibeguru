"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validReport } = require("./helpers/valid-report.js");
const { assessReport } = require("../mcp/report.js");

// Persist the actual outcome protocol alongside measurements, coverage and the final
// driver result. Expected negative cases are real asserted failures, not exit codes.
function expectationReport({ failures = [], checks = ["peer-updated", "converged"], errorType = "JourneyAssertionError" } = {}) {
  const report = validReport({ mode: "flow" });
  report.evidence = report.evidence.filter(event => event.kind !== "journey_result");
  const completed = failures.length === 0;
  Object.assign(report.run, { journeyChecks: [...checks], journeyProtocolVersion: 1,
    flowCompleted: completed ? report.run.cycles : 0, flowFailures: completed ? 0 : report.run.cycles });
  Object.assign(report.coverage, { flow_completed: report.run.flowCompleted, flow_failures: report.run.flowFailures });
  const rawCoverage = report.evidence.find(event => event.kind === "coverage").data;
  Object.assign(rawCoverage, { flow_completed: report.run.flowCompleted, flow_failures: report.run.flowFailures });
  Object.assign(report.evidence.find(event => event.kind === "run_result").data,
    structuredClone(report.run), { coverage: structuredClone(rawCoverage) });
  for (let cycle = 1; cycle <= report.run.cycles; cycle++) {
    for (const id of checks) report.evidence.push({
      id: `assertion-${id}-${cycle}`, kind: "journey_assertion", phase: "cycle", cycle,
      context: { route: "recorded flow" }, data: { assertionId: id, status: failures.includes(id) ? "fail" : "pass" }
    });
    report.evidence.push({ id: `outcome-${cycle}`, kind: "journey_result", phase: "cycle", cycle,
      context: { route: "recorded flow" }, data: completed ? { completed: true } : { completed: false, errorType } });
  }
  report.verdict = completed ? "PASS" : "FAIL";
  report.evidence_count = report.evidence.length;
  return report;
}

function removeEvidence(report, matches) {
  report.evidence = report.evidence.filter(event => !matches(event));
  report.evidence_count = report.evidence.length;
  return report;
}

test("saved required checks cannot disappear or silently skip a cycle", () => {
  const report = validReport({ mode: "flow" });
  report.evidence = report.evidence.filter(event => event.kind !== "journey_result");
  delete report.run.journeyProtocolVersion;
  delete report.evidence.find(e => e.kind === "run_result").data.journeyProtocolVersion;
  report.run.journeyChecks = ["saved"];
  report.evidence.find(e => e.kind === "run_result").data.journeyChecks = ["saved"];
  assert.equal(assessReport(report).verdict, "INCONCLUSIVE");
  for (let cycle = 1; cycle <= report.run.cycles; cycle++) report.evidence.push({
    id: `assertion-${cycle}`, kind: "journey_assertion", phase: "cycle", cycle, context: {},
    data: { assertionId: "saved", status: "pass" }
  });
  report.evidence_count = report.evidence.length;
  assert.equal(assessReport(report).verdict, "INCONCLUSIVE", "Completion evidence is required even when the protocol flag was removed");
  report.run.journeyProtocolVersion = 1;
  report.evidence.find(e => e.kind === "run_result").data.journeyProtocolVersion = 1;
  assert.equal(assessReport(report).verdict, "INCONCLUSIVE", "Declared outcome protocol requires actual execution records");
  for (let cycle = 1; cycle <= report.run.cycles; cycle++) report.evidence.push({
    id: `outcome-${cycle}`, kind: "journey_result", phase: "cycle", cycle, context: {}, data: { completed: true }
  });
  report.evidence_count = report.evidence.length;
  assert.equal(assessReport(report).verdict, "PASS");
  report.evidence.at(-1).data.completed = false;
  assert.equal(assessReport(report).verdict, "INCONCLUSIVE", "Contradictory raw outcome cannot appear complete");
  report.evidence.at(-1).data.completed = true;
  report.evidence.find(e => e.kind === "journey_assertion").data.status = "fail";
  assert.equal(assessReport(report).verdict, "FAIL", "Raw asserted failure survives optimistic findings/verdict");
});

test("campaign comparisons ignore changing measured magnitudes without hiding remaining defects", async () => {
  const { compareObserved } = await import("../benchmarks/assessment.mjs");
  const finding = (signature, bytes) => ({ signature, vector: "memory.client", severity: "high", summary: "Measured growth",
    location: { route: "recorded flow" }, metrics: { heap_bytes_per_visit: bytes } });
  const baseline = validReport({ mode: "flow", findings: [finding("listener_leak", 0), finding("route_heap_growth", 900000)] });
  const partial = validReport({ mode: "flow", findings: [finding("route_heap_growth", 800000)] });
  const result = compareObserved(baseline, partial);
  assert.equal(result.remaining.length, 1);
  assert.equal(result.removed.length, 1);
  assert.equal(result.full_scoped_candidate_pass, false);
});

test("missing benchmark reports count as missed injections, never successful tests", async () => {
  const { scoreCase } = await import("../benchmarks/assessment.mjs");
  const result = scoreCase(null, "combined");
  assert.equal(result.expectedSignals.length, 3);
  assert.equal(result.detected.length, 0);
  assert.equal(result.missed.length, 3);
  assert.equal(result.assessment.verdict, "ERROR");
});

test("all-pass expectations require repeated declared assertions and completed execution", async () => {
  const { assessExpectation } = await import("../benchmarks/assessment.mjs");
  const report = expectationReport();
  assert.equal(assessReport(report).verdict, "PASS", "fixture includes complete persisted measurement and outcome evidence");
  assert.deepEqual(assessExpectation(report, { failures: [] }), { met: true, mismatches: [] });
  assert.equal(assessExpectation(report, null), null, "an unspecified expectation is not invented");

  removeEvidence(report, event => event.kind === "journey_result" && event.cycle === 2);
  const result = assessExpectation(report, { failures: [] });
  assert.equal(result.met, false);
  assert.ok(result.mismatches.some(message => message.includes("Cycle execution")));
});

test("misplaced and contradictory journey records cannot satisfy clean or negative expectations", async () => {
  const { assessExpectation } = await import("../benchmarks/assessment.mjs");
  for (const failures of [[], ["converged"]]) {
    for (const kind of ["journey_assertion", "journey_result"]) {
      const report = expectationReport({ failures });
      report.evidence.find(event => event.kind === kind).phase = "baseline";
      assert.equal(assessExpectation(report, { failures }).met, false, `${kind}/${failures}`);
      if (!failures.length) assert.equal(assessReport(report).verdict, "INCONCLUSIVE");
      else assert.equal(assessReport(report).verdict, "FAIL", "Known failures stay blocking");
    }
  }
  const report = expectationReport();
  report.evidence.find(event => event.kind === "journey_result").data.errorType = "Error";
  assert.equal(assessReport(report).verdict, "INCONCLUSIVE");
  assert.equal(assessExpectation(report, { failures: [] }).met, false);
});

test("a missing check or skipped cycle cannot satisfy an all-pass expectation", async () => {
  const { assessExpectation } = await import("../benchmarks/assessment.mjs");
  for (const skip of [
    event => event.kind === "journey_assertion" && event.data.assertionId === "peer-updated",
    event => event.kind === "journey_assertion" && event.data.assertionId === "converged" && event.cycle === 2,
  ]) {
    const report = removeEvidence(expectationReport(), skip);
    assert.equal(assessExpectation(report, { failures: [] }).met, false);
  }
});

test("the named negative assertion must fail in every cycle with JourneyAssertionError outcomes", async () => {
  const { assessExpectation } = await import("../benchmarks/assessment.mjs");
  const report = expectationReport({ failures: ["converged"] });
  assert.equal(assessReport(report).verdict, "FAIL", "a successful negative experiment still represents failed app assertions");
  assert.deepEqual(assessExpectation(report, { failures: ["converged"] }), { met: true, mismatches: [] });
  report.evidence.find(event => event.kind === "journey_assertion" && event.data.assertionId === "converged" && event.cycle === 2).data.status = "pass";
  const result = assessExpectation(report, { failures: ["converged"] });
  assert.equal(result.met, false);
  assert.ok(result.mismatches.some(message => message.includes("converged") && message.includes("fail") && message.includes("every cycle")));
});

test("missing prerequisite checks cannot make a negative expectation successful", async () => {
  const { assessExpectation } = await import("../benchmarks/assessment.mjs");
  for (const skip of [
    event => event.kind === "journey_assertion" && event.data.assertionId === "peer-updated",
    event => event.kind === "journey_assertion" && event.data.assertionId === "peer-updated" && event.cycle === 2,
  ]) {
    const report = removeEvidence(expectationReport({ failures: ["converged"] }), skip);
    assert.equal(assessExpectation(report, { failures: ["converged"] }).met, false,
      "an expected failed check cannot stand in for unobserved prerequisite checks");
  }
});

test("generic errors and infrastructure timeouts are not expected negative success", async () => {
  const { assessExpectation } = await import("../benchmarks/assessment.mjs");
  for (const errorType of ["Error", "TimeoutError", "ReconnectInfrastructureError", ""]) {
    const report = expectationReport({ failures: ["converged"], errorType });
    const result = assessExpectation(report, { failures: ["converged"] });
    assert.equal(result.met, false, `${errorType || "missing error type"} must stay visible`);
    assert.ok(result.mismatches.some(message => message.includes("infrastructure failure remains visible")));
  }
  const report = expectationReport({ failures: ["converged"] });
  delete report.evidence.find(event => event.kind === "journey_result").data.errorType;
  assert.equal(assessExpectation(report, { failures: ["converged"] }).met, false);
});

test("an unexpected failed assertion invalidates the expected negative experiment", async () => {
  const { assessExpectation } = await import("../benchmarks/assessment.mjs");
  const report = expectationReport({ failures: ["converged"] });
  report.evidence.find(event => event.kind === "journey_assertion" && event.data.assertionId === "peer-updated" && event.cycle === 1).data.status = "fail";
  const result = assessExpectation(report, { failures: ["converged"] });
  assert.equal(result.met, false);
  assert.ok(result.mismatches.includes("Unexpected failed assertion"));
});

test("duplicate cycles, undeclared observations and contradictory execution counters cannot satisfy a contract", async () => {
  const { assessExpectation } = await import("../benchmarks/assessment.mjs");
  const duplicated = expectationReport();
  duplicated.evidence.find(event => event.kind === "journey_assertion" && event.data.assertionId === "converged" && event.cycle === 2).cycle = 1;
  assert.equal(assessExpectation(duplicated, { failures: [] }).met, false, "three records are insufficient if a cycle is duplicated");

  const undeclared = expectationReport();
  undeclared.evidence.push({ id: "undeclared-assertion", kind: "journey_assertion", cycle: 1, context: {},
    data: { assertionId: "unplanned-check", status: "pass" } });
  undeclared.evidence_count = undeclared.evidence.length;
  const result = assessExpectation(undeclared, { failures: [] });
  assert.equal(result.met, false);
  assert.ok(result.mismatches.includes("Undeclared assertion observed"));

  const wrongCounts = expectationReport({ failures: ["converged"] });
  wrongCounts.run.flowFailures = 0;
  assert.equal(assessExpectation(wrongCounts, { failures: ["converged"] }).met, false,
    "expected failure records cannot hide contradictory execution counters");
});

test("missing or malformed reports cannot satisfy an expectation or crash its assessment", async () => {
  const { assessExpectation } = await import("../benchmarks/assessment.mjs");
  const malformedEvidence = expectationReport();
  malformedEvidence.evidence[0].data = null;
  for (const report of [null, undefined, {}, { schema_version: 2, findings: [] }, malformedEvidence,
    { findings: [] }, { findings: [], run: { journeyChecks: ["converged"], cycles: 3 } }]) {
    let result;
    assert.doesNotThrow(() => { result = assessExpectation(report, { failures: [] }); });
    assert.equal(result.met, false);
    assert.ok(result.mismatches.length > 0);
  }
});
