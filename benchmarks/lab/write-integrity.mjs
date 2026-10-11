// Real writes to the isolated fixture and independent backend readback. Selectors
// and business invariants live here, never in the measurement engine.
import { randomUUID } from "node:crypto";

export const checks = ["write-intent-ready", "write-requests-completed", "write-intent-stable",
  "persisted-order-matches-intent", "ui-order-count-matches-oracle", "single-persisted-order"];
const sessions = new WeakMap();
const variants = ["write-single", "write-double", "write-retry"];
const fixtureId = "vibeguru-write-integrity";

export class WriteInfrastructureError extends Error {
  constructor(message, options) { super(message, options); this.name = "WriteInfrastructureError"; }
}

async function until(read, matches, label, timeoutMs = 5000) {
  const started = Date.now();
  let value;
  do {
    value = await read();
    if (matches(value)) return value;
    if (Date.now() - started >= timeoutMs) break;
    await new Promise(done => setTimeout(done, 20));
  } while (true);
  throw new WriteInfrastructureError(`${label} was not observable within ${timeoutMs}ms`);
}

export function validateWriteState(value, { mode, namespace }) {
  const token = value => typeof value === "string" && value.length > 0;
  const natural = value => Number.isInteger(value) && value >= 0;
  if (!value || value.fixture !== fixtureId || value.mode !== mode || value.namespace !== namespace ||
      !Array.isArray(value.orders) || !Array.isArray(value.attempts) || !natural(value.inflight) ||
      value.orders.some(order => !order || !token(order.id) || !token(order.intent_id) || !token(order.sku) ||
        !natural(order.quantity) || !natural(order.unit_price_cents) || !natural(order.total_cents)) ||
      value.attempts.some(attempt => !attempt || !token(attempt.attempt_id) || !token(attempt.intent_id) ||
        !token(attempt.sku) || !natural(attempt.quantity) || !Number.isInteger(attempt.status) || typeof attempt.replayed !== "boolean")) {
    throw new WriteInfrastructureError("Authoritative backend readback is missing, malformed or belongs to another experiment");
  }
  return value;
}

export function ordersMatchIntent(orders, intent) {
  return orders.length > 0 && orders.every(order => order.intent_id === intent.id && order.idempotency_key === intent.id &&
    order.sku === intent.sku && order.quantity === intent.quantity && order.unit_price_cents === intent.unit_price_cents &&
    order.total_cents === intent.quantity * intent.unit_price_cents);
}

export async function restoreWriteState(restore, { observe, primaryError = null }) {
  try {
    const restored = await restore();
    if (!restored || restored.cleared !== true || restored.remaining_orders !== 0 || restored.remaining_attempts !== 0) {
      throw new WriteInfrastructureError("Write fixture cleanup did not prove an empty isolated namespace");
    }
    await observe("write-cleanup", restored);
    return restored;
  } catch (cleanupError) {
    let failure = cleanupError;
    try {
      await observe("write-cleanup-error", { error: String(cleanupError?.message || cleanupError), original_failure_preserved: primaryError !== null });
    } catch (observationError) {
      failure = new AggregateError([cleanupError, observationError], "Write fixture cleanup and its diagnostic recording both failed");
    }
    if (primaryError !== null) throw new AggregateError([primaryError, failure], "Order invariant and write fixture cleanup both failed");
    throw failure;
  }
}

async function api(session, resource, options = {}) {
  let response;
  try {
    response = await fetch(`${session.origin}/api/${session.mode}/${resource}`, { ...options, signal: AbortSignal.timeout(3000) });
  } catch (error) { throw new WriteInfrastructureError("Write fixture backend could not be reached", { cause: error }); }
  if (!response.ok) throw new WriteInfrastructureError(`Write fixture backend returned HTTP ${response.status}`);
  try { return await response.json(); }
  catch (error) { throw new WriteInfrastructureError("Write fixture backend returned unreadable JSON", { cause: error }); }
}

async function readState(session) {
  return validateWriteState(await api(session, `state?${new URLSearchParams({ namespace: session.namespace })}`), session);
}

async function clearState(session) {
  await until(() => readState(session), state => state.inflight === 0, "Settled backend writes before cleanup", 3000);
  const cleared = await api(session, `state?${new URLSearchParams({ namespace: session.namespace })}`, { method: "DELETE" });
  if (cleared.fixture !== fixtureId || cleared.cleared !== true) throw new WriteInfrastructureError("Backend did not acknowledge namespace cleanup");
  const after = await readState(session);
  return { mode: session.mode, namespace: session.namespace, cleared: true,
    removed_orders: cleared.removed_orders, removed_attempts: cleared.removed_attempts,
    remaining_orders: after.orders.length, remaining_attempts: after.attempts.length };
}

export async function setup(page, { config }) {
  const url = new URL(config.url);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new WriteInfrastructureError("This adapter only targets the isolated local write-integrity fixture");
  }
  const mode = url.searchParams.get("mode") || "vulnerable";
  const variant = process.env.VIBEGURU_LAB_VARIANT || "write-single";
  if (!["vulnerable", "idempotent"].includes(mode) || !variants.includes(variant)) throw new WriteInfrastructureError("Unsupported write experiment mode or variant");
  const healthResponse = await fetch(`${url.origin}/api/health`, { signal: AbortSignal.timeout(3000) });
  if (!healthResponse.ok) throw new WriteInfrastructureError(`Fixture health returned HTTP ${healthResponse.status}`);
  const health = await healthResponse.json();
  if (health.fixture !== fixtureId || health.unit_price_cents !== 2500) throw new WriteInfrastructureError("The server does not identify the expected write-integrity fixture");
  const session = { origin: url.origin, mode, variant, namespace: `write-${randomUUID()}`, records: [], requests: new Map() };
  sessions.set(page, session);
  page.setDefaultTimeout(5000);
  await page.route("**/*", route => {
    const target = new URL(route.request().url());
    return target.origin === url.origin || ["data:", "blob:"].includes(target.protocol) ? route.continue() : route.abort("blockedbyclient");
  });
  await page.addInitScript(({ origin, mode, namespace }) => {
    if (location.origin !== origin) return;
    const current = new URL(location.href);
    current.searchParams.set("mode", mode);
    current.searchParams.set("namespace", namespace);
    history.replaceState(history.state, "", current.href);
  }, { origin: url.origin, mode, namespace: session.namespace });
  session.onRequest = request => {
    const target = new URL(request.url());
    if (target.origin !== session.origin || target.pathname !== `/api/${mode}/orders` || request.method() !== "POST") return;
    let body;
    try { body = request.postDataJSON(); } catch { return; }
    if (body.namespace !== session.namespace) return;
    const record = { body, started_at: Date.now(), completed_at: null, status: null, response: null, error: null };
    session.records.push(record);
    session.requests.set(request, record);
  };
  session.onResponse = async response => {
    const record = session.requests.get(response.request());
    if (!record) return;
    try {
      record.status = response.status();
      const error = await response.finished();
      if (error) throw error;
      record.response = await response.json();
    } catch (error) { record.error = String(error.message || error); }
    finally { record.completed_at = Date.now(); }
  };
  session.onFailed = request => {
    const record = session.requests.get(request);
    if (record) { record.error = request.failure()?.errorText || "Physical write request failed"; record.completed_at = Date.now(); }
  };
  page.on("request", session.onRequest);
  page.on("response", session.onResponse);
  page.on("requestfailed", session.onFailed);
}

export async function cleanup(page) {
  const session = sessions.get(page);
  if (!session) return;
  page.off("request", session.onRequest);
  page.off("response", session.onResponse);
  page.off("requestfailed", session.onFailed);
  sessions.delete(page);
}

async function completedWrites(page, session, start, expected) {
  return until(async () => {
    const ui = await page.locator("#status").evaluate(element => ({ pending: Number(element.dataset.pending), settled: Number(element.dataset.settled), state: element.dataset.state }));
    const records = session.records.slice(start);
    if (ui.state === "error" || records.some(record => record.error || record.status !== null && ![200, 201].includes(record.status))) {
      throw new WriteInfrastructureError("A physical write or application backend readback failed; this is not the expected duplicate-order assertion");
    }
    return { ui, records };
  }, value => value.ui.state === "ready" && value.ui.pending === 0 && value.ui.settled >= expected &&
    value.records.length >= expected && value.records.every(record => record.completed_at !== null && record.response !== null), "Completed physical write responses");
}

export default async function flow(page, { cycle, check, observe, mark }) {
  const session = sessions.get(page);
  if (!session || typeof observe !== "function") throw new WriteInfrastructureError("Write experiment setup and structured observations are required");
  const record = (id, payload) => observe(id, { experiment: "write-integrity", mode: session.mode, variant: session.variant, cycle, ...payload });
  let primaryError = null;
  let start = session.records.length;
  try {
    const before = await readState(session);
    if (before.orders.length || before.attempts.length || before.inflight) throw new WriteInfrastructureError("The write experiment namespace was not clean before this cycle");
    await page.getByRole("button", { name: "New order intent", exact: true }).click();
    const intent = { id: await page.getByLabel("Intent token", { exact: true }).inputValue(), sku: "reliability-seat", quantity: 1, unit_price_cents: 2500 };
    const expectedAttempts = session.variant === "write-single" ? 1 : 2;
    record("write-plan", { namespace: session.namespace, intent, expected_attempts: expectedAttempts,
      interaction: session.variant === "write-double" ? "native double-click, 10ms between clicks" : session.variant === "write-retry" ? "retry same intent after a successful acknowledgement" : "single submission",
      backend_persistence: "real isolated in-memory server; not durable across process restarts" });
    check("write-intent-ready", /^[a-z0-9-]{36}$/.test(intent.id), "The visible form exposes one logical order intent");
    start = session.records.length;
    const submit = page.getByRole("button", { name: "Place order", exact: true });
    if (session.variant === "write-double") await submit.dblclick({ delay: 10 });
    else await submit.click();
    if (session.variant === "write-retry") {
      const first = await completedWrites(page, session, start, 1);
      record("write-first-acknowledgement", { requests: first.records, ui: first.ui });
      await page.getByRole("button", { name: "Retry same order", exact: true }).click();
    }
    const completed = await completedWrites(page, session, start, expectedAttempts);
    const oracle = await readState(session);
    const visibleCount = Number(await page.locator("#persisted-count").innerText());
    record("write-result", { intent, expected_attempts: expectedAttempts, requests: completed.records,
      ui: { ...completed.ui, persisted_count: visibleCount }, oracle,
      request_overlap_observed: completed.records.length > 1 && completed.records[1].started_at < completed.records[0].completed_at });
    check("write-requests-completed", completed.records.length === expectedAttempts && oracle.attempts.length === expectedAttempts &&
      new Set(oracle.attempts.map(attempt => attempt.attempt_id)).size === expectedAttempts &&
      completed.records.every(request => request.response.fixture === fixtureId && request.response.mode === session.mode &&
        request.response.namespace === session.namespace && request.response.attempt_id === request.body.attempt_id &&
        oracle.attempts.some(attempt => attempt.attempt_id === request.body.attempt_id && [200, 201].includes(attempt.status) &&
          attempt.order_id === request.response.order?.id)),
    "Every planned physical request was acknowledged and recorded independently by the backend");
    check("write-intent-stable", completed.records.every(request => request.body.intent_id === intent.id && request.body.sku === intent.sku && request.body.quantity === intent.quantity) &&
      oracle.attempts.every(attempt => attempt.intent_id === intent.id && attempt.idempotency_key === intent.id),
    "Repeated physical requests preserve the same logical intent and idempotency key");
    check("persisted-order-matches-intent", ordersMatchIntent(oracle.orders, intent),
      "All persisted records match the intended product, quantity and authoritative price");
    check("ui-order-count-matches-oracle", Number.isInteger(visibleCount) && visibleCount === oracle.orders.length,
      "The visible persisted-order count agrees with independent backend readback");
    await mark("order-write-integrity");
    // Deliberate duplicate writes are the final assertion so prerequisites remain
    // visible in every expected-negative cycle rather than being skipped.
    check("single-persisted-order", oracle.orders.length === 1,
      "One logical order intent must produce exactly one persisted order after all physical requests complete");
  } catch (error) {
    primaryError = error;
    try {
      await record("write-execution-error", { error: String(error?.message || error), error_type: String(error?.name || "Error"),
        namespace: session.namespace, requests: session.records.slice(start) });
    } catch (observationError) {
      primaryError = new AggregateError([error, observationError], "Write experiment and failure-evidence recording both failed");
    }
    throw primaryError;
  }
  finally { await restoreWriteState(() => clearState(session), { observe: record, primaryError }); }
}
