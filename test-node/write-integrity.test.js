"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

async function fixture(t, options = { responseDelayMs: 0 }) {
  const { createWriteIntegrityServer } = await import("../test-app/write-integrity/server.mjs");
  const server = createWriteIntegrityServer(options);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, options) => {
    const response = await fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(3000) });
    return { status: response.status, body: await response.json() };
  };
  const post = (mode, payload, key = payload.intent_id) => request(`/api/${mode}/orders`, { method: "POST",
    headers: { "Content-Type": "application/json", ...(key === null ? {} : { "Idempotency-Key": key }) }, body: JSON.stringify(payload) });
  const state = (mode, namespace) => request(`/api/${mode}/state?${new URLSearchParams({ namespace })}`);
  const clear = (mode, namespace) => request(`/api/${mode}/state?${new URLSearchParams({ namespace })}`, { method: "DELETE" });
  return { server, origin, request, post, state, clear };
}

const order = (overrides = {}) => ({ namespace: `test-${randomUUID()}`, intent_id: randomUUID(), attempt_id: randomUUID(), sku: "reliability-seat", quantity: 1, ...overrides });

test("the vulnerable fixture really persists two overlapping physical writes for one logical intent", async t => {
  const api = await fixture(t, { responseDelayMs: 40 });
  const first = order();
  const replies = await Promise.all([api.post("vulnerable", first), api.post("vulnerable", { ...first, attempt_id: randomUUID() })]);
  assert.deepEqual(replies.map(reply => reply.status), [201, 201]);
  assert.notEqual(replies[0].body.order.id, replies[1].body.order.id);
  const { body } = await api.state("vulnerable", first.namespace);
  assert.equal(body.orders.length, 2, "the oracle is independent persisted backend state, not a UI counter");
  assert.equal(body.attempts.length, 2);
  assert.ok(body.orders.every(value => value.intent_id === first.intent_id && value.total_cents === 2500));
});

test("the corrected fixture atomically reuses one order for concurrent identical idempotency keys", async t => {
  const api = await fixture(t, { responseDelayMs: 40 });
  const first = order();
  const replies = await Promise.all([api.post("idempotent", first), api.post("idempotent", { ...first, attempt_id: randomUUID() })]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 201]);
  assert.equal(replies[0].body.order.id, replies[1].body.order.id);
  assert.deepEqual(replies.map(reply => reply.body.replayed).sort(), [false, true]);
  const { body } = await api.state("idempotent", first.namespace);
  assert.equal(body.orders.length, 1);
  assert.equal(body.attempts.length, 2, "both real requests must reach the backend; disabling the button is not the tested fix");
  assert.equal(body.inflight, 0);
});

test("single submission is a clean control and explicit acknowledged retry separates the implementations", async t => {
  const api = await fixture(t);
  for (const mode of ["vulnerable", "idempotent"]) {
    const first = order();
    const acknowledged = await api.post(mode, first);
    assert.equal(acknowledged.status, 201);
    assert.equal((await api.state(mode, first.namespace)).body.orders.length, 1);
    await api.post(mode, { ...first, attempt_id: randomUUID() });
    const { body } = await api.state(mode, first.namespace);
    assert.equal(body.orders.length, mode === "vulnerable" ? 2 : 1);
    assert.equal(body.attempts.length, 2);
  }
});

test("corrected idempotency rejects changed payloads and missing keys without creating another order", async t => {
  const api = await fixture(t);
  const first = order();
  await api.post("idempotent", first);
  const changed = await api.post("idempotent", { ...first, attempt_id: randomUUID(), quantity: 2 });
  assert.equal(changed.status, 409);
  assert.match(changed.body.error, /different payload/);
  const missing = await api.post("idempotent", { ...first, attempt_id: randomUUID() }, null);
  assert.equal(missing.status, 400);
  const { body } = await api.state("idempotent", first.namespace);
  assert.equal(body.orders.length, 1);
  assert.equal(body.orders[0].quantity, 1);
  assert.equal(body.attempts.filter(attempt => attempt.status === 409).length, 1);
});

test("namespaces and implementation modes cannot share orders or idempotency caches", async t => {
  const api = await fixture(t);
  const first = order();
  const other = { ...first, namespace: `other-${randomUUID()}`, attempt_id: randomUUID() };
  await api.post("idempotent", first);
  await api.post("idempotent", other);
  await api.post("vulnerable", { ...first, attempt_id: randomUUID() });
  const a = (await api.state("idempotent", first.namespace)).body;
  const b = (await api.state("idempotent", other.namespace)).body;
  const c = (await api.state("vulnerable", first.namespace)).body;
  assert.equal(a.orders.length, 1);
  assert.equal(b.orders.length, 1);
  assert.equal(c.orders.length, 1);
  assert.equal(new Set([a.orders[0].id, b.orders[0].id, c.orders[0].id]).size, 3);
});

test("cleanup refuses active writes, then clears both persisted data and idempotency keys", async t => {
  const api = await fixture(t, { responseDelayMs: 250 });
  const first = order();
  const pending = api.post("idempotent", first);
  const deadline = Date.now() + 1500;
  let observed;
  do {
    observed = (await api.state("idempotent", first.namespace)).body;
    if (observed.inflight > 0) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  } while (Date.now() < deadline);
  assert.equal(observed.inflight, 1);
  assert.equal((await api.clear("idempotent", first.namespace)).status, 409);
  const receipt = await pending;
  assert.equal((await api.clear("idempotent", first.namespace)).body.cleared, true);
  const clean = (await api.state("idempotent", first.namespace)).body;
  assert.deepEqual(clean.orders, []);
  assert.deepEqual(clean.attempts, []);
  const afterClear = await api.post("idempotent", { ...first, attempt_id: randomUUID() });
  assert.equal(afterClear.status, 201);
  assert.notEqual(afterClear.body.order.id, receipt.body.order.id);
});

test("readback validation rejects missing and cross-experiment state instead of inventing a zero-order observation", async () => {
  const { validateWriteState, WriteInfrastructureError } = await import("../benchmarks/lab/write-integrity.mjs");
  const identity = { mode: "idempotent", namespace: "unit-test" };
  const valid = { fixture: "vibeguru-write-integrity", ...identity, orders: [], attempts: [], inflight: 0 };
  assert.equal(validateWriteState(valid, identity), valid);
  for (const value of [null, {}, { ...valid, namespace: "another" }, { ...valid, orders: null }, { ...valid, inflight: -1 },
    { ...valid, orders: [{ id: "order-1", intent_id: "i", sku: "reliability-seat", quantity: 1, unit_price_cents: 2500 }] },
    { ...valid, attempts: [{ attempt_id: "a", intent_id: "i", sku: "reliability-seat", quantity: 1, status: 201 }] }]) {
    assert.throws(() => validateWriteState(value, identity), WriteInfrastructureError);
  }
});

test("the payload invariant and the duplicate-count invariant stay independent", async () => {
  const { ordersMatchIntent } = await import("../benchmarks/lab/write-integrity.mjs");
  const intent = { id: "logical-intent", sku: "reliability-seat", quantity: 2, unit_price_cents: 2500 };
  const persisted = { intent_id: intent.id, idempotency_key: intent.id, sku: intent.sku, quantity: 2, unit_price_cents: 2500, total_cents: 5000 };
  assert.equal(ordersMatchIntent([persisted, { ...persisted }], intent), true,
    "two correctly shaped duplicates must reach the separate final count assertion");
  assert.equal(ordersMatchIntent([], intent), false);
  for (const changed of [{ intent_id: "other" }, { idempotency_key: "other" }, { sku: "other" }, { quantity: 1 }, { unit_price_cents: 2400 }, { total_cents: 4999 }]) {
    assert.equal(ordersMatchIntent([{ ...persisted, ...changed }], intent), false);
  }
});

test("write cleanup cannot turn a primary assertion failure into expected-negative success", async () => {
  const { restoreWriteState, WriteInfrastructureError } = await import("../benchmarks/lab/write-integrity.mjs");
  const primary = Object.assign(new Error("Duplicate orders persisted"), { name: "JourneyAssertionError" });
  const cleanup = new WriteInfrastructureError("Readback connection lost during cleanup");
  const observations = [];
  await assert.rejects(restoreWriteState(async () => { throw cleanup; }, {
    primaryError: primary, observe: async (id, data) => observations.push({ id, data }),
  }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [primary, cleanup]);
    assert.notEqual(error.name, "JourneyAssertionError", "campaign scoring must see infrastructure failure");
    return true;
  });
  assert.deepEqual(observations, [{ id: "write-cleanup-error", data: { error: cleanup.message, original_failure_preserved: true } }]);
});

test("cleanup requires explicit empty-state proof and preserves failures when diagnostic recording also fails", async () => {
  const { restoreWriteState, WriteInfrastructureError } = await import("../benchmarks/lab/write-integrity.mjs");
  for (const invalid of [undefined, {}, { cleared: true, remaining_orders: 1, remaining_attempts: 0 }]) {
    const observed = [];
    await assert.rejects(restoreWriteState(async () => invalid, { observe: async (id, data) => observed.push({ id, data }) }), WriteInfrastructureError);
    assert.equal(observed[0].id, "write-cleanup-error");
  }
  const restored = { cleared: true, remaining_orders: 0, remaining_attempts: 0 };
  const observed = [];
  assert.equal(await restoreWriteState(async () => restored, { observe: async (id, data) => observed.push({ id, data }) }), restored);
  assert.deepEqual(observed, [{ id: "write-cleanup", data: restored }]);
  const cleanup = new Error("Cleanup failed");
  const sink = new Error("Observation sink unavailable");
  await assert.rejects(restoreWriteState(async () => { throw cleanup; }, { observe: async () => { throw sink; } }), error => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [cleanup, sink]);
    return true;
  });
});
