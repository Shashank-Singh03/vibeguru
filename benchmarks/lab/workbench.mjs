import { isolate } from "../desktop/common.mjs";

export async function setupWorkbench(page, { config }) {
  await isolate(page, config); page.setDefaultTimeout(3000);
}
export async function control(page, action, body) {
  const url = new URL(`/__lab/${action}`, page.url());
  const response = body === undefined ? await page.request.get(String(url)) : await page.request.post(String(url), { data: body });
  if (!response.ok()) throw new Error(`Workbench ${action}: HTTP ${response.status()}`);
  return response.json();
}
export async function until(sample, predicate, timeoutMs = 1500) {
  const started = Date.now(); let value;
  do {
    value = await sample(); if (predicate(value)) return { value, elapsed_ms: Date.now() - started, reached: true };
    await new Promise(done => setTimeout(done, 20));
  } while (Date.now() - started < timeoutMs);
  return { value, elapsed_ms: Date.now() - started, reached: false };
}
export async function requireState(page, predicate) {
  const state = await until(() => control(page, "state"), predicate);
  if (!state.reached) throw new Error("Controlled request prerequisite was not observed");
  return state.value;
}
export async function paint(page) {
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
}
