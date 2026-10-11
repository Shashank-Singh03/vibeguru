// Controlled NDJSON sidecar for protocol/pipeline contract tests (no browser).
const fs = require("fs");
const config = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf("--config") + 1], "utf8"));
const overrides = JSON.parse(process.env.VIBEGURU_TEST_RESULT || "{}");
const emit = obj => process.stdout.write(JSON.stringify(obj) + "\n");
const flowCycles = config.mode === "flow" ? config.cycles : 0;
const coverage = { mode: config.mode, declared: 1, discovered: 1, planned: ["/clean"], visited: ["/clean"], unreachable: [], flow_completed: flowCycles, flow_planned: flowCycles, flow_failures: 0, ...overrides.coverage };
const counts = Object.fromEntries((config.censusTargets || []).map(name => [name, 0]));
const data = { heapUsed: 1000000, nodes: 100, listeners: 10, documents: 1, mutations: 0, mutationWindowMs: 400, gcOk: true };
if (!overrides.noEvidence) {
  for (const [phase, cycle] of [["baseline", 0], ...Array.from({length: config.cycles}, (_, i) => ["cycle", i+1]), ["cooldown", config.cycles+1]]) {
    if (overrides.missingCycle === cycle && phase === "cycle") continue;
    const route = phase === "cycle" && overrides.routeByCycle ? overrides.routeByCycle[String(cycle)] : "/clean";
    emit({type: "evidence", kind: "sample", phase, cycle, context: {route}, data: {...data, ...overrides.metrics}});
    if (phase !== "cooldown" && overrides.missingCensus !== cycle) emit({type: "evidence", kind: "census", phase, cycle, context: {route}, data: {counts: {...counts, ...overrides.counts}}});
  }
  for (const assertion of overrides.assertions || []) emit({type: "evidence", kind: "journey_assertion", phase: "cycle", context: {route: "/clean"}, ...assertion});
  const outcomes = overrides.outcomes ?? (config.mode === "flow" ? Array.from({length: config.cycles}, (_, i) => ({cycle: i+1, data: {completed: true}})) : []);
  for (const outcome of outcomes) emit({type: "evidence", kind: "journey_result", phase: "cycle", context: {route: "/clean"}, ...outcome});
  emit({type: "evidence", kind: "coverage", data: coverage});
  for (const message of overrides.errors || []) emit({type: "evidence", kind: "runtime_event", context: {route: "/clean", routes: ["/clean"]}, data: {type: "console_error", message, count: 3, attribution: "observed_route"}});
}
if (!overrides.noResult) emit({type: "result", ok: true, url: config.url, routeCount: 1, coverage, cycles: config.cycles, mode: config.mode, settleMs: config.settleMs, routesLimit: config.routesLimit, censusTargets: config.censusTargets, gcFailures: 0, flowFailures: 0, flowCompleted: flowCycles, navigationFailures: 0, retentionInvalid: false, runtimeObserved: true, journeyChecks: [], journeyProtocolVersion: config.mode === "flow" ? 1 : null, ...overrides.result});
