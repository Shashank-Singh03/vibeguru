"use strict";

const SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);
const CHECKS = ["scope", "memory.client", "runtime.client", "census.client"];
const VERDICTS = new Set(["PASS", "FAIL", "INCONCLUSIVE", "ERROR"]);
const MEMORY_METRICS = ["heapUsed", "nodes", "listeners", "documents"];
const RUN_FIELDS = [
  "ok", "url", "mode", "cycles", "settleMs", "routesLimit", "censusTargets",
  "gcFailures", "runtimeObserved", "flowFailures", "flowCompleted",
  "navigationFailures", "retentionInvalid", "routeCount"
];

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = value => Number.isInteger(value) && value >= 0;
const string = value => typeof value === "string" && value.length > 0;
const unique = values => new Set(values).size === values.length;
// Object key order changes when evidence crosses the JSON/Elixir boundary.
const canonical = value => Array.isArray(value) ? value.map(canonical) : record(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function validFinding(finding) {
  return record(finding) && SEVERITIES.has(finding.severity) &&
    string(finding.signature) && typeof finding.summary === "string" &&
    (finding.location == null || record(finding.location)) &&
    (finding.metrics == null || record(finding.metrics)) &&
    (finding.fix == null || record(finding.fix));
}

// Reassess persisted evidence instead of trusting a saved "complete" flag.
// Structural corruption is ERROR; missing/unknown measurements are INCONCLUSIVE.
// A known blocking finding remains FAIL when otherwise well-formed checks are partial.
function assessReport(report) {
  const error = reason => ({ verdict: "ERROR", reasons: [reason] });
  if (!record(report) || !Array.isArray(report.findings)) return error("Missing findings array.");
  if (!report.findings.every(validFinding)) return error("Malformed finding.");
  if (Object.hasOwn(report, "run_findings") &&
      (!Array.isArray(report.run_findings) || !report.run_findings.every(validFinding))) {
    return error("Malformed full-run findings array.");
  }
  if (report.filtered && !Array.isArray(report.run_findings)) return error("Filtered report is missing full-run findings.");
  const allFindings = report.run_findings
    ? [...report.findings, ...report.run_findings]
    : report.findings;
  const blocking = allFindings.some(f => ["high", "critical"].includes(f.severity));

  if (report.schema_version !== 2) {
    return {
      verdict: blocking ? "FAIL" : "INCONCLUSIVE",
      reasons: ["Legacy report: measurement validity is unverified. Re-run with the current engine."]
    };
  }
  if (report.tool !== "vibeguru" || !VERDICTS.has(report.verdict) ||
      !Array.isArray(report.evidence) || !record(report.run) ||
      !record(report.measurement_validity) || !stringsOrEmpty(report.validity_reasons)) {
    return error("Incomplete schema 2 report.");
  }
  const reasons = new Set(report.validity_reasons);
  const limit = (condition, reason) => { if (condition) reasons.add(reason); };
  for (const check of CHECKS) {
    const validity = report.measurement_validity[check];
    if (!record(validity) || !["complete", "partial", "unavailable"].includes(validity.status) ||
        !stringsOrEmpty(validity.reasons)) return error(`Invalid measurement validity for ${check}.`);
    if (validity.status === "complete" && validity.reasons.length) return error(`Contradictory validity for ${check}.`);
    if (validity.status !== "complete") reasons.add(`${check}: ${validity.reasons.join(", ") || validity.status}`);
  }

  const ids = new Set();
  for (const ev of report.evidence) {
    if (!record(ev) || !string(ev.id) || ids.has(ev.id)) return error("Missing or duplicate evidence identifier.");
    if (!string(ev.kind) || !record(ev.data) || !record(ev.context)) return error("Malformed evidence record.");
    ids.add(ev.id);
  }
  for (const finding of allFindings) {
    if (!stringsOrEmpty(finding.evidence_refs) || finding.evidence_refs.some(id => !ids.has(id))) {
      return error("Invalid finding evidence references.");
    }
  }
  // Keep directly observed blocking events visible if a damaged/optimistic
  // report loses its analyzed finding. Match Runtime's narrow echo exclusions:
  // an expected 4xx plus Chrome's network console echo is still nonblocking.
  const runtimeEvents = report.evidence.filter(e => e.kind === "runtime_event");
  const routeOf = event => event.context.routes?.[0] || event.context.route || "/";
  const networkRoutes = new Set(runtimeEvents.filter(e => ["request_failed", "http_error"].includes(e.data.type)).map(routeOf));
  const loopRoutes = new Set(allFindings.filter(f => f.signature === "render_loop").map(f => f.location?.route));
  const observedBlocking = runtimeEvents.some(event => {
    const data = event.data;
    if (["page_error", "request_failed"].includes(data.type)) return true;
    if (data.type === "http_error") return Number.isInteger(data.status) && data.status >= 500;
    if (data.type !== "console_error") return false;
    const message = String(data.message || ""), route = routeOf(event);
    return !(networkRoutes.has(route) && /failed to load resource/i.test(message)) &&
      !(loopRoutes.has(route) && /maximum update depth|too many re-?renders/i.test(message));
  });
  limit(observedBlocking && !blocking, "unreported_runtime_failure");
  limit(report.evidence_count !== undefined && report.evidence_count !== report.evidence.length, "inconsistent_evidence_count");

  const run = report.run;
  if (!["auto", "flow"].includes(run.mode)) return error("Invalid run mode.");
  if (!Array.isArray(run.censusTargets) || !run.censusTargets.every(string) || !unique(run.censusTargets)) {
    return error("Invalid required censusTargets array.");
  }
  limit(!integer(run.cycles) || run.cycles < 3, "insufficient_cycles");
  limit(run.ok !== true, "driver_completion_unconfirmed");
  limit(!string(run.url), "missing_run_url");
  limit(!number(run.settleMs) || !integer(run.routesLimit), "missing_run_configuration");
  limit(run.gcFailures !== 0, "gc_status_missing_or_failed");
  limit(run.runtimeObserved !== true, "runtime_observation_unconfirmed");
  limit(run.flowFailures !== 0, "failed_interactions");
  limit(run.navigationFailures !== 0, "failed_navigation");
  limit(run.retentionInvalid !== false, "retained_state_chain_unconfirmed");

  const results = report.evidence.filter(e => e.kind === "run_result");
  const journeyChecks = Object.hasOwn(run, "journeyChecks") ? run.journeyChecks : [];
  const assertions = report.evidence.filter(e => e.kind === "journey_assertion");
  const outcomes = report.evidence.filter(e => e.kind === "journey_result");
  if (run.mode === "flow" || run.journeyProtocolVersion === 1 || outcomes.length > 0) {
    limit(run.mode === "flow" && run.journeyProtocolVersion !== 1 || !Number.isInteger(run.cycles) || run.cycles < 1 || outcomes.length !== run.cycles ||
      new Set(outcomes.map(e => e.cycle)).size !== run.cycles ||
      outcomes.some(e => e.phase !== "cycle" || !Number.isInteger(e.cycle) || e.cycle < 1 || e.cycle > run.cycles ||
        typeof e.data.completed !== "boolean" || (e.data.completed
          ? e.data.errorType != null || e.data.message != null
          : typeof e.data.errorType !== "string" || !e.data.errorType.trim())) ||
      outcomes.filter(e => e.data.completed === true).length !== run.flowCompleted ||
      outcomes.filter(e => e.data.completed === false).length !== run.flowFailures, "incomplete_journey_results");
  }
  const checksValid = Array.isArray(journeyChecks) && journeyChecks.every(id => typeof id === "string" && id.trim()) &&
    new Set(journeyChecks).size === journeyChecks.length;
  const assertionsValid = checksValid && assertions.every(e => e.phase === "cycle" &&
    typeof e.data.assertionId === "string" && journeyChecks.includes(e.data.assertionId) &&
    Number.isInteger(e.cycle) && e.cycle >= 1 && e.cycle <= run.cycles && ["pass", "fail"].includes(e.data.status));
  limit(!checksValid || !assertionsValid || (checksValid && journeyChecks.length > 0 &&
    (!Number.isInteger(run.cycles) || run.cycles < 1 ||
      journeyChecks.some(id => {
        const matches = assertions.filter(e => e.data.assertionId === id);
        return matches.length !== run.cycles || new Set(matches.map(e => e.cycle)).size !== run.cycles ||
          matches.some(e => !Number.isInteger(e.cycle) || e.cycle < 1 || e.cycle > run.cycles || !["pass", "fail"].includes(e.data.status));
      }))), "incomplete_journey_assertions");
  if (results.length === 1) limit(!equal(run.journeyChecks ?? [], results[0].data.journeyChecks ?? []), "inconsistent_journey_contract");
  if (results.length > 1) return error("Multiple driver result records.");
  limit(results.length !== 1, "missing_driver_result");
  if (results.length === 1) {
    const data = results[0].data;
    limit(data.ok !== true, "driver_completion_unconfirmed");
    limit([...new Set([...RUN_FIELDS, ...Object.keys(run)])].some(key => !equal(data[key], run[key])), "inconsistent_driver_metadata");
  }

  const coverage = report.coverage;
  let visited = [], knownRoutes = [];
  if (coverage == null) {
    reasons.add("missing_coverage");
  } else {
    if (!record(coverage) || !stringsOrEmpty(coverage.visited) ||
        !Array.isArray(coverage.unreachable) ||
        !coverage.unreachable.every(e => record(e) && string(e.path) && string(e.reason))) {
      return error("Malformed coverage.");
    }
    visited = coverage.visited;
    const missed = coverage.unreachable.map(e => e.path);
    knownRoutes = [...new Set([...visited, ...missed])];
    limit(!unique(visited) || !unique(missed) || visited.some(p => missed.includes(p)), "inconsistent_coverage");
    limit(coverage.mode !== run.mode, "inconsistent_coverage_mode");
    limit(!integer(coverage.routes_known) || coverage.routes_known !== knownRoutes.length, "inconsistent_coverage_count");
    const expectedRatio = knownRoutes.length ? visited.length / knownRoutes.length : 1;
    limit(!number(coverage.ratio) || coverage.ratio > 1 ||
      Math.abs(coverage.ratio - expectedRatio) > 0.001, "inconsistent_coverage_ratio");
    limit(missed.length > 0, "unreachable_routes");
    const expectedLow = run.mode === "flow"
      ? coverage.flow_planned === 0 || coverage.flow_completed !== coverage.flow_planned || coverage.flow_failures > 0
      : knownRoutes.length === 0 || expectedRatio < 0.7;
    limit(typeof coverage.low !== "boolean" || coverage.low !== expectedLow, "inconsistent_coverage_flag");
    if (run.mode === "flow") {
      limit(coverage.flow_planned !== run.cycles ||
        coverage.flow_completed !== run.cycles || coverage.flow_failures !== 0 ||
        run.flowCompleted !== run.cycles, "incomplete_flow");
    } else {
      limit(visited.length === 0, "no_routes_exercised");
      limit(run.flowCompleted !== 0 || ["flow_completed", "flow_planned", "flow_failures"].some(key => coverage[key] !== 0), "inconsistent_flow_coverage");
    }
  }

  const coverageRecords = report.evidence.filter(e => e.kind === "coverage");
  if (coverageRecords.length > 1) return error("Multiple coverage records.");
  limit(coverageRecords.length !== 1, "missing_coverage_evidence");
  const rawCoverage = coverageRecords[0]?.data;
  const driverCoverage = results[0]?.data.coverage;
  for (const actual of [rawCoverage, driverCoverage]) {
    if (actual === undefined) {
      reasons.add("missing_driver_coverage");
      continue;
    }
    if (!record(actual) || !stringsOrEmpty(actual.visited) ||
        !Array.isArray(actual.unreachable) ||
        !actual.unreachable.every(e => record(e) && string(e.path) && string(e.reason)) ||
        !stringsOrEmpty(actual.planned)) return error("Malformed driver coverage.");
    if (coverage) {
      limit(!equal(actual.visited, coverage.visited) ||
        !equal(actual.unreachable, coverage.unreachable) || actual.mode !== coverage.mode,
      "inconsistent_driver_coverage");
      limit(["flow_completed", "flow_planned", "flow_failures"].some(key => actual[key] !== coverage[key]),
        "inconsistent_flow_coverage");
    }
    limit(!unique(actual.planned) || actual.planned.length !== run.routeCount, "inconsistent_planned_routes");
    if (run.mode === "auto") {
      limit(knownRoutes.some(p => !actual.planned.includes(p) &&
        !coverage?.unreachable.some(e => e.path === p && ["dynamic", "over_limit"].includes(e.reason))),
      "inconsistent_planned_routes");
      limit(actual.planned.some(p => !knownRoutes.includes(p)), "unaccounted_planned_routes");
    }
  }
  if (rawCoverage && driverCoverage) limit(!equal(rawCoverage, driverCoverage), "inconsistent_coverage_evidence");

  const samples = report.evidence.filter(e => e.kind === "sample");
  const baseline = samples.filter(e => e.phase === "baseline");
  const cooldown = samples.filter(e => e.phase === "cooldown");
  const cycles = samples.filter(e => e.phase === "cycle");
  if (samples.some(e => !["baseline", "cycle", "cooldown"].includes(e.phase))) return error("Invalid sample phase.");
  limit(baseline.length !== 1 || cooldown.length !== 1, "incomplete_samples");
  limit(baseline.some(e => e.cycle !== 0) || cooldown.some(e => e.cycle !== run.cycles + 1), "inconsistent_sample_cycles");
  limit(samples.some(e => MEMORY_METRICS.some(key => !number(e.data[key]))), "missing_memory_metrics");
  limit(samples.some(e => e.data.gcOk !== true), "sample_gc_unconfirmed");
  limit(cycles.some(e => !integer(e.cycle) || e.cycle < 1 || e.cycle > run.cycles ||
    !string(e.context.route)), "invalid_cycle_sample");
  limit(cycles.some(e => !number(e.data.mutations) || !number(e.data.mutationWindowMs) ||
    e.data.mutationWindowMs === 0), "missing_mutation_metrics");

  const sampleOrder = report.evidence.filter(e => e.kind === "sample");
  limit(sampleOrder.length > 0 &&
    (sampleOrder[0].phase !== "baseline" || sampleOrder.at(-1).phase !== "cooldown"),
  "inconsistent_sample_order");
  limit(cycles.some((e, i) => i > 0 && e.cycle < cycles[i - 1].cycle), "inconsistent_sample_order");
  const requiredRoutes = run.mode === "flow"
    ? [...new Set(cycles.map(e => e.context.route).filter(string))]
    : visited;
  limit(requiredRoutes.length === 0, "no_cycle_samples");
  for (const route of requiredRoutes) {
    const observed = cycles.filter(e => e.context.route === route);
    const cycleNumbers = observed.map(e => e.cycle);
    limit(!unique(cycleNumbers) || cycleNumbers.length !== run.cycles ||
      cycleNumbers.some(n => !integer(n) || n < 1 || n > run.cycles), "incomplete_route_cycles");
  }
  if (run.mode === "auto") limit(cycles.some(e => !knownRoutes.includes(e.context.route)), "unaccounted_sample_route");

  const censuses = report.evidence.filter(e => e.kind === "census");
  if (censuses.some(e => !["baseline", "cycle"].includes(e.phase) || !record(e.data.counts))) {
    return error("Malformed census evidence.");
  }
  if (run.censusTargets.length === 0) reasons.add("no_census_targets");
  limit(censuses.some((e, i) => i > 0 && e.cycle < censuses[i - 1].cycle), "inconsistent_census_order");
  for (const sample of [...baseline, ...cycles]) {
    const matches = censuses.filter(e =>
      e.phase === sample.phase && e.cycle === sample.cycle &&
      e.context.route === sample.context.route);
    limit(matches.length !== 1, "incomplete_census");
    if (matches.length === 1) {
      const samplePosition = report.evidence.indexOf(sample);
      const censusPosition = report.evidence.indexOf(matches[0]);
      const nextSamplePosition = report.evidence.findIndex((e, index) => index > samplePosition && e.kind === "sample");
      limit(censusPosition <= samplePosition || (nextSamplePosition !== -1 && censusPosition >= nextSamplePosition), "inconsistent_census_order");
    }
    for (const target of run.censusTargets) {
      limit(matches.length !== 1 || !integer(matches[0].data.counts[target]),
        "unavailable_census_targets");
    }
  }
  limit(censuses.some(e => ![...baseline, ...cycles].some(s =>
    e.phase === s.phase && e.cycle === s.cycle && e.context.route === s.context.route)),
  "unpaired_census_evidence");

  if (report.verdict === "ERROR") return { verdict: "ERROR", reasons: [...reasons] };
  if (report.verdict === "INCONCLUSIVE") reasons.add("engine_reported_inconclusive");
  return {
    verdict: blocking || observedBlocking || assertions.some(e => e.data.status === "fail") || report.verdict === "FAIL" ? "FAIL" : reasons.size ? "INCONCLUSIVE" : "PASS",
    reasons: [...reasons]
  };
}

function stringsOrEmpty(value) {
  return Array.isArray(value) && value.every(string);
}

if (typeof module !== "undefined" && module.exports) module.exports = { assessReport };
else globalThis.VibeGuruReport = { assessReport };
