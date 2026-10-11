"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { renderReport, filterFindings } = require("../mcp/render");
const { assessReport } = require("../mcp/report");
const { validReport } = require("./helpers/valid-report");

function report(overrides={}) {
  return { ...validReport(), ...overrides };
}

test("schema 2 verdict is scoped and conservative about missing validity",()=>{
  assert.equal(assessReport(report()).verdict,"PASS");
  for(const input of [null,{}, {findings:null}, report({measurement_validity:{}}),report({evidence:[{id:"duplicate"},{id:"duplicate"}]})]) assert.match(renderReport(input),/^ERROR/);
  const gcFailure = report();
  gcFailure.run.gcFailures = 1;
  assert.match(renderReport(gcFailure),/^INCONCLUSIVE/);
  assert.match(renderReport(report({evidence:[]})),/^INCONCLUSIVE/);
  assert.match(renderReport({schema_version:1,findings:[]}),/^INCONCLUSIVE/);
});

test("advisories do not block; filtered views retain the full-run verdict",()=>{
  const finding={signature:"http_error",summary:"HTTP 404",severity:"medium",evidence_refs:[],location:{route:"/x"}};
  assert.match(renderReport(report({findings:[finding]})),/^PASS/);
  const blocking={...finding,severity:"high"};
  const input=report({verdict:"FAIL",findings:[blocking]});
  const filtered=filterFindings(input,{route:"/other"});
  assert.equal(filtered.findings.length,0);
  assert.match(renderReport(filtered),/^FAIL/);
  assert.match(renderReport(filtered),/verdict covers the full run/);
});

test("optimistic flags cannot replace observed measurements", () => {
  const input = report();
  input.evidence = input.evidence.filter(e => e.kind === "sample" && e.phase !== "cycle");
  input.evidence.forEach(e => { e.data = {}; });
  input.evidence_count = input.evidence.length;
  const result = assessReport(input);
  assert.equal(result.verdict, "INCONCLUSIVE");
  for (const reason of ["missing_driver_result", "missing_memory_metrics", "sample_gc_unconfirmed", "incomplete_route_cycles", "incomplete_census"]) assert.ok(result.reasons.includes(reason), reason);
});

test("every memory sample must contain numeric measurements and confirmed GC", () => {
  for (const phase of ["baseline", "cycle", "cooldown"]) {
    for (const metric of ["heapUsed", "nodes", "listeners", "documents"]) {
      for (const unknown of [undefined, null, "0", NaN, Infinity, -1]) {
        const input = report();
        input.evidence.find(e => e.kind === "sample" && e.phase === phase).data[metric] = unknown;
        const result = assessReport(input);
        assert.equal(result.verdict, "INCONCLUSIVE", `${phase} ${metric} ${unknown}`);
        assert.ok(result.reasons.includes("missing_memory_metrics"));
      }
    }
    const input = report();
    input.evidence.find(e => e.kind === "sample" && e.phase === phase).data.gcOk = false;
    assert.ok(assessReport(input).reasons.includes("sample_gc_unconfirmed"));
  }
});

test("each reached route requires every configured cycle and at least three cycles", () => {
  assert.equal(assessReport(validReport({ routes: ["/a", "/b"] })).verdict, "PASS");
  const missing = validReport({ routes: ["/a", "/b"] });
  missing.evidence = missing.evidence.filter(e => !(e.kind === "sample" && e.context.route === "/b" && e.cycle === 2));
  assert.ok(assessReport(missing).reasons.includes("incomplete_route_cycles"));
  const duplicate = report();
  const first = duplicate.evidence.find(e => e.kind === "sample" && e.phase === "cycle");
  duplicate.evidence.splice(duplicate.evidence.indexOf(first), 0, { ...structuredClone(first), id: "duplicate_sample" });
  assert.ok(assessReport(duplicate).reasons.includes("incomplete_route_cycles"));
  assert.ok(assessReport(validReport({ cycles: 2 })).reasons.includes("insufficient_cycles"));
});

test("runtime mutation count and measured window must be present for each cycle", () => {
  for (const [key, value] of [["mutations", undefined], ["mutations", null], ["mutations", "0"], ["mutationWindowMs", 0], ["mutationWindowMs", undefined]]) {
    const input = report();
    input.evidence.find(e => e.kind === "sample" && e.phase === "cycle").data[key] = value;
    assert.ok(assessReport(input).reasons.includes("missing_mutation_metrics"));
  }
});

test("persisted successful driver completion and consistent configuration are required", () => {
  const absent = report();
  absent.evidence = absent.evidence.filter(e => e.kind !== "run_result");
  assert.ok(assessReport(absent).reasons.includes("missing_driver_result"));
  const failed = report();
  failed.evidence.find(e => e.kind === "run_result").data.ok = false;
  assert.ok(assessReport(failed).reasons.includes("driver_completion_unconfirmed"));
  for (const key of ["url", "cycles", "settleMs", "routesLimit", "censusTargets", "durationMs"]) {
    const input = report();
    input.evidence.find(e => e.kind === "run_result").data[key] = "different";
    assert.ok(assessReport(input).reasons.includes("inconsistent_driver_metadata"), key);
  }
});

test("all configured census targets require paired numeric observations at baseline and every cycle", () => {
  const complete = validReport({ censusTargets: ["MutationObserver", "WebSocket"] });
  assert.equal(assessReport(complete).verdict, "PASS");
  for (const phase of ["baseline", "cycle"]) {
    for (const unknown of [undefined, null, "0", NaN, -1, 0.5]) {
      const input = validReport({ censusTargets: ["MutationObserver", "WebSocket"] });
      input.evidence.find(e => e.kind === "census" && e.phase === phase).data.counts.WebSocket = unknown;
      assert.ok(assessReport(input).reasons.includes("unavailable_census_targets"), `${phase} ${unknown}`);
    }
  }
  const missing = report();
  missing.evidence = missing.evidence.filter(e => !(e.kind === "census" && e.phase === "cycle" && e.cycle === 2));
  assert.ok(assessReport(missing).reasons.includes("incomplete_census"));
  const reordered = report();
  const census = reordered.evidence.find(e => e.kind === "census");
  reordered.evidence.splice(reordered.evidence.indexOf(census), 1);
  reordered.evidence.push(census);
  assert.ok(assessReport(reordered).reasons.includes("inconsistent_census_order"));
  assert.ok(assessReport(validReport({ censusTargets: [] })).reasons.includes("no_census_targets"));
  const missingTargets = report();
  delete missingTargets.run.censusTargets;
  assert.equal(assessReport(missingTargets).verdict, "ERROR");
});

test("coverage counters and driver observations must agree", () => {
  const complete = report();
  assert.equal(assessReport(complete).verdict, "PASS");
  for (const [key, value] of [["routes_known", 2], ["ratio", 0.1], ["low", true], ["mode", "flow"]]) {
    const input = report();
    input.coverage[key] = value;
    assert.equal(assessReport(input).verdict, "INCONCLUSIVE", key);
  }
  const inconsistent = report();
  inconsistent.evidence.find(e => e.kind === "coverage").data.visited = ["/different"];
  assert.ok(assessReport(inconsistent).reasons.includes("inconsistent_driver_coverage"));
  const missed = validReport({ unreachable: [{ path: "/protected", reason: "auth_required" }] });
  assert.ok(assessReport(missed).reasons.includes("unreachable_routes"));
  const reorderedKeys = report();
  const result = reorderedKeys.evidence.find(e => e.kind === "run_result");
  result.data.coverage = Object.fromEntries(Object.entries(result.data.coverage).reverse());
  assert.equal(assessReport(reorderedKeys).verdict, "PASS");
});

test("flow mode requires completed cycles plus complete observed samples", () => {
  assert.equal(assessReport(validReport({ mode: "flow" })).verdict, "PASS");
  const input = validReport({ mode: "flow" });
  input.coverage.flow_completed = 2;
  assert.ok(assessReport(input).reasons.includes("incomplete_flow"));
  const missing = validReport({ mode: "flow" });
  missing.evidence = missing.evidence.filter(e => !(e.kind === "sample" && e.phase === "cycle" && e.cycle === 3));
  assert.ok(assessReport(missing).reasons.includes("incomplete_route_cycles"));
});

test("known blocking failures survive partial measurements; corruption is ERROR", () => {
  const blocking = { signature: "console_error", summary: "Observed error", severity: "high", evidence_refs: [], location: { route: "/clean" } };
  const input = report({ findings: [blocking] });
  input.evidence.find(e => e.kind === "sample" && e.phase === "cycle").data.heapUsed = null;
  assert.equal(assessReport(input).verdict, "FAIL");
  input.evidence[0].data = null;
  assert.equal(assessReport(input).verdict, "ERROR");
  assert.equal(assessReport({ schema_version: 1, findings: [blocking] }).verdict, "FAIL");
});

test("malformed full-run findings never throw or conceal blocking findings", () => {
  for (const value of [{}, null, "findings", [null]]) {
    const input = report({ filtered: true, run_findings: value });
    assert.equal(assessReport(input).verdict, "ERROR");
    assert.match(renderReport(input), /^ERROR/);
  }
  assert.equal(assessReport(report({ filtered: true })).verdict, "ERROR");
  const visible = { signature: "console_error", summary: "Observed error", severity: "high", evidence_refs: [] };
  assert.equal(assessReport(report({ findings: [visible], filtered: true, run_findings: [] })).verdict, "FAIL");
});

test("the same assessment implementation can execute without CommonJS in a browser", () => {
  const vm = require("node:vm");
  const fs = require("node:fs");
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve("../mcp/report"), "utf8"), context);
  assert.equal(context.VibeGuruReport.assessReport(report()).verdict, "PASS");
  assert.equal(context.VibeGuruReport.assessReport(report({ run_findings: {} })).verdict, "ERROR");
});

test("delayed console events qualify observation, while requests retain their origin",async()=>{
  const {observe}=await import("../driver-node/lib/observer.js");
  const page=new EventEmitter();
  page.addInitScript=async()=>{};
  const observer=await observe(page);
  observer.route("/observers");
  const req={url:()=>"http://app/api",resourceType:()=>"fetch",failure:()=>({errorText:"ERR_CONNECTION_REFUSED"})};
  page.emit("request",req);
  observer.route("/protected");
  page.emit("requestfailed",req);
  page.emit("console",{type:()=>"error",text:()=>"delayed socket error",location:()=>({url:"http://app/Observers.jsx",lineNumber:27})});
  const events=observer.events();
  assert.equal(events[0].attribution,"request_origin");
  assert.deepEqual(events[0].routes,["/observers"]);
  assert.equal(events[1].attribution,"observed_route");
  assert.deepEqual(events[1].routes,["/protected"]);
});

test("same message at different source locations remains distinct",async()=>{
  const {observe}=await import("../driver-node/lib/observer.js");
  const page=new EventEmitter();page.addInitScript=async()=>{};
  const observer=await observe(page);
  for(const file of ["A.jsx","B.jsx"]) page.emit("console",{type:()=>"error",text:()=>"same error",location:()=>({url:file,lineNumber:1})});
  assert.equal(observer.events().length,2);
});
