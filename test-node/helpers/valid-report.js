"use strict";

// A complete persisted run, not merely a collection of optimistic validity flags.
// Callers can remove or corrupt individual observations to exercise assessment.
function validReport({ cycles = 3, routes = ["/clean"], mode = "auto", censusTargets = ["MutationObserver"], findings = [], unreachable = [] } = {}) {
  const rawCoverage = {
    mode, declared: routes.length + unreachable.length, discovered: routes.length,
    planned: mode === "flow" ? [] : [...routes, ...unreachable.filter(e => !["dynamic", "over_limit"].includes(e.reason)).map(e => e.path)],
    visited: mode === "flow" ? [] : [...routes], unreachable: structuredClone(unreachable),
    flow_completed: mode === "flow" ? cycles : 0,
    flow_planned: mode === "flow" ? cycles : 0, flow_failures: 0
  };
  const known = rawCoverage.visited.length + unreachable.length;
  const ratio = known ? rawCoverage.visited.length / known : 1;
  const { planned, ...coverage } = rawCoverage;
  Object.assign(coverage, { routes_known: known, ratio: Math.round(ratio * 1000) / 1000, low: mode === "auto" ? known === 0 || ratio < 0.7 : false });
  const run = {
    ok: true, url: "http://localhost:5173", mode, cycles, settleMs: 400, routesLimit: 12,
    censusTargets: [...censusTargets], gcFailures: 0, runtimeObserved: true,
    flowFailures: 0, flowCompleted: mode === "flow" ? cycles : 0,
    navigationFailures: 0, retentionInvalid: false, routeCount: planned.length, durationMs: 1000
  };
  const evidence = [];
  if (mode === "flow") Object.assign(run, { journeyProtocolVersion: 1, journeyChecks: [] });
  const add = (kind, phase, cycle, route, data) => {
    const event = { id: `test_ev_${evidence.length + 1}`, kind, phase, cycle, context: route === undefined ? {} : { route }, data };
    evidence.push(event);
    return event;
  };
  const memory = { heapUsed: 1000000, nodes: 50, listeners: 5, documents: 1, gcOk: true };
  const counts = Object.fromEntries(censusTargets.map(target => [target, 0]));
  add("sample", "baseline", 0, "/", { ...memory });
  add("census", "baseline", 0, "/", { counts: { ...counts } });
  const labels = mode === "flow" ? ["recorded flow"] : routes;
  for (let cycle = 1; cycle <= cycles; cycle++) {
    for (const route of labels) {
      add("sample", "cycle", cycle, route, { ...memory, mutations: 0, mutationWindowMs: 100 });
      add("census", "cycle", cycle, route, { counts: { ...counts } });
    }
    if (mode === "flow") add("journey_result", "cycle", cycle, "recorded flow", { completed: true });
  }
  add("sample", "cooldown", cycles + 1, undefined, { ...memory });
  add("coverage", "cooldown", cycles, undefined, structuredClone(rawCoverage));
  add("run_result", null, null, undefined, { ...structuredClone(run), type: "result", coverage: structuredClone(rawCoverage) });
  const normalizedFindings = structuredClone(findings).map(finding => {
    const matches = evidence.filter(e => e.kind === "sample" && e.phase === "cycle" && e.context.route === finding.location?.route);
    if (finding.signature === "render_loop") {
      for (const sample of matches) sample.data.mutations = Math.round((finding.metrics?.mutations_per_second || 10000) * sample.data.mutationWindowMs / 1000);
    }
    if (finding.signature === "console_error") {
      const event = add("runtime_event", "runtime", null, finding.location?.route, {
        event: "console_error", message: finding.metrics?.message || finding.summary,
        count: finding.metrics?.occurrences || 1, routes: [finding.location?.route],
        attribution: "observed_route", source: finding.metrics?.source || "unknown"
      });
      return { ...finding, evidence_refs: [event.id] };
    }
    return { ...finding, evidence_refs: matches.length ? matches.map(e => e.id) : [evidence[0].id] };
  });
  return {
    tool: "vibeguru", schema_version: 2,
    verdict: normalizedFindings.some(f => ["high", "critical"].includes(f.severity)) ? "FAIL" : "PASS",
    findings: normalizedFindings, run, coverage, evidence, evidence_count: evidence.length,
    profile: { url: run.url, stack: "react", bundler: "vite" }, validity_reasons: [],
    measurement_validity: Object.fromEntries(["scope", "memory.client", "runtime.client", "census.client"].map(key => [key, { status: "complete", reasons: [] }]))
  };
}

module.exports = { validReport };
