"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

async function fixture(t) {
  const { createStorageWorkbenchServer } = await import("../test-app/storage-workbench/server.mjs");
  const server = createStorageWorkbenchServer();
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => { await browser.close(); server.closeAllConnections(); await new Promise(done => server.close(done)); });
  return { browser, url: `http://127.0.0.1:${server.address().port}` };
}
async function scenario(app, variant, mode, mutate) {
  const old = process.env.VIBEGURU_LAB_VARIANT;
  process.env.VIBEGURU_LAB_VARIANT = variant;
  let adapter;
  try { adapter = await import(`${pathToFileURL(resolve("benchmarks/lab/storage-resilience.mjs"))}?qa=${variant}-${mode}-${Date.now()}`); }
  finally { if (old === undefined) delete process.env.VIBEGURU_LAB_VARIANT; else process.env.VIBEGURU_LAB_VARIANT = old; }
  const { journeyCheck, journeyObservation } = await import("../driver-node/lib/flow.js");
  const context = await app.browser.newContext(), page = await context.newPage(), events = [], runtimeErrors = [];
  page.on("pageerror", error => runtimeErrors.push(error.message));
  try {
    await adapter.setup(page, { config: { url: app.url } });
    await page.goto(`${app.url}/?mode=${mode}`);
    await mutate?.(page);
    let error;
    try {
      await adapter.default(page, { cycle: 1, mark: async () => {},
        check: journeyCheck(event => events.push(event), 1, () => page.url(), adapter.checks),
        observe: journeyObservation(event => events.push(event), 1, () => page.url()) });
    } catch (caught) { error = caught; }
    const remaining = await page.evaluate(() => ({ keys: Object.keys(localStorage), frames: document.querySelectorAll("iframe").length }));
    return { events, error, remaining, runtimeErrors };
  } finally { await context.close(); }
}
const observation = (result, id) => result.events.find(event => event.data.observationId === id)?.data.payload;

test("real persisted bytes, schema corruption and cold reloads distinguish a usable editor from broken startup", async t => {
  const app = await fixture(t);
  for (const variant of ["storage-normal", "storage-corrupt", "storage-shape"]) {
    for (const mode of ["vulnerable", "defensive"]) {
      const result = await scenario(app, variant, mode);
      const fail = mode === "vulnerable" && variant !== "storage-normal";
      assert.equal(result.error?.name, fail ? "JourneyAssertionError" : undefined, `${variant}/${mode}: ${result.error?.stack}`);
      assert.equal(result.error?.assertionId, fail ? "storage-recovery-contract" : undefined);
      assert.equal(result.events.filter(event => event.kind === "journey_assertion").length, 4);
      assert.equal(observation(result, "storage-condition").unrelated_key_usable, true);
      assert.equal(observation(result, "storage-result").read_recovered, !fail);
      assert.equal(observation(result, "storage-result").unrelated_storage_preserved, true);
      if (!fail) {
        assert.equal(observation(result, "storage-result").cold_reload.text, "Edited draft 1");
        assert.deepEqual(result.runtimeErrors, []);
      }
      assert.deepEqual(result.remaining, { keys: [], frames: 0 });
      assert.equal(observation(result, "storage-cleanup").cleared, true);
    }
  }
});

test("scoped access/quota exceptions require an honest unsaved state, retained input and explicit successful retry", async t => {
  const app = await fixture(t);
  for (const variant of ["storage-denied", "storage-quota"]) {
    for (const mode of ["vulnerable", "defensive"]) {
      const result = await scenario(app, variant, mode);
      assert.equal(result.error?.name, mode === "vulnerable" ? "JourneyAssertionError" : undefined, `${variant}/${mode}: ${result.error?.stack}`);
      const condition = observation(result, "storage-condition"), outcome = observation(result, "storage-result");
      assert.equal(condition.controlled_exception, true);
      assert.equal(condition.unrelated_key_usable, true);
      assert.equal(outcome.failed_write_honest, mode === "defensive");
      if (mode === "defensive") {
        assert.equal(outcome.first_save.text, "Edited draft 1");
        assert.match(outcome.first_save.status, /^Unsaved:/);
        assert.equal(outcome.persisted_after_retry, true);
        assert.equal(outcome.first_save_storage.raw, condition.seed, "Independent bytes are checked before the retry");
        assert.equal(outcome.first_save_storage.canary, "unrelated-value");
        assert.equal(outcome.blocked_write_preserved_existing_bytes, true);
        assert.equal(outcome.unrelated_storage_preserved, true);
        assert.equal(outcome.cold_reload.text, "Edited draft 1");
        assert.deepEqual(result.runtimeErrors, []);
      } else assert.ok(result.runtimeErrors.length > 0, "Uncaught exceptions in iframe are surfaced by the primary page");
      assert.deepEqual(result.remaining, { keys: [], frames: 0 });
    }
  }
});

test("missing editor JavaScript remains an infrastructure error and cannot satisfy a negative experiment", async t => {
  const app = await fixture(t);
  const result = await scenario(app, "storage-corrupt", "vulnerable", page => page.route("**/app.js", route => route.fulfill({ status: 503, body: "Missing app" })));
  assert.equal(result.error?.name, "Error");
  assert.match(result.error.message, /asset delivery failed/);
  assert.equal(result.events.some(event => event.data.assertionId === "storage-recovery-contract"), false);
  assert.deepEqual(result.remaining, { keys: [], frames: 0 });
  assert.equal(observation(result, "storage-cleanup").cleared, true);
});

test("failed namespace cleanup preserves the assertion failure and invalidates negative success", async t => {
  const app = await fixture(t);
  const result = await scenario(app, "storage-corrupt", "vulnerable", page => page.evaluate(() => {
    Storage.prototype.removeItem = () => { throw new Error("Controlled cleanup failure"); };
  }));
  assert.equal(result.error?.name, "AggregateError");
  assert.equal(result.error.errors[0].name, "JourneyAssertionError");
  assert.match(result.error.errors[1].message, /Controlled cleanup failure/);
  assert.equal(observation(result, "storage-cleanup"), undefined);
  assert.match(observation(result, "storage-cleanup-error").error, /Controlled cleanup failure/);
  assert.equal(observation(result, "storage-cleanup-error").original_failure_preserved, true);
  assert.equal(result.events.filter(event => event.kind === "journey_assertion" && event.data.status === "fail").length, 1);
});

test("a successful retry cannot hide destruction of existing draft bytes or unrelated storage during a failed save", async t => {
  const app = await fixture(t);
  for (const victim of ["target", "canary"]) {
    const result = await scenario(app, "storage-quota", "defensive", page => page.addInitScript(({ victim }) => {
      if (window === window.top) return;
      // Controlled regression exists only in the disposable browser context. It
      // simulates a destructive error handler before the app's blocked setItem.
      document.addEventListener("click", event => {
        if (event.target.id !== "save" || !window.__storageFault?.enabled || window.__storageFault.kind !== "quota") return;
        const key = new URL(location.href).searchParams.get("key");
        localStorage.removeItem(victim === "target" ? key : `${key}:canary`);
      }, true);
    }, { victim }));
    assert.equal(result.error?.name, "JourneyAssertionError");
    assert.equal(result.error.assertionId, "storage-recovery-contract");
    const outcome = observation(result, "storage-result");
    assert.equal(outcome.read_recovered, true);
    assert.equal(outcome.failed_write_honest, true);
    assert.equal(outcome.persisted_after_retry, true, "The final value and cold reload really succeed despite the earlier destructive handler");
    assert.equal(outcome.blocked_write_preserved_existing_bytes, victim !== "target");
    assert.equal(outcome.unrelated_storage_preserved, victim !== "canary");
    assert.equal(outcome.first_save_storage[victim === "target" ? "raw" : "canary"], null);
    const assertions = result.events.filter(event => event.kind === "journey_assertion");
    assert.equal(assertions.length, 4);
    assert.deepEqual(assertions.filter(event => event.data.status === "fail").map(event => event.data.assertionId), ["storage-recovery-contract"]);
    assert.deepEqual(result.runtimeErrors, []);
    assert.deepEqual(result.remaining, { keys: [], frames: 0 });
    assert.equal(observation(result, "storage-cleanup").cleared, true);
  }
});

test("cleanup diagnostic failures retain both causes and cannot preserve a primary JourneyAssertionError type", async () => {
  const { restoreStorageState } = await import("../benchmarks/lab/storage-resilience.mjs");
  const primary = Object.assign(new Error("Editor recovery failed"), { name: "JourneyAssertionError" });
  const cleanup = new Error("Storage cleanup failed"), diagnostic = new Error("Observation sink failed");
  for (const primaryError of [null, primary]) {
    await assert.rejects(restoreStorageState(async () => { throw cleanup; }, {
      key: "vibeguru-storage:unit", primaryError, observe: async () => { throw diagnostic; },
    }), error => {
      assert.ok(error instanceof AggregateError);
      assert.notEqual(error.name, "JourneyAssertionError");
      if (primaryError) {
        assert.equal(error.errors[0], primary);
        assert.ok(error.errors[1] instanceof AggregateError);
        assert.deepEqual(error.errors[1].errors, [cleanup, diagnostic]);
      } else assert.deepEqual(error.errors, [cleanup, diagnostic]);
      return true;
    });
  }
  const observed = [];
  await assert.rejects(restoreStorageState(async () => { throw cleanup; }, {
    key: "vibeguru-storage:unit", observe: async (id, payload) => observed.push({ id, payload }),
  }), error => error === cleanup);
  assert.deepEqual(observed, [{ id: "storage-cleanup-error", payload: {
    key: "vibeguru-storage:unit", error: cleanup.message, error_type: "Error", original_failure_preserved: false,
  } }]);
});
