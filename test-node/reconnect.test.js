"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const load = () => import("../benchmarks/desktop/multiplayer-reconnect.mjs");

test("bounded unmet observable expectations return false while infrastructure exceptions propagate", async () => {
  const { boundedObservation } = await load();
  const missed = await boundedObservation(async () => ({ status: "open", name: "stale" }), value => value.name === "new", 5);
  assert.equal(missed.matched, false);
  assert.equal(missed.observed.name, "stale");
  assert.ok(missed.attempts >= 1);
  const passed = await boundedObservation(async () => ({ name: "new" }), value => value.name === "new", 5);
  assert.equal(passed.matched, true);
  await assert.rejects(boundedObservation(async () => { throw new Error("page closed"); }, () => false, 5), /page closed/);
});

test("roster convergence compares identities, names, away state and room, independent of DOM order", async () => {
  const { rostersAgree } = await load();
  const main = { room: "r", entries: [{ id: "a", name: "Main", away: false, self: true }, { id: "b", name: "Peer", away: false, self: false }] };
  const peer = { room: "r", entries: [{ id: "b", name: "Peer", away: false, self: true }, { id: "a", name: "Main", away: false, self: false }] };
  assert.equal(rostersAgree(main, peer), true);
  for (const changed of [
    { ...peer, room: "other" },
    { ...peer, entries: [{ ...peer.entries[0], name: "stale" }, peer.entries[1]] },
    { ...peer, entries: [{ ...peer.entries[0], id: "different" }, peer.entries[1]] },
    { ...peer, entries: [{ ...peer.entries[0], away: true }, peer.entries[1]] },
    { ...peer, entries: [{ ...peer.entries[0], id: "a" }, peer.entries[1]] },
    { ...peer, entries: peer.entries.map(entry => ({ ...entry, self: entry.id === "a" })) },
    { ...peer, entries: peer.entries.map(entry => ({ ...entry, name: "" })) },
    { ...peer, entries: peer.entries.slice(1) },
  ]) assert.equal(rostersAgree(main, changed), false);
});

test("transport gates reconnects and suppresses only welcome frames in the labelled negative control", async () => {
  const { routeTransport } = await load();
  let handle;
  const page = { routeWebSocket: async (matches, handler) => {
    assert.equal(matches(new URL("ws://localhost:9000/ws")), true);
    assert.equal(matches(new URL("ws://elsewhere:9000/ws")), false);
    assert.equal(matches(new URL("ws://localhost:9000/other")), false);
    handle = handler;
  } };
  const socket = () => {
    const state = { forwarded: [], closes: [], connected: 0, inbound: null };
    const server = { onMessage: callback => { state.inbound = callback; }, close: async options => { state.closes.push({ side: "server", ...options }); } };
    const route = { connectToServer: () => { state.connected++; return server; }, send: frame => state.forwarded.push(frame), close: async options => { state.closes.push({ side: "page", ...options }); } };
    return { state, route };
  };
  const transport = await routeTransport(page, "http://localhost:9000");
  const first = socket();
  await handle(first.route);
  first.state.inbound(JSON.stringify({ t: "welcome", you: { id: "main" }, participants: [{ id: "peer", name: "Old" }], room: "r" }));
  assert.equal(first.state.forwarded.length, 1);
  await transport.disconnect();
  assert.deepEqual(first.state.closes.map(value => value.side), ["server", "page"]);
  assert.ok(first.state.closes.every(value => value.code >= 3000 && value.code <= 4999), "the real browser proxy permits application close codes");
  assert.equal(transport.snapshot().gate_blocked, true);
  const second = socket();
  const pending = handle(second.route);
  await Promise.resolve();
  assert.equal(second.state.connected, 0, "no real server reconnect while the gate is closed");
  transport.setWelcomeSuppression(true);
  transport.release();
  await pending;
  second.state.inbound(JSON.stringify({ t: "welcome", you: { id: "main" }, participants: [{ id: "peer", name: "New" }], room: "r" }));
  second.state.inbound(JSON.stringify({ t: "pong", echo: 123, now: 124 }));
  assert.equal(second.state.forwarded.length, 1);
  assert.equal(JSON.parse(second.state.forwarded[0]).t, "pong");
  assert.equal(transport.snapshot().suppressed_welcomes, 1);
  assert.equal(transport.snapshot().latest_welcome.participants[0].name, "New", "actual server expectation remains observable behind the suppressed application frame");
  transport.setWelcomeSuppression(false);
  second.state.inbound(JSON.stringify({ t: "welcome", you: { id: "main" }, participants: [], room: "r" }));
  assert.equal(second.state.forwarded.length, 2, "restored transport forwards welcome normally");
});

test("successful negative-control restoration preserves the original application failure", async () => {
  const { restoreNegativeControl } = await load();
  const primary = Object.assign(new Error("The rosters did not converge"), { name: "JourneyAssertionError" });
  const observations = [];
  const restored = { matched: true, observed: { status: "open" }, attempts: 1 };
  await assert.rejects(async () => {
    try {
      throw primary;
    } finally {
      await restoreNegativeControl(async () => restored, {
        primaryError: primary, record: async (id, data) => observations.push({ id, data }),
      });
    }
  }, error => error === primary);
  assert.deepEqual(observations, [{ id: "reconnect-cleanup", data: restored }]);
});

test("failed restoration retains the app assertion but cannot score as an expected negative success", async () => {
  const { restoreNegativeControl, ReconnectInfrastructureError, checks } = await load();
  const { assessExpectation } = await import("../benchmarks/assessment.mjs");
  const { assessReport } = require("../mcp/report.js");
  const { validReport } = require("./helpers/valid-report.js");
  const primary = Object.assign(new Error("The rosters did not converge"), { name: "JourneyAssertionError" });
  const observations = [];
  const missed = { matched: false, observed: { status: "connecting" }, attempts: 2 };
  let combined;
  await assert.rejects(restoreNegativeControl(async () => missed, {
    primaryError: primary, record: async (id, data) => observations.push({ id, data }),
  }), error => {
    combined = error;
    assert.ok(error instanceof AggregateError);
    assert.equal(error.name, "AggregateError");
    assert.equal(error.errors[0], primary);
    assert.ok(error.errors[1] instanceof ReconnectInfrastructureError);
    return true;
  });
  assert.deepEqual(observations.map(value => value.id), ["reconnect-cleanup", "reconnect-cleanup-error"]);
  assert.equal(observations[0].data.matched, false);
  assert.equal(observations[1].data.original_failure_preserved, true);

  // Persist the final-cycle combined outcome exactly as the driver does. Earlier
  // cycles remain expected assertion failures; cleanup must invalidate even the last.
  const report = validReport({ mode: "flow" });
  report.evidence = report.evidence.filter(event => event.kind !== "journey_result");
  Object.assign(report.run, { journeyChecks: [...checks], journeyProtocolVersion: 1,
    flowCompleted: 0, flowFailures: report.run.cycles });
  Object.assign(report.coverage, { flow_completed: 0, flow_failures: report.run.cycles });
  const coverage = report.evidence.find(event => event.kind === "coverage").data;
  Object.assign(coverage, { flow_completed: 0, flow_failures: report.run.cycles });
  Object.assign(report.evidence.find(event => event.kind === "run_result").data,
    structuredClone(report.run), { coverage: structuredClone(coverage) });
  for (let cycle = 1; cycle <= report.run.cycles; cycle++) {
    for (const id of checks) report.evidence.push({
      id: `reconnect-${cycle}-${id}`, kind: "journey_assertion", phase: "cycle", cycle,
      context: { route: "recorded flow" }, data: { assertionId: id, status: id === "roster-converged" ? "fail" : "pass" },
    });
    report.evidence.push({ id: `reconnect-outcome-${cycle}`, kind: "journey_result", phase: "cycle", cycle,
      context: { route: "recorded flow" }, data: { completed: false, errorType: "JourneyAssertionError" } });
  }
  report.evidence_count = report.evidence.length;
  assert.equal(assessExpectation(report, { failures: ["roster-converged"] }).met, true,
    "the repeated app assertion alone satisfies the labelled negative control");
  report.evidence.at(-1).data.errorType = combined.name;
  assert.equal(assessReport(report).verdict, "FAIL", "the previously emitted failed app assertions remain visible");
  const result = assessExpectation(report, { failures: ["roster-converged"] });
  assert.equal(result.met, false, "a final-cycle cleanup failure cannot certify a successful negative experiment");
  assert.ok(result.mismatches.some(message => message.includes("infrastructure failure remains visible")));
});

test("failed or missing cleanup cannot disappear when there was no primary failure", async () => {
  const { restoreNegativeControl, ReconnectInfrastructureError } = await load();
  const infrastructure = new ReconnectInfrastructureError("The page closed before restoration");
  for (const scenario of [
    { restore: async () => { throw infrastructure; }, matches: error => error === infrastructure },
    { restore: async () => ({ matched: false, observed: null }), matches: error => error instanceof ReconnectInfrastructureError && /restore observable preconditions/.test(error.message) },
    { restore: async () => undefined, matches: error => error instanceof ReconnectInfrastructureError && /no bounded observation/.test(error.message) },
  ]) {
    const observations = [];
    await assert.rejects(restoreNegativeControl(scenario.restore, {
      record: async (id, data) => observations.push({ id, data }),
    }), scenario.matches);
    const diagnostic = observations.find(value => value.id === "reconnect-cleanup-error");
    assert.ok(diagnostic, "a cleanup failure retains its diagnostic observation");
    assert.equal(diagnostic.data.original_failure_preserved, false);
  }
});

test("cleanup diagnostic recording errors retain both restoration and primary failures", async () => {
  const { restoreNegativeControl } = await load();
  const primary = Object.assign(new Error("Roster mismatch"), { name: "JourneyAssertionError" });
  const cleanup = new Error("Restoration transport failed");
  const diagnostic = new Error("Observation sink closed");
  for (const primaryError of [null, primary]) {
    await assert.rejects(restoreNegativeControl(async () => { throw cleanup; }, {
      primaryError, record: async () => { throw diagnostic; },
    }), error => {
      assert.ok(error instanceof AggregateError);
      const restoration = primaryError ? error.errors[1] : error;
      if (primaryError) assert.equal(error.errors[0], primary);
      assert.ok(restoration instanceof AggregateError);
      assert.deepEqual(restoration.errors, [cleanup, diagnostic]);
      return true;
    });
  }
});
