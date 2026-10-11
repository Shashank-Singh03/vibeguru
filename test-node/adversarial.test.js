"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");
const { chromium } = require("playwright");
const { validReport } = require("./helpers/valid-report.js");
const { assessReport } = require("../mcp/report.js");

async function fixture(t) {
  const { createWorkbench } = await import("../test-app/async-workbench/server.mjs");
  const app = await createWorkbench();
  await new Promise(done => app.server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); await app.close(); });
  return { browser, url: `http://127.0.0.1:${app.server.address().port}` };
}
async function scenario(fixture, adapter, variant, mode) {
  const old = process.env.VIBEGURU_LAB_VARIANT;
  process.env.VIBEGURU_LAB_VARIANT = variant;
  let flow;
  try { flow = await import(`${pathToFileURL(resolve(`benchmarks/lab/${adapter}.mjs`))}?qa=${mode}-${variant}`); }
  finally { if (old === undefined) delete process.env.VIBEGURU_LAB_VARIANT; else process.env.VIBEGURU_LAB_VARIANT = old; }
  const context = await fixture.browser.newContext();
  const page = await context.newPage();
  const { journeyCheck, journeyObservation } = await import("../driver-node/lib/flow.js");
  const events = [];
  try {
    await flow.setup(page, { config: { url: fixture.url } });
    await page.goto(`${fixture.url}/?mode=${mode}`);
    let error;
    try { await flow.default(page, { cycle: 1, mark: async () => {},
      check: journeyCheck(value => events.push(value), 1, () => page.url()),
      observe: journeyObservation(value => events.push(value), 1, () => page.url()) }); }
    catch (caught) { error = caught; }
    return { events, error };
  } finally { await context.close(); }
}

test("pending navigation detects stale departed-view writes and preserves completed/fixed controls", async t => {
  const app = await fixture(t);
  for (const [variant, mode, failure] of [["nav-complete", "broken", false], ["nav-pending", "broken", true], ["nav-pending", "fixed", false]]) {
    const result = await scenario(app, "pending-navigation", variant, mode);
    assert.equal(result.error?.name, failure ? "JourneyAssertionError" : undefined, `${variant}/${mode}: ${result.error?.stack}`);
    assert.equal(result.events.filter(item => item.kind === "journey_assertion").length, 3);
    const outcome = result.events.find(item => item.data.observationId === "pending-navigation-result").data.payload;
    assert.equal(outcome.trace.every(item => item.status === "Home ready"), !failure);
    assert.equal(result.events.find(item => item.data.observationId === "pending-cleanup").data.payload.restored, true);
  }
});

test("HTTP outage and malformed data distinguish a stuck UI from an actual usable retry", async t => {
  const app = await fixture(t);
  for (const variant of ["http-normal", "http-503", "http-malformed", "http-disconnect"]) {
    for (const mode of ["broken", "fixed"]) {
      const result = await scenario(app, "http-recovery", variant, mode);
      const failure = mode === "broken" && variant !== "http-normal";
      assert.equal(result.error?.name, failure ? "JourneyAssertionError" : undefined, `${variant}/${mode}: ${result.error?.stack}`);
      assert.equal(result.events.filter(item => item.kind === "journey_assertion").length, 3);
      const outcome = result.events.find(item => item.data.observationId === "recovery-result").data.payload;
      assert.equal(outcome.final.reached, !failure);
      if (mode === "fixed" && variant !== "http-normal") assert.equal(outcome.server.attempt, 2, "A deliberate visible retry reached the real backend");
    }
  }
});

test("undeclared and malformed assertion records cannot make an apparently clean run pass", () => {
  for (const data of [{ assertionId: "unannounced", status: "pass" },
    { assertionId: "unannounced", status: "unknown" }, { status: "pass" }]) {
    const report = validReport({ mode: "flow" });
    report.evidence.push({ id: "stray-assertion", kind: "journey_assertion", phase: "cycle", cycle: 1, context: { route: "flow" }, data });
    report.evidence_count = report.evidence.length;
    assert.notEqual(assessReport(report).verdict, "PASS", JSON.stringify(data));
  }
});

test("a failed assertion remains FAIL when its declared contract is incomplete", () => {
  const report = validReport({ mode: "flow" });
  report.evidence.push({ id: "failed-assertion", kind: "journey_assertion", phase: "cycle", cycle: 1,
    context: { route: "flow" }, data: { assertionId: "known-failure", status: "fail" } });
  report.evidence_count = report.evidence.length;
  assert.equal(assessReport(report).verdict, "FAIL");
  assert.ok(assessReport(report).reasons.includes("incomplete_journey_assertions"));
});

test("omitting analyzed findings cannot hide an observed uncaught error or failed request", () => {
  for (const data of [{ type: "page_error", message: "Uncaught fixture error", count: 3 },
    { type: "request_failed", message: "Failed request", count: 3 },
    { type: "http_error", status: 503, message: "HTTP 503", count: 3 },
    { type: "console_error", message: "Real logged application error", count: 3 }]) {
    const report = validReport();
    report.evidence.push({ id: "raw-failure", kind: "runtime_event", phase: "cycle", cycle: 3, context: { route: "/clean" }, data });
    report.evidence_count = report.evidence.length;
    assert.equal(assessReport(report).verdict, "FAIL", data.type);
  }
});

test("network console echoes preserve the analyzer's nonblocking HTTP 404 semantics", () => {
  const report = validReport();
  for (const [index, data] of [{ type: "http_error", status: 404, message: "HTTP 404", count: 3 },
    { type: "console_error", message: "Failed to load resource", count: 3 }].entries()) {
    report.evidence.push({ id: `echo-${index}`, kind: "runtime_event", phase: "cycle", cycle: 3, context: { route: "/clean" }, data });
  }
  report.evidence_count = report.evidence.length;
  assert.equal(assessReport(report).verdict, "PASS");
});

test("the evidence corruption corpus preserves its control and rejects all damaged variants", async () => {
  const { corruptionCorpus } = await import("../benchmarks/report-corruption.mjs");
  const seed = validReport();
  const before = JSON.stringify(seed), corpus = corruptionCorpus(seed);
  assert.equal(corpus.length, 33);
  for (const item of corpus) assert.equal(assessReport(item.report).verdict, item.expected, item.id);
  assert.equal(JSON.stringify(seed), before, "The recorded seed must remain untouched");
});
