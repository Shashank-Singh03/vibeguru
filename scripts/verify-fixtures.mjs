#!/usr/bin/env node
// verify-fixtures.mjs — assert that a run against test-app still says what it should.
//
// test-app is deliberately broken: every fixture route isolates one signature, /clean
// is the control, and /protected sits behind an auth wall. So a run against it is a
// real assertion about the engine, not a smoke test. If the findings disappear the
// engine regressed; if /clean starts producing findings it began false-firing; if
// /protected silently becomes "covered", auth detection has regressed into calling a
// redirect to /login a healthy page.
//
// This lives in one file because two CI systems check it. Duplicating the
// expectations in a Jenkinsfile and a workflow guarantees they drift, and the one
// that drifts is the one nobody notices has stopped asserting anything.
//
// Usage: node scripts/verify-fixtures.mjs <path-to-vibeguru-findings.json>

import { readFileSync } from "node:fs";

// Every signature test-app is built to provoke. Missing one means either the
// analyzer stopped firing or the route stopped being reachable — both regressions.
const REQUIRED_SIGNATURES = [
  "detached_dom_leak",
  "listener_leak",
  "route_heap_growth",
  "uncaught_exception",
  "render_loop",
  "console_error",
  "failed_request",
];

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

const failures = [];
const fail = (msg) => failures.push(msg);

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/verify-fixtures.mjs <findings.json>");
  process.exit(64);
}

let report;
try {
  report = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`could not read ${file}: ${err.message}`);
  process.exit(1);
}

const findings = report.findings || [];
const signatures = [...new Set(findings.map((f) => f.signature))];

console.log(`findings   : ${findings.length}`);
console.log(`signatures : ${signatures.sort().join(", ")}`);

// 1. The engine still catches what test-app deliberately does wrong.
const missing = REQUIRED_SIGNATURES.filter((s) => !signatures.includes(s));
if (missing.length) {
  fail(`fixtures no longer detected: ${missing.join(", ")}`);
}

// 2. ...and does not invent problems on the control route.
const onClean = findings.filter((f) => f.location?.route === "/clean");
if (onClean.length) {
  fail(
    `/clean is the control and must stay clean, got ${onClean.length}: ` +
      onClean.map((f) => f.signature).join(", ")
  );
}

// 3. Ordering is a promise every consumer makes. Two analyzers each sort their own
// output, and concatenating sorted lists does not produce a sorted one — so assert
// it rather than assume it.
const ranks = findings.map((f) => SEVERITY_RANK[f.severity] ?? 99);
const sorted = [...ranks].sort((a, b) => a - b);
if (ranks.join() !== sorted.join()) {
  fail(`findings are not ordered most-severe-first: ${findings.map((f) => f.severity).join(", ")}`);
}

// 4. Coverage must be reported at all.
const coverage = report.coverage;
if (!coverage) {
  fail("the run reported no coverage — a result with no coverage cannot be trusted as clean");
} else {
  console.log(`coverage   : ${coverage.visited?.length ?? 0} of ${coverage.routes_known} routes`);

  // 5. CI has no saved session, so the auth wall must still be visible AS an auth
  // wall. This is the regression guard for `vibeguru auth`: if /protected quietly
  // became "covered", the run is reporting a redirect to /login as a healthy page.
  const walled = (coverage.unreachable || []).find((u) => u.path === "/protected");

  if (!walled) {
    fail("/protected should be unreachable without a session, but was not reported as such");
  } else if (walled.reason !== "auth_required") {
    fail(`/protected should be reported auth_required, got "${walled.reason}"`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} regression(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

console.log("\n✓ fixtures detected, control route clean, auth wall visible, ordering correct");
