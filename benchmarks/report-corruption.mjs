// Mutate a genuinely recorded clean run; these are evidence-integrity checks,
// separate from app-defect detection and ordinary browser campaign outcomes.
export function corruptionCorpus(seed) {
  const cases = [];
  const add = (id, expected, mutate) => {
    const report = structuredClone(seed); mutate(report);
    report.evidence_count = report.evidence.length; cases.push({ id, expected, report });
  };
  add("unchanged-control", "PASS", () => {});
  for (const phase of ["baseline", "cycle", "cooldown"]) {
    for (const metric of ["heapUsed", "nodes", "listeners", "documents"]) {
      add(`missing-${phase}-${metric}`, "INCONCLUSIVE", report => { report.evidence.find(e => e.kind === "sample" && e.phase === phase).data[metric] = null; });
    }
    add(`unconfirmed-${phase}-gc`, "INCONCLUSIVE", report => { report.evidence.find(e => e.kind === "sample" && e.phase === phase).data.gcOk = false; });
  }
  add("missing-cycle", "INCONCLUSIVE", report => {
    const missing = report.evidence.find(e => e.kind === "sample" && e.phase === "cycle");
    report.evidence = report.evidence.filter(e => e.id !== missing.id);
  });
  add("missing-completion", "INCONCLUSIVE", report => { report.evidence = report.evidence.filter(e => e.kind !== "run_result"); });
  add("duplicate-evidence-id", "ERROR", report => { report.evidence[1].id = report.evidence[0].id; });
  add("contradictory-driver-metadata", "INCONCLUSIVE", report => { report.run.cycles++; });
  add("unavailable-constructor", "INCONCLUSIVE", report => {
    report.evidence.find(e => e.kind === "census").data.counts[report.run.censusTargets[0]] = null;
  });
  const appendAssertion = (report, status, id = "not-declared") => {
    report.evidence.push({ id: `corruption-assertion-${status}`, kind: "journey_assertion", phase: "cycle", cycle: 1,
      context: { route: report.run.url }, data: { assertionId: id, status } });
  };
  add("undeclared-passing-assertion", "INCONCLUSIVE", report => appendAssertion(report, "pass"));
  add("unknown-assertion-status", "INCONCLUSIVE", report => appendAssertion(report, "unknown"));
  add("failed-assertion-survives-incomplete-contract", "FAIL", report => appendAssertion(report, "fail"));
  for (const type of ["page_error", "console_error", "request_failed", "http_error"]) {
    add(`unreported-${type}`, "FAIL", report => report.evidence.push({ id: `corruption-${type}`, kind: "runtime_event", phase: "cycle", cycle: 1,
      context: { route: report.run.url }, data: { type, message: `Adversarial ${type}`, status: 503, count: report.run.cycles } }));
  }
  add("dangling-finding-reference", "ERROR", report => report.findings.push({ signature: "console_error", severity: "high", summary: "Invalid reference", evidence_refs: ["does-not-exist"] }));
  add("invalid-run-mode", "ERROR", report => { report.run.mode = "pretend"; });
  const outcome = report => {
    let event = report.evidence.find(e => e.kind === "journey_result" && e.data.completed === true);
    if (!event) {
      event = { id: "corruption-outcome", kind: "journey_result", phase: "cycle", cycle: 1, context: {}, data: { completed: true } };
      report.evidence.push(event);
    }
    return event;
  };
  add("wrong-phase-journey-result", "INCONCLUSIVE", report => { outcome(report).phase = "baseline"; });
  add("completed-journey-with-error", "INCONCLUSIVE", report => { outcome(report).data.errorType = "Error"; });
  add("omitted-flow-completion-and-protocol", "INCONCLUSIVE", report => {
    report.run.mode = "flow"; delete report.run.journeyProtocolVersion;
    report.evidence = report.evidence.filter(e => e.kind !== "journey_result");
    const data = report.evidence.find(e => e.kind === "run_result")?.data;
    if (data) { data.mode = "flow"; delete data.journeyProtocolVersion; }
  });
  return cases;
}
