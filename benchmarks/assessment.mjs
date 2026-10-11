import { createRequire } from "node:module";
const { assessReport } = createRequire(import.meta.url)("../mcp/report.js");

export function fingerprint(finding) {
  const route = String(finding.location?.route || "").replace(/^https?:\/\/[^/]+/, "");
  const detail = finding.metrics?.assertion_id || finding.metrics?.message || "";
  return JSON.stringify([finding.vector, finding.signature, route, detail]);
}

export function compareObserved(baseline, candidate) {
  const before = new Map(baseline.findings.map(f => [fingerprint(f), f]));
  const after = new Map(candidate.findings.map(f => [fingerprint(f), f]));
  return {
    baseline_verdict: assessReport(baseline).verdict,
    candidate_verdict: assessReport(candidate).verdict,
    removed: [...before.keys()].filter(key => !after.has(key)),
    remaining: [...before.keys()].filter(key => after.has(key)),
    introduced: [...after.keys()].filter(key => !before.has(key)),
    // Observed differences are not a causal proof or a blanket fix verification.
    comparable_execution: ["mode", "cycles", "settleMs"].every(key => baseline.run[key] === candidate.run[key]) &&
      JSON.stringify(baseline.run.censusTargets) === JSON.stringify(candidate.run.censusTargets) &&
      JSON.stringify(baseline.run.journeyChecks) === JSON.stringify(candidate.run.journeyChecks),
    full_scoped_candidate_pass: assessReport(candidate).verdict === "PASS"
  };
}

const expected = {
  "listener-leak": ["listener_leak"], "heap-leak": ["route_heap_growth"],
  "runtime-error": ["uncaught_exception"],
  combined: ["listener_leak", "route_heap_growth", "uncaught_exception"],
  "partial-fixed": ["route_heap_growth"], "invalid-fix": ["journey_assertion_failed"]
};

export function assessExpectation(report, expectation) {
  if (expectation == null) return null;
  const failures = expectation.failures;
  if (!Array.isArray(failures) || failures.some(id => typeof id !== "string" || !id.trim()) || new Set(failures).size !== failures.length) {
    throw new Error("Expected failures must be unique non-empty assertion IDs");
  }
  const mismatches = [];
  if (!report || report.schema_version !== 2 || assessReport(report).verdict === "ERROR") {
    return { met: false, mismatches: ["Fresh valid report unavailable"] };
  }
  const checks = Array.isArray(report.run.journeyChecks) ? report.run.journeyChecks : [];
  const cycles = report.run.cycles;
  const assertions = report.evidence.filter(e => e.kind === "journey_assertion");
  const outcomes = report.evidence.filter(e => e.kind === "journey_result");
  if (!checks.length || checks.some(id => typeof id !== "string" || !id.trim()) || new Set(checks).size !== checks.length) {
    mismatches.push("No valid declared outcome assertions");
  }
  if (!Number.isInteger(cycles) || cycles < 3) mismatches.push("Insufficient repeated cycles");
  if (failures.some(id => !checks.includes(id))) mismatches.push("Expected failure is not declared");
  for (const id of checks) {
    const records = assertions.filter(e => e.data.assertionId === id);
    const status = failures.includes(id) ? "fail" : "pass";
    if (records.length !== cycles || new Set(records.map(e => e.cycle)).size !== cycles ||
        records.some(e => e.phase !== "cycle" || !Number.isInteger(e.cycle) || e.cycle < 1 || e.cycle > cycles || e.data.status !== status)) {
      mismatches.push(`Expected assertion ${id} to ${status} exactly once in every cycle`);
    }
  }
  if (assertions.some(e => !checks.includes(e.data.assertionId))) mismatches.push("Undeclared assertion observed");
  if (assertions.some(e => e.data.status === "fail" && !failures.includes(e.data.assertionId))) mismatches.push("Unexpected failed assertion");
  if (report.run.ok !== true || report.run.mode !== "flow" ||
      report.run.flowCompleted !== (failures.length ? 0 : cycles) || report.run.flowFailures !== (failures.length ? cycles : 0)) {
    mismatches.push("Flow execution counts did not match the expected outcome");
  }
  if (outcomes.length !== cycles || new Set(outcomes.map(e => e.cycle)).size !== cycles ||
      outcomes.some(e => e.phase !== "cycle" || !Number.isInteger(e.cycle) || e.cycle < 1 || e.cycle > cycles || e.data.completed !== !failures.length ||
        (!failures.length && (e.data.errorType != null || e.data.message != null)) ||
        (failures.length && e.data.errorType !== "JourneyAssertionError"))) {
    mismatches.push("Cycle execution did not match the expected outcome; infrastructure failure remains visible");
  }
  return { met: !mismatches.length, mismatches };
}

export function scoreCase(report, variant, expectation = null) {
  const assessment = report ? assessReport(report) : { verdict: "ERROR", reasons: ["No fresh report"] };
  const expectedSignals = expected[variant] || [];
  const detected = expectedSignals.filter(signature => assessment.verdict !== "ERROR" && report?.findings.some(f => {
    if (f.signature !== signature) return false;
    if (signature === "uncaught_exception") return f.metrics?.message?.includes("vibeguru_lab_runtime_defect");
    if (signature === "listener_leak") return f.metrics?.listeners_per_visit >= 6;
    if (signature === "route_heap_growth") return f.metrics?.heap_bytes_per_visit >= 500000;
    return true;
  }));
  return { assessment, expectation: assessExpectation(report, expectation), expectedSignals, detected, missed: expectedSignals.filter(s => !detected.includes(s)),
    control: ["baseline", "fixed"].includes(variant),
    interrupted_not_passed: variant === "interrupted" ? assessment.verdict !== "PASS" : null };
}
