import { randomUUID } from "node:crypto";
import { isolate } from "../desktop/common.mjs";
import { until, paint } from "./workbench.mjs";

export const checks = ["storage-seed-confirmed", "storage-cold-start-observed", "storage-condition-delivered", "storage-recovery-contract"];
const variant = process.env.VIBEGURU_LAB_VARIANT || "storage-corrupt";
const scenarios = { "storage-normal": "none", "storage-corrupt": "corrupt", "storage-shape": "shape", "storage-denied": "denied", "storage-quota": "quota" };
const runId = randomUUID();
export async function setup(page, { config }) { await isolate(page, config); page.setDefaultTimeout(3000); }

async function boot(page, options) {
  const asset = page.waitForResponse(response => new URL(response.url()).pathname === "/app.js");
  await page.evaluate(options => {
    document.querySelector("#editor-host").replaceChildren();
    const frame = document.createElement("iframe"); frame.id = "storage-editor";
    frame.title = "Cold-start draft editor";
    frame.src = `/editor.html?${new URLSearchParams(options)}`;
    document.querySelector("#editor-host").append(frame);
  }, options);
  const response = await asset;
  if (!response.ok() || await response.finished()) throw new Error("Editor asset delivery failed");
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.body?.dataset.boot);
  const handle = await page.locator("#storage-editor").elementHandle();
  const frame = await handle.contentFrame(); await handle.dispose();
  if (!frame) throw new Error("Cold editor document unavailable");
  return frame;
}
async function state(frame) {
  return frame.evaluate(() => ({ boot: document.body.dataset.boot, text: document.querySelector("#draft")?.value ?? null,
    status: document.querySelector("#save-status")?.textContent ?? null, notice: document.querySelector("#notice").textContent,
    fault: { ...window.__storageFault }, operations: [...window.__storageOperations] }));
}
async function stored(page, key, canary) {
  // The host has no injected Storage wrapper. Read actual persisted bytes rather
  // than trusting the editor's status or its fault instrumentation.
  return page.evaluate(({ key, canary }) => ({ raw: localStorage.getItem(key), canary: localStorage.getItem(canary) }), { key, canary });
}

export async function restoreStorageState(restore, { observe, key, primaryError = null }) {
  try {
    const proof = await restore();
    if (!proof || proof.cleared !== true || proof.remaining_frames !== 1) throw new Error("Storage namespace cleanup proof is incomplete");
    await observe("storage-cleanup", proof);
    return proof;
  } catch (cleanupError) {
    let failure = cleanupError;
    try {
      await observe("storage-cleanup-error", { key, error: String(cleanupError?.message || cleanupError),
        error_type: String(cleanupError?.name || "Error"), original_failure_preserved: primaryError !== null });
    } catch (diagnosticError) {
      failure = new AggregateError([cleanupError, diagnosticError], "Storage cleanup and diagnostic recording failed");
    }
    if (primaryError !== null) throw new AggregateError([primaryError, failure], "Storage experiment and cleanup failed");
    throw failure;
  }
}

export default async function flow(page, { cycle, check, observe, mark }) {
  const scenario = scenarios[variant]; if (!scenario) throw new Error("Unsupported storage scenario");
  const mode = new URL(page.url()).searchParams.get("mode");
  if (!["vulnerable", "defensive"].includes(mode)) throw new Error("Unknown storage implementation");
  const key = `vibeguru-storage:${runId}:${cycle}`, canary = `${key}:canary`, text = `Edited draft ${cycle}`;
  const raw = scenario === "corrupt" ? '{"version":1,"text":' : scenario === "shape" ? JSON.stringify({ version: 1, text: 99 }) : JSON.stringify({ version: 1, text: `Seed draft ${cycle}` });
  const expectedInitial = ["corrupt", "shape", "denied"].includes(scenario) ? "" : `Seed draft ${cycle}`;
  let primary = null;
  try {
    const seeded = await page.evaluate(({ key, canary, raw }) => {
      localStorage.setItem(key, raw); localStorage.setItem(canary, "unrelated-value");
      return localStorage.getItem(key) === raw && localStorage.getItem(canary) === "unrelated-value";
    }, { key, canary, raw });
    check("storage-seed-confirmed", seeded, "Exact real storage bytes are installed in a fresh namespace");
    const frame = await boot(page, { mode, key, fault: ["denied", "quota"].includes(scenario) ? scenario : "none" });
    const initial = await state(frame);
    const cold = await frame.evaluate(() => performance.getEntriesByType("navigation").length === 1);
    check("storage-cold-start-observed", cold && ["started", "ready"].includes(initial.boot), "A new editor document actually began loading the seed");
    const initialStorage = await stored(page, key, canary);
    const isolated = await frame.evaluate(canary => {
      localStorage.setItem(canary, "unrelated-value"); return localStorage.getItem(canary) === "unrelated-value";
    }, canary);
    const untouched = initialStorage.raw;
    let firstSave = null, firstSaveStorage = null, retried = null, reloaded = null, reloadedStorage = null;
    if (initial.text !== null) {
      await frame.locator("#draft").fill(text);
      await frame.locator("#save").click();
      firstSave = await state(frame);
      // Observe the failed attempt before disabling the injected fault or retrying.
      // A later successful retry cannot stand in for preservation of existing data.
      firstSaveStorage = await stored(page, key, canary);
      if (["denied", "quota"].includes(scenario)) {
        await frame.evaluate(() => { window.__storageFault.enabled = false; });
        await frame.locator("#save").click();
      }
      retried = { ui: await state(frame), ...await stored(page, key, canary) };
      const secondFrame = await boot(page, { mode, key, fault: "none" });
      const settled = await until(() => state(secondFrame), value => value.boot === "ready", 500);
      reloaded = settled.value;
      reloadedStorage = await stored(page, key, canary);
    }
    const finalStorage = await stored(page, key, canary);
    const attempted = [...initial.operations, ...(firstSave?.operations || [])].filter(op => op.key === key);
    const delivered = scenario === "denied" ? attempted.some(op => op.op === "read" && op.blocked) :
      scenario === "quota" ? attempted.some(op => op.op === "write" && op.blocked) : attempted.some(op => op.op === "read" && !op.blocked);
    await observe("storage-condition", { variant, mode, scenario, key, seed: raw, cold_start: initial, unrelated_key_usable: isolated, controlled_exception: ["denied", "quota"].includes(scenario) });
    check("storage-condition-delivered", isolated && delivered, "The target read/write condition occurred and unrelated storage remained usable");
    const readRecovered = initial.boot === "ready" && initial.text === expectedInitial && untouched === raw &&
      (!["corrupt", "shape", "denied"].includes(scenario) || initial.notice.startsWith("Recovered editor"));
    const writeHonest = Boolean(firstSave?.text === text && (["denied", "quota"].includes(scenario)
      ? firstSave.status.startsWith("Unsaved: storage unavailable") : firstSave.status === "Saved"));
    const persisted = Boolean(retried?.ui.status === "Saved" && retried.raw === JSON.stringify({ version: 1, text }) && reloaded?.text === text);
    const existingPreserved = !["denied", "quota"].includes(scenario) || firstSaveStorage?.raw === raw;
    const unrelatedPreserved = isolated && [initialStorage, firstSaveStorage, retried, reloadedStorage, finalStorage]
      .filter(snapshot => snapshot !== null).every(snapshot => snapshot.canary === "unrelated-value");
    await observe("storage-result", { initial, stored_bytes_before_explicit_save: untouched, initial_storage: initialStorage,
      first_save: firstSave, first_save_storage: firstSaveStorage, retry: retried, cold_reload: reloaded, cold_reload_storage: reloadedStorage,
      final_storage: finalStorage, read_recovered: readRecovered, failed_write_honest: writeHonest, persisted_after_retry: persisted,
      blocked_write_preserved_existing_bytes: Boolean(existingPreserved), unrelated_storage_preserved: Boolean(unrelatedPreserved) });
    check("storage-recovery-contract", Boolean(readRecovered && writeHonest && persisted && existingPreserved && unrelatedPreserved),
      "Cold-start recovery, honest unsaved state, preserved existing/unrelated bytes, explicit retry and persisted draft all satisfy the declared policy");
  } catch (error) { primary = error; }
  finally {
    await restoreStorageState(async () => {
      const cleared = await page.evaluate(({ key, canary }) => {
        document.querySelector("#editor-host").replaceChildren();
        localStorage.removeItem(key); localStorage.removeItem(canary);
        return localStorage.getItem(key) === null && localStorage.getItem(canary) === null && !document.querySelector("iframe");
      }, { key, canary });
      if (!cleared) throw new Error("Storage namespace cleanup failed");
      // Removing an iframe does not synchronously finish renderer teardown.
      // Give detached documents one bounded idle period before retained sampling.
      await paint(page); await page.waitForTimeout(100);
      if (page.frames().length !== 1) throw new Error("Cold editor frame did not detach");
      return { cleared, key, post_cleanup_idle_ms: 100, remaining_frames: page.frames().length };
    }, { observe, key, primaryError: primary });
  }
  if (primary) throw primary;
  await mark("storage-resilience");
}
