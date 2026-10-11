// Business-specific selectors and stale-write policy stay in this adapter.
import { randomUUID } from "node:crypto";

export const checks = ["conflict-clients-seeded", "conflict-first-write-committed", "conflict-second-write-observed",
  "conflict-draft-preserved", "conflict-history-consistent", "conflict-clients-converged", "both-edits-preserved"];
const fixtureId = "vibeguru-conflict-workbench";
const variants = ["conflict-serial", "conflict-stale", "conflict-reversed"];
const sessions = new WeakMap();
const fields = ["title", "note"];
const content = value => ({ title: value.title, note: value.note });
const sameContent = (a, b) => a.title === b.title && a.note === b.note;
const token = value => typeof value === "string" && value.length > 0;
const natural = value => Number.isInteger(value) && value >= 0;
const version = value => Number.isInteger(value) && value > 0;
const documentShape = value => value && typeof value.title === "string" && typeof value.note === "string";
const dirtyShape = value => Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every(field => fields.includes(field));

export class ConflictInfrastructureError extends Error {
  constructor(message, options) { super(message, options); this.name = "ConflictInfrastructureError"; }
}
async function until(read, matches, label, timeoutMs = 5000) {
  const started = Date.now(); let value;
  do {
    value = await read();
    if (matches(value)) return value;
    if (Date.now() - started >= timeoutMs) break;
    await new Promise(done => setTimeout(done, 20));
  } while (true);
  throw new ConflictInfrastructureError(`${label} was not observable within ${timeoutMs}ms`);
}
export function validateConflictState(value, { mode, namespace }) {
  if (!value || value.fixture !== fixtureId || value.mode !== mode || value.namespace !== namespace || !natural(value.inflight) ||
      !(value.document === null || documentShape(value.document) && version(value.document.version)) ||
      !Array.isArray(value.history) || !Array.isArray(value.attempts) || value.history.some(entry => !entry || !version(entry.version) ||
        !(entry.base_version === null || version(entry.base_version)) || !token(entry.client_id) ||
        !(entry.attempt_id === null || token(entry.attempt_id)) || !Array.isArray(entry.changed_fields) || !documentShape(entry.document)) ||
      value.attempts.some(entry => !entry || !token(entry.attempt_id) || !token(entry.client_id) || !version(entry.base_version) ||
        !version(entry.previous_version) || !version(entry.result_version) || ![200, 409].includes(entry.status) ||
        typeof entry.stale !== "boolean" || !dirtyShape(entry.changed_fields) || !documentShape(entry.document))) {
    throw new ConflictInfrastructureError("Authoritative conflict readback is missing, malformed or belongs to another experiment");
  }
  return value;
}
export function consistentHistory(state) {
  if (!state.document || state.history.length !== 1 + state.attempts.filter(attempt => attempt.status === 200).length) return false;
  const seed = state.history[0];
  if (!seed || seed.version !== 1 || seed.base_version !== null || seed.attempt_id !== null || seed.client_id !== "seed" || seed.changed_fields.length !== 0) return false;
  if (new Set(state.attempts.map(attempt => attempt.attempt_id)).size !== state.attempts.length) return false;
  let current = 1, commitIndex = 1;
  for (const attempt of state.attempts) {
    if (attempt.previous_version !== current || attempt.result_version !== current + (attempt.status === 200 ? 1 : 0) ||
        attempt.stale !== (attempt.base_version !== current)) return false;
    if (attempt.status === 200) {
      const commit = state.history[commitIndex++]; current++;
      if (commit.version !== current || commit.base_version !== attempt.base_version || commit.attempt_id !== attempt.attempt_id ||
          commit.client_id !== attempt.client_id || !sameContent(commit.document, attempt.document) ||
          commit.changed_fields.length !== attempt.changed_fields.length || commit.changed_fields.some(field => !attempt.changed_fields.includes(field))) return false;
    }
  }
  return state.document.version === current && sameContent(state.document, state.history.at(-1).document);
}
export async function restoreConflictState(restore, { observe, primaryError = null }) {
  try {
    const proof = await restore();
    if (!proof || proof.cleared !== true || proof.secondary_context_closed !== true || proof.primary_view_reset !== true || proof.remaining_primary_frames !== 1 || proof.remaining_document !== false ||
        proof.remaining_history !== 0 || proof.remaining_attempts !== 0 || proof.inflight !== 0) {
      throw new ConflictInfrastructureError("Conflict cleanup did not prove reset clients and an empty isolated namespace");
    }
    await observe("conflict-cleanup", proof);
    return proof;
  } catch (cleanupError) {
    let failure = cleanupError;
    try { await observe("conflict-cleanup-error", { error: String(cleanupError?.message || cleanupError), original_failure_preserved: primaryError !== null }); }
    catch (observationError) { failure = new AggregateError([cleanupError, observationError], "Conflict cleanup and diagnostic recording both failed"); }
    if (primaryError !== null) throw new AggregateError([primaryError, failure], "Conflict experiment and restoration both failed");
    throw failure;
  }
}
async function api(session, resource, options = {}) {
  try {
    const response = await fetch(`${session.origin}/api/${session.mode}/${resource}`, { ...options, signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new ConflictInfrastructureError(`Conflict oracle returned HTTP ${response.status}`);
    const body = await response.json();
    if (body.fixture !== fixtureId || body.mode !== session.mode || body.namespace !== session.namespace) throw new ConflictInfrastructureError("Conflict oracle response identity mismatch");
    return body;
  } catch (error) {
    if (error instanceof ConflictInfrastructureError) throw error;
    throw new ConflictInfrastructureError("Conflict oracle could not be reached or returned unreadable JSON", { cause: error });
  }
}
const readState = async session => validateConflictState(await api(session, `state?${new URLSearchParams({ namespace: session.namespace })}`), session);
async function clearState(session) {
  await until(() => readState(session), state => state.inflight === 0, "Settled conflict writes before cleanup", 3000);
  const cleared = await api(session, `state?${new URLSearchParams({ namespace: session.namespace })}`, { method: "DELETE" });
  if (cleared.cleared !== true) throw new ConflictInfrastructureError("Conflict backend did not acknowledge cleanup");
  const after = await readState(session);
  return { cleared: true, removed_history: cleared.removed_history, removed_attempts: cleared.removed_attempts,
    remaining_document: after.document !== null, remaining_history: after.history.length, remaining_attempts: after.attempts.length, inflight: after.inflight };
}
async function isolate(page, origin) {
  page.setDefaultTimeout(5000);
  await page.route("**/*", route => {
    const target = new URL(route.request().url());
    return target.origin === origin || ["data:", "blob:"].includes(target.protocol) ? route.continue() : route.abort("blockedbyclient");
  });
}
function track(page, client, experiment) {
  const requestMap = new Map();
  const onRequest = request => {
    const url = new URL(request.url());
    if (url.origin !== experiment.origin || url.pathname !== `/api/${experiment.mode}/document` || request.method() !== "PUT") return;
    let body; try { body = request.postDataJSON(); } catch { return; }
    if (body.namespace !== experiment.namespace) return;
    const item = { client, body, status: null, response: null, error: null, started_at: Date.now(), completed_at: null };
    requestMap.set(request, item); experiment.requests.push(item);
  };
  const onResponse = async response => {
    const item = requestMap.get(response.request()); if (!item) return;
    try {
      item.status = response.status(); const error = await response.finished(); if (error) throw error;
      item.response = await response.json();
    } catch (error) { item.error = String(error?.message || error); }
    finally { item.completed_at = Date.now(); }
  };
  const onFailed = request => {
    const item = requestMap.get(request);
    if (item) { item.error = request.failure()?.errorText || "Request failed"; item.completed_at = Date.now(); }
    experiment.runtime.push({ client, type: "request_failed", message: request.failure()?.errorText || "Request failed", url: request.url() });
  };
  const onPageError = error => experiment.runtime.push({ client, type: "page_error", message: String(error.message), url: page.url() });
  const onConsole = message => {
    if (message.type() === "error") experiment.runtime.push({ client, type: "console_error", message: message.text(), url: message.location().url || page.url() });
  };
  page.on("request", onRequest); page.on("response", onResponse); page.on("requestfailed", onFailed);
  page.on("pageerror", onPageError); page.on("console", onConsole);
  return () => { page.off("request", onRequest); page.off("response", onResponse); page.off("requestfailed", onFailed);
    page.off("pageerror", onPageError); page.off("console", onConsole); };
}
async function ui(page) {
  return page.locator("#status").evaluate(element => {
    const $ = id => document.getElementById(id);
    return { state: element.dataset.state, client_id: $("identity").dataset.client, settled: Number(element.dataset.settled), last_status: Number(element.dataset.lastStatus),
      base_version: Number($("base-version").textContent), draft: { title: $("title").value, note: $("note").value },
      latest: { title: $("server-title").textContent, note: $("server-note").textContent, version: Number($("server-version").textContent) },
      dirty_fields: $("pending-fields").textContent === "none" ? [] : $("pending-fields").textContent.split(", "),
      conflict_visible: !$("conflict").hidden, error: $("error").hidden ? null : $("error").textContent,
      receipts: [...$("receipts").children].map(item => JSON.parse(item.dataset.receipt)) };
  });
}
async function ready(page) {
  return until(async () => {
    const value = await ui(page); if (value.state === "error") throw new ConflictInfrastructureError(value.error || "Client failed to load"); return value;
  }, value => value.state === "ready", "Ready conflict client");
}
async function openPrimary(page, namespace, expected = "ready") {
  await until(async () => {
    const value = await ui(page); return value;
  }, value => !["loading", "saving"].includes(value.state), "Available primary namespace control");
  await page.getByLabel("Document namespace", { exact: true }).fill(namespace);
  await page.getByRole("button", { name: "Open document", exact: true }).click();
  return until(async () => {
    const value = await ui(page);
    if (value.state === "error") throw new ConflictInfrastructureError(value.error || "Primary namespace could not be opened");
    return value;
  }, value => value.state === expected, `Primary namespace ${expected}`);
}
async function submit(page, experiment, { field, value, reconcile = false }) {
  const previous = await ui(page), start = experiment.requests.length;
  if (reconcile) await page.getByRole("button", { name: "Reconcile conflict", exact: true }).click();
  else { await page.getByLabel(field === "title" ? "Title" : "Note", { exact: true }).fill(value);
    await page.getByRole("button", { name: "Save document", exact: true }).click(); }
  return until(async () => {
    const state = await ui(page), requests = experiment.requests.slice(start);
    if (state.state === "error" || requests.some(item => item.error || item.status !== null && ![200, 409].includes(item.status))) {
      throw new ConflictInfrastructureError(state.error || "A document write failed outside the declared conflict protocol");
    }
    return { ui: state, requests };
  }, value => ["ready", "conflict"].includes(value.ui.state) && value.ui.settled === previous.settled + 1 && value.requests.length === 1 &&
    value.requests[0].response !== null && value.requests[0].completed_at !== null, "Completed document acknowledgement");
}
function requestsMatchOracle(experiment, state) {
  return experiment.requests.length === state.attempts.length && experiment.requests.every(request => {
    const attempt = state.attempts.find(value => value.attempt_id === request.body.attempt_id);
    const receipt = request.response?.attempt;
    return attempt && request.client === request.body.client_id && request.status === attempt.status &&
      request.response?.fixture === fixtureId && request.response.mode === experiment.mode && request.response.namespace === experiment.namespace &&
      receipt?.attempt_id === attempt.attempt_id && receipt.client_id === attempt.client_id && receipt.status === attempt.status &&
      receipt.base_version === attempt.base_version && receipt.previous_version === attempt.previous_version && receipt.result_version === attempt.result_version &&
      request.response.document?.version === attempt.result_version && attempt.client_id === request.body.client_id &&
      attempt.base_version === request.body.base_version && sameContent(attempt.document, request.body.document) &&
      sameContent(receipt.document, attempt.document) && attempt.changed_fields.length === request.body.changed_fields.length &&
      attempt.changed_fields.every(field => request.body.changed_fields.includes(field));
  });
}

export async function setup(page, { config }) {
  const url = new URL(config.url), mode = url.searchParams.get("mode") || "vulnerable";
  const variant = process.env.VIBEGURU_LAB_VARIANT || "conflict-serial";
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      !["vulnerable", "versioned"].includes(mode) || !variants.includes(variant)) throw new ConflictInfrastructureError("Unsupported local conflict fixture, mode or variant");
  if (!page.context().browser()) throw new ConflictInfrastructureError("A separate browser context is required for client B");
  try {
    const response = await fetch(`${url.origin}/api/health`, { signal: AbortSignal.timeout(3000) });
    const health = await response.json();
    if (!response.ok || health.fixture !== fixtureId || health.conflict_status !== 409) throw new Error("Unexpected health response");
  } catch (error) { throw new ConflictInfrastructureError("The expected conflict fixture is not available", { cause: error }); }
  sessions.set(page, { origin: url.origin, mode, variant });
  await isolate(page, url.origin);
}

export default async function flow(page, { cycle, check, observe, mark }) {
  const session = sessions.get(page);
  if (!session || typeof observe !== "function") throw new ConflictInfrastructureError("Conflict setup and structured observations are required");
  const experiment = { ...session, namespace: `conflict-${randomUUID()}`, requests: [], runtime: [] };
  const record = (id, payload) => observe(id, { experiment: "conflicting-writes", mode: session.mode, variant: session.variant, cycle, namespace: experiment.namespace, ...payload });
  let secondary = null, primaryError = null; const detach = [];
  try {
    const seed = { title: `Initial title ${cycle}`, note: `Initial note ${cycle}` };
    const intended = { title: `Title from A ${cycle}`, note: `Note from B ${cycle}` };
    await api(experiment, "seed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ namespace: experiment.namespace, document: seed }) });
    secondary = await page.context().browser().newContext();
    const other = await secondary.newPage(); await isolate(other, session.origin);
    detach.push(track(page, "A", experiment), track(other, "B", experiment));
    const clientUrl = client => `${session.origin}/?${new URLSearchParams({ mode: session.mode, namespace: experiment.namespace, client })}`;
    // Keep A's measured main document and route stable across cycles. B is a
    // separate, fresh context and is outside primary-page retention measurement.
    await Promise.all([openPrimary(page, experiment.namespace), other.goto(clientUrl("B"))]);
    const [a, b] = await Promise.all([ready(page), ready(other)]), initial = await readState(experiment);
    await record("conflict-seeded", { seed, intended, clients: { A: a, B: b }, oracle: initial,
      distinct_browser_contexts: secondary !== page.context(), schedule: session.variant === "conflict-reversed" ? ["B:note", "A:title"] : ["A:title", "B:note"],
      primary_runtime_scope: "Only client A is measured by the engine; both clients are checked and their adapter runtime events retained" });
    check("conflict-clients-seeded", secondary !== page.context() && a.client_id === "A" && b.client_id === "B" && a.base_version === 1 && b.base_version === 1 &&
      sameContent(a.draft, seed) && sameContent(b.draft, seed) && initial.document?.version === 1 && initial.history.length === 1 && initial.attempts.length === 0,
    "Two isolated browser clients load the same authoritative seed version");
    const reversed = session.variant === "conflict-reversed", stale = session.variant !== "conflict-serial";
    const first = reversed ? other : page, second = reversed ? page : other;
    const firstField = reversed ? "note" : "title", secondField = reversed ? "title" : "note";
    const firstWrite = await submit(first, experiment, { field: firstField, value: intended[firstField] });
    const firstOracle = await readState(experiment), firstExpected = { ...seed, [firstField]: intended[firstField] };
    await record("conflict-first-write", { client: reversed ? "B" : "A", acknowledgement: firstWrite, oracle: firstOracle });
    check("conflict-first-write-committed", firstWrite.ui.last_status === 200 && firstOracle.document?.version === 2 &&
      sameContent(firstOracle.document, firstExpected) && firstOracle.history.length === 2 && firstOracle.attempts.length === 1,
    "The first client receives a real acknowledgement and its edit is committed at version 2");
    if (!stale) { await second.getByRole("button", { name: "Reload document", exact: true }).click(); await ready(second); }
    const secondWrite = await submit(second, experiment, { field: secondField, value: intended[secondField] });
    const secondOracle = await readState(experiment), conflictExpected = session.mode === "versioned" && stale;
    await record("conflict-second-write", { client: reversed ? "A" : "B", conflict_expected: conflictExpected, acknowledgement: secondWrite, oracle: secondOracle });
    check("conflict-second-write-observed", secondWrite.ui.last_status === (conflictExpected ? 409 : 200) &&
      secondOracle.attempts.length === 2 && secondOracle.document?.version === (conflictExpected ? 2 : 3) &&
      requestsMatchOracle(experiment, secondOracle) && secondOracle.attempts[1].base_version === (stale ? 1 : 2),
    "The second physical write and its actual accepted or rejected version are independently observable");
    const preserved = conflictExpected ? secondWrite.ui.state === "conflict" && secondWrite.ui.conflict_visible &&
      secondWrite.ui.base_version === 1 && secondWrite.ui.dirty_fields.length === 1 && secondWrite.ui.dirty_fields[0] === secondField &&
      secondWrite.ui.draft[secondField] === intended[secondField] && secondWrite.ui.draft[firstField] === seed[firstField] &&
      sameContent(secondWrite.ui.latest, firstExpected) && sameContent(secondOracle.document, firstExpected)
      : secondWrite.ui.state === "ready" && !secondWrite.ui.conflict_visible && secondWrite.ui.dirty_fields.length === 0;
    check("conflict-draft-preserved", preserved,
      "A rejected stale save visibly retains its local field and leaves the authoritative document unchanged; accepted saves clear the pending draft");
    if (conflictExpected) {
      const reconciled = await submit(second, experiment, { reconcile: true });
      await record("conflict-reconciled", { client: reversed ? "A" : "B", acknowledgement: reconciled, oracle: await readState(experiment),
        policy: "Reload latest and merge only the pending local changed field before a new version-checked save" });
    }
    const final = await readState(experiment);
    await Promise.all([page.getByRole("button", { name: "Reload document", exact: true }).click(), other.getByRole("button", { name: "Reload document", exact: true }).click()]);
    const [finalA, finalB] = await Promise.all([ready(page), ready(other)]);
    await record("conflict-result", { intended, oracle: final, clients: { A: finalA, B: finalB }, requests: experiment.requests, runtime_events: experiment.runtime });
    const unexpectedRuntime = experiment.runtime.filter(event => !(event.type === "console_error" && conflictExpected &&
      event.url === `${session.origin}/api/${session.mode}/document` && /409/.test(event.message)));
    if (unexpectedRuntime.length) throw new ConflictInfrastructureError("A browser error occurred outside the expected HTTP409 conflict protocol");
    check("conflict-history-consistent", final.document?.version === 3 && final.history.length === 3 && final.attempts.length === (conflictExpected ? 3 : 2) &&
      consistentHistory(final) && requestsMatchOracle(experiment, final) &&
      final.attempts.map(attempt => attempt.status).join(",") === (conflictExpected ? "200,409,200" : "200,200"),
    "Committed versions, rejected attempts and real browser receipts form one consistent authoritative history");
    check("conflict-clients-converged", finalA.base_version === final.document.version && finalB.base_version === final.document.version &&
      sameContent(finalA.draft, final.document) && sameContent(finalB.draft, final.document) &&
      !finalA.conflict_visible && !finalB.conflict_visible && finalA.dirty_fields.length === 0 && finalB.dirty_fields.length === 0,
    "Both reloaded browser views agree with the independent final server document");
    // This is the sole expected-negative invariant, after all prerequisites.
    check("both-edits-preserved", sameContent(final.document, intended),
      "The final authoritative document preserves A's title and B's distinct note edit");
  } catch (error) {
    primaryError = error;
    try { await record("conflict-execution-error", { error: String(error?.message || error), error_type: String(error?.name || "Error"), requests: experiment.requests, runtime_events: experiment.runtime }); }
    catch (observationError) { primaryError = new AggregateError([error, observationError], "Conflict experiment and diagnostic recording both failed"); }
    throw primaryError;
  } finally {
    await restoreConflictState(async () => {
      // Attempt both context close and backend cleanup, retaining either failure.
      detach.forEach(stop => stop());
      const failures = [];
      try { if (secondary) await secondary.close(); } catch (error) { failures.push(error); }
      // Stop the second client's execution before proving backend quiescence.
      // Still attempt backend cleanup if closing that context failed.
      let cleared;
      try { cleared = await clearState(experiment); } catch (error) { failures.push(error); }
      let reset;
      try {
        reset = await openPrimary(page, experiment.namespace, "empty");
        if (reset.base_version !== 0 || reset.latest.version !== 0 || reset.settled !== 0 || reset.dirty_fields.length !== 0 ||
            reset.draft.title !== "" || reset.draft.note !== "" || reset.conflict_visible) {
          throw new ConflictInfrastructureError("The primary client did not reset its draft and receipt state after cleanup");
        }
      } catch (error) { failures.push(error); }
      // Separate post-GC sampling from renderer teardown of the old draft and the
      // closed secondary client. This is a bounded settling window, not a claim
      // that all asynchronous work has completed or that future growth is safe.
      try {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.waitForTimeout(100);
        if (page.frames().length !== 1) throw new ConflictInfrastructureError("Unexpected frame remained after conflict cleanup");
      } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, "Conflict context or backend restoration failed");
      return { mode: session.mode, namespace: experiment.namespace, secondary_context_closed: true, primary_view_reset: true,
        remaining_primary_frames: page.frames().length, renderer_idle_ms: 100, ...cleared };
    }, { observe: record, primaryError });
  }
  // Success is sampled after clearing server and client state. Expected-negative
  // throws use the driver's automatic post-cleanup mark rather than skipping it.
  await mark("conflicting-writes");
}
