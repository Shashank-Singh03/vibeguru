"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const seedDocument = { title: "Original title", note: "Original note" };
async function fixture(t, options = { responseDelayMs: 0 }) {
  const { createConflictWorkbenchServer } = await import("../test-app/conflict-workbench/server.mjs");
  const server = createConflictWorkbenchServer(options);
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, options) => {
    const response = await fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(3000) });
    return { status: response.status, body: await response.json() };
  };
  const json = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { origin, request,
    seed: (mode, namespace, document = seedDocument) => request(`/api/${mode}/seed`, json("POST", { namespace, document })),
    write: (mode, payload) => request(`/api/${mode}/document`, json("PUT", payload)),
    state: (mode, namespace) => request(`/api/${mode}/state?${new URLSearchParams({ namespace })}`),
    clear: (mode, namespace) => request(`/api/${mode}/state?${new URLSearchParams({ namespace })}`, { method: "DELETE" }) };
}
const write = (namespace, overrides = {}) => ({ namespace, client_id: "A", attempt_id: randomUUID(), base_version: 1,
  document: { ...seedDocument, title: "Title from A" }, changed_fields: ["title"], ...overrides });
const second = namespace => write(namespace, { client_id: "B", document: { ...seedDocument, note: "Note from B" }, changed_fields: ["note"] });

test("vulnerable stale full-document writes actually lose the first client's distinct field", async t => {
  const api = await fixture(t), namespace = randomUUID();
  await api.seed("vulnerable", namespace);
  assert.equal((await api.write("vulnerable", write(namespace))).status, 200);
  assert.equal((await api.write("vulnerable", second(namespace))).status, 200);
  const { body } = await api.state("vulnerable", namespace);
  assert.deepEqual(body.document, { ...seedDocument, note: "Note from B", version: 3 });
  assert.deepEqual(body.history.map(commit => commit.version), [1, 2, 3]);
  assert.equal(body.history[1].document.title, "Title from A", "the overwritten edit was truly committed before the stale save");
  assert.equal(body.attempts[1].stale, true);
  assert.equal(body.attempts[1].base_version, 1);
});

test("version checking rejects a stale write without mutating committed state, then accepts a field-scoped reconciliation", async t => {
  const api = await fixture(t), namespace = randomUUID();
  await api.seed("versioned", namespace);
  await api.write("versioned", write(namespace));
  const rejected = await api.write("versioned", second(namespace));
  assert.equal(rejected.status, 409);
  assert.deepEqual(rejected.body.document, { title: "Title from A", note: seedDocument.note, version: 2 });
  const before = (await api.state("versioned", namespace)).body;
  assert.equal(before.history.length, 2);
  assert.equal(before.attempts.length, 2);
  assert.equal(before.attempts[1].result_version, 2);
  const { mergeChangedFields } = await import("../test-app/conflict-workbench/model.mjs");
  const merged = mergeChangedFields({ title: before.document.title, note: before.document.note }, second(namespace).document, ["note"]);
  const reply = await api.write("versioned", write(namespace, { client_id: "B", base_version: 2, document: merged, changed_fields: ["note"] }));
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body.document, { title: "Title from A", note: "Note from B", version: 3 });
  const final = (await api.state("versioned", namespace)).body;
  assert.deepEqual(final.attempts.map(attempt => attempt.status), [200, 409, 200]);
  const { consistentHistory } = await import("../benchmarks/lab/conflicting-writes.mjs");
  assert.equal(consistentHistory(final), true);
});

test("CAS comparison and commit are atomic for concurrent real HTTP requests at the same version", async t => {
  const api = await fixture(t, { responseDelayMs: 40 }), namespace = randomUUID();
  await api.seed("versioned", namespace);
  const replies = await Promise.all([api.write("versioned", write(namespace)), api.write("versioned", second(namespace))]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409]);
  const { body } = await api.state("versioned", namespace);
  assert.equal(body.document.version, 2);
  assert.equal(body.history.length, 2);
  assert.equal(body.attempts.length, 2);
  assert.equal(body.attempts.filter(attempt => attempt.status === 200).length, 1);
  assert.equal(body.inflight, 0);
  assert.equal(body.attempts[0].previous_version, 1);
  assert.equal(body.attempts[1].previous_version, 2);
});

test("serialized reload control preserves both edits in both modes and reversed stale order loses the other field", async t => {
  const api = await fixture(t);
  for (const mode of ["vulnerable", "versioned"]) {
    const namespace = randomUUID(); await api.seed(mode, namespace);
    await api.write(mode, write(namespace));
    const latest = (await api.state(mode, namespace)).body.document;
    assert.equal((await api.write(mode, write(namespace, { client_id: "B", base_version: latest.version,
      document: { title: latest.title, note: "Note from B" }, changed_fields: ["note"] }))).status, 200);
    assert.deepEqual((await api.state(mode, namespace)).body.document, { title: "Title from A", note: "Note from B", version: 3 });
  }
  const namespace = randomUUID(); await api.seed("vulnerable", namespace);
  await api.write("vulnerable", second(namespace)); await api.write("vulnerable", write(namespace));
  assert.deepEqual((await api.state("vulnerable", namespace)).body.document, { title: "Title from A", note: seedDocument.note, version: 3 });
});

test("reconciliation changes only declared dirty fields and leaves both input documents unmodified", async () => {
  const { mergeChangedFields, changedFields } = await import("../test-app/conflict-workbench/model.mjs");
  const latest = { title: "Remote title", note: "Remote note" }, draft = { title: "Stale title", note: "Local note" };
  assert.deepEqual(mergeChangedFields(latest, draft, ["note"]), { title: "Remote title", note: "Local note" });
  assert.deepEqual(mergeChangedFields(latest, draft, ["title"]), { title: "Stale title", note: "Remote note" });
  assert.deepEqual(changedFields(seedDocument, { ...seedDocument, note: "Local note" }), ["note"]);
  assert.deepEqual(latest, { title: "Remote title", note: "Remote note" });
  assert.deepEqual(draft, { title: "Stale title", note: "Local note" });
  for (const fields of [[], ["version"], ["note", "note"], null]) assert.throws(() => mergeChangedFields(latest, draft, fields), TypeError);
});

test("accepted versioned writes reject invalid or undeclared field changes without changing document or history", async t => {
  const api = await fixture(t), namespace = randomUUID(); await api.seed("versioned", namespace);
  for (const change of [{ changed_fields: ["note"] }, { changed_fields: ["title", "title"] }, { changed_fields: ["version"] },
    { base_version: 0 }, { base_version: 10 }, { document: { title: "New", note: "New", extra: "unapproved" } },
    { document: { title: "New" } }, { document: { title: "New", note: "New" }, changed_fields: ["title"] }]) {
    assert.equal((await api.write("versioned", write(namespace, change))).status, 400);
  }
  const { body } = await api.state("versioned", namespace);
  assert.deepEqual(body.document, { ...seedDocument, version: 1 });
  assert.equal(body.history.length, 1); assert.equal(body.attempts.length, 0);
});

test("namespaces and modes remain isolated, and attempts cannot be replayed under one identity", async t => {
  const api = await fixture(t), a = randomUUID(), b = randomUUID();
  for (const [mode, namespace] of [["versioned", a], ["versioned", b], ["vulnerable", a]]) await api.seed(mode, namespace);
  const payload = write(a); await api.write("versioned", payload);
  assert.equal((await api.write("versioned", payload)).status, 409);
  assert.equal((await api.state("versioned", a)).body.attempts.length, 1);
  for (const [mode, namespace] of [["versioned", b], ["vulnerable", a]]) {
    const { body } = await api.state(mode, namespace);
    assert.deepEqual(body.document, { ...seedDocument, version: 1 }); assert.deepEqual(body.attempts, []);
  }
  assert.equal((await api.seed("versioned", a)).status, 409, "seeding cannot erase committed work");
});

test("cleanup rejects active responses, then independently proves document, history and attempts removed", async t => {
  const api = await fixture(t, { responseDelayMs: 200 }), namespace = randomUUID(); await api.seed("versioned", namespace);
  const pending = api.write("versioned", write(namespace));
  let state; const deadline = Date.now() + 1500;
  do {
    state = (await api.state("versioned", namespace)).body;
    if (state.inflight > 0) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  } while (Date.now() < deadline);
  assert.equal(state.inflight, 1);
  assert.equal((await api.clear("versioned", namespace)).status, 409);
  await pending;
  const cleared = await api.clear("versioned", namespace);
  assert.equal(cleared.status, 200); assert.equal(cleared.body.removed_document, true);
  assert.equal(cleared.body.removed_history, 2); assert.equal(cleared.body.removed_attempts, 1);
  const empty = (await api.state("versioned", namespace)).body;
  assert.equal(empty.document, null); assert.deepEqual(empty.history, []); assert.deepEqual(empty.attempts, []); assert.equal(empty.inflight, 0);
  assert.equal((await api.seed("versioned", namespace)).status, 201);
});

test("authoritative validation rejects malformed or cross-experiment state and history checking detects contradictory commits", async t => {
  const { validateConflictState, consistentHistory, ConflictInfrastructureError } = await import("../benchmarks/lab/conflicting-writes.mjs");
  const api = await fixture(t), namespace = randomUUID(); await api.seed("versioned", namespace); await api.write("versioned", write(namespace));
  const identity = { mode: "versioned", namespace }, valid = (await api.state("versioned", namespace)).body;
  assert.equal(validateConflictState(valid, identity), valid); assert.equal(consistentHistory(valid), true);
  for (const value of [null, {}, { ...valid, namespace: "other" }, { ...valid, document: {} }, { ...valid, inflight: -1 },
    { ...valid, attempts: [{}] }, { ...valid, history: null }, { ...valid, document: { ...valid.document, version: NaN } }]) {
    assert.throws(() => validateConflictState(value, identity), ConflictInfrastructureError);
  }
  for (const mutate of [value => { value.history[1].version = 3; }, value => { value.document.note = "not committed"; },
    value => { value.attempts[0].previous_version = 2; }, value => { value.history[1].changed_fields = ["note"]; },
    value => { value.attempts.push(structuredClone(value.attempts[0])); }]) {
    const changed = structuredClone(valid); mutate(changed); assert.equal(consistentHistory(changed), false);
  }
});

test("restoration failure aggregates with the primary assertion so expected-negative scoring cannot accept it", async () => {
  const { restoreConflictState, ConflictInfrastructureError } = await import("../benchmarks/lab/conflicting-writes.mjs");
  const primary = Object.assign(new Error("Lost edit"), { name: "JourneyAssertionError" });
  const cleanup = new ConflictInfrastructureError("Cleanup readback failed"), observations = [];
  await assert.rejects(restoreConflictState(async () => { throw cleanup; }, { primaryError: primary,
    observe: async (id, payload) => observations.push({ id, payload }) }), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [primary, cleanup]); assert.notEqual(error.name, "JourneyAssertionError"); return true;
  });
  assert.equal(observations[0].id, "conflict-cleanup-error"); assert.equal(observations[0].payload.original_failure_preserved, true);
});

test("cleanup requires actual empty-state and closed-context proof, preserving diagnostic failures", async () => {
  const { restoreConflictState, ConflictInfrastructureError } = await import("../benchmarks/lab/conflicting-writes.mjs");
  const proof = { cleared: true, secondary_context_closed: true, primary_view_reset: true, remaining_primary_frames: 1,
    remaining_document: false, remaining_history: 0, remaining_attempts: 0, inflight: 0 };
  const observed = [];
  assert.equal(await restoreConflictState(async () => proof, { observe: async (id, payload) => observed.push({ id, payload }) }), proof);
  assert.equal(observed[0].id, "conflict-cleanup");
  for (const value of [undefined, {}, { ...proof, secondary_context_closed: false }, { ...proof, primary_view_reset: false },
    { ...proof, remaining_primary_frames: 2 }, { ...proof, remaining_document: true },
    { ...proof, remaining_history: 1 }, { ...proof, remaining_attempts: 1 }, { ...proof, inflight: 1 }]) {
    await assert.rejects(restoreConflictState(async () => value, { observe: async () => {} }), ConflictInfrastructureError);
  }
  const cleanup = new Error("Restore unavailable"), diagnostic = new Error("Observation sink unavailable");
  await assert.rejects(restoreConflictState(async () => { throw cleanup; }, { observe: async () => { throw diagnostic; } }), error => {
    assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [cleanup, diagnostic]); return true;
  });
});
