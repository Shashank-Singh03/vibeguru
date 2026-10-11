"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// Exercise execution and refusal paths rather than synthesizing successful result flags.
function scenario(overrides = {}) {
  const seen = { visits: [], captures: 0, gc: 0, browserClosed: 0, contextClosed: 0, events: [] };
  const before = { constructors: { Chart: { count: 0, bytes: 0 }, Stable: { count: 2, bytes: 20 }, Lost: { count: 4, bytes: 40 } }, nodeCount: 6 };
  const after = { constructors: { Chart: { count: 3, bytes: 300 }, Stable: { count: 2, bytes: 20 }, New: { count: 100, bytes: 1000 } }, nodeCount: 105 };
  const page = {
    goto: async () => ({ status: () => overrides.httpStatus ?? 200 }),
    waitForTimeout: async () => {},
  };
  const client = { send: async () => {} };
  const context = {
    newPage: async () => page,
    newCDPSession: async () => client,
    close: async () => { seen.contextClosed++; },
  };
  const dependencies = {
    chromium: { launch: async () => ({ newContext: async () => context, close: async () => { seen.browserClosed++; } }) },
    discover: async () => [{ path: "/charts", hrefAttr: "/charts" }],
    documentToken: async () => overrides.changedDocument && seen.visits.length >= overrides.changedDocument ? "reloaded" : "initial",
    visitRoute: async (_page, descriptor) => {
      seen.visits.push(descriptor);
      if (seen.visits.length === overrides.failVisit) return { ok: false, reason: "auth_required" };
      if (seen.visits.length === overrides.invalidVisit) return { ok: true, retentionInvalid: true, reason: "document_reload" };
      return { ok: true };
    },
    collectGarbage: async () => { seen.gc++; return seen.gc !== overrides.failGc; },
    capture: async () => { seen.captures++; return seen.captures === 1 ? before : after; },
  };
  const config = {
    url: "http://example.test", route: "/charts", cycles: 3, settleMs: 1, headless: true,
    constructorHints: ["Chart"], routeExpectations: { "/charts": "h1[data-chart]" },
    ...overrides.config,
  };
  return { seen, execute: async () => {
    const { runSnapshot } = await import("../driver-node/lib/snapshot-run.js");
    return runSnapshot(config, event => seen.events.push(event), dependencies);
  } };
}

test("focused capture verifies visits and GC and compares only represented constructor counts", async () => {
  const { seen, execute } = scenario();
  const result = await execute();
  assert.equal(seen.visits.length, 4, "one warm-up plus three measured visits");
  assert.equal(seen.gc, 3, "baseline and two cooldown collections");
  assert.equal(seen.captures, 2);
  assert.ok(seen.visits.every(descriptor => descriptor.hrefAttr === "/charts" && descriptor.expectedSelector === "h1[data-chart]"));
  const evidence = seen.events.filter(event => event.type === "evidence");
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].context.route, "/charts");
  assert.deepEqual(evidence[0].data.growth, { Chart: { retained: 3, perVisit: 1, bytes: 300 } });
  assert.deepEqual(evidence[0].data.excludedConstructors.sort(), ["Lost", "New"]);
  assert.equal(evidence[0].data.before.Chart.count, 0, "an explicit measured target zero is comparable");
  assert.equal(evidence[0].data.after.Chart.count, 3);
  assert.equal(evidence[0].data.comparisonScope, "ranked_constructor_summary");
  for (const value of [result, evidence[0].data]) {
    assert.equal(value.visits, 3);
    assert.equal(value.visitsCompleted, 3);
    assert.equal(value.gcOk, true);
    assert.equal(value.navigationOk, true);
  }
  assert.equal(result.ok, true);
  assert.equal(seen.contextClosed, 1);
  assert.equal(seen.browserClosed, 1);
});

test("failed warm-up or measured visits never emit a successful heap census", async () => {
  for (const failVisit of [1, 3]) {
    const { seen, execute } = scenario({ failVisit });
    await assert.rejects(execute(), /route \/charts unverified: auth_required/);
    assert.equal(seen.captures, failVisit === 1 ? 0 : 1);
    assert.equal(seen.events.filter(event => event.type === "evidence").length, 0);
    assert.equal(seen.browserClosed, 1);
  }
});

test("document reloads invalidate retention comparisons even when a visit reports ok", async () => {
  for (const options of [{ invalidVisit: 2 }, { changedDocument: 2 }]) {
    const { seen, execute } = scenario(options);
    await assert.rejects(execute(), /document_reload|document changed/);
    assert.equal(seen.captures, 1);
    assert.equal(seen.events.filter(event => event.type === "evidence").length, 0);
    assert.equal(seen.browserClosed, 1);
  }
});

test("each required collection must succeed before final evidence is emitted", async () => {
  for (const failGc of [1, 2, 3]) {
    const { seen, execute } = scenario({ failGc });
    await assert.rejects(execute(), /garbage collection failed/);
    assert.equal(seen.captures, failGc === 1 ? 0 : 1);
    assert.equal(seen.events.filter(event => event.type === "evidence").length, 0);
    assert.equal(seen.browserClosed, 1);
  }
});

test("HTTP failure cannot become a successful initial document", async () => {
  const { seen, execute } = scenario({ httpStatus: 503 });
  await assert.rejects(execute(), /HTTP 503/);
  assert.equal(seen.visits.length, 0);
  assert.equal(seen.captures, 0);
  assert.equal(seen.browserClosed, 1);
});

test("invalid visit counts are rejected, including zero rather than silently defaulting", async () => {
  for (const cycles of [0, -1, 1.5, "3"]) {
    const { seen, execute } = scenario({ config: { cycles } });
    await assert.rejects(execute(), /positive integer/);
    assert.equal(seen.captures, 0);
    assert.equal(seen.visits.length, 0);
  }
});
