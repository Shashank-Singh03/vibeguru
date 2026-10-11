import { isolate } from "./common.mjs";
import { ResponseOrder } from "../response-order.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export const checks = ["newer-refresh-rendered", "latest-refresh-wins"];
const schedule = new ResponseOrder();
const variant = process.env.VIBEGURU_LAB_VARIANT || "race-ordered";
let currentCycle = 0;
const metrics = { total_requests: 100, requests_2xx: 100, requests_4xx: 0, requests_5xx: 0,
  average_latency_ms: 20, p95_latency_ms: 40, p99_latency_ms: 60, requests_per_second: 5 };
const response = label => ({ logs: [{ timestamp: "2026-10-09T12:00:00Z", level: "INFO",
  message: `cycle-${currentCycle}-${label}`, trace_id: `lab-${label}` }], total: 1 });

export async function setup(page, { config }) {
  await isolate(page, config, url => {
    if (url.pathname === "/admin/apis") return [];
    if (url.pathname === "/admin/metrics/summary") return metrics;
    return undefined;
  });
  // Disable every interval with exactly this delay, including the Logs poll.
  // This broader timer intervention is recorded; full polling is not tested.
  await page.addInitScript(() => {
    const nativeInterval = window.setInterval.bind(window);
    window.setInterval = (fn, delay, ...args) => delay === 10000 ? 0 : nativeInterval(fn, delay, ...args);
  });
  await page.route(/\/admin\/logs(?:\?.*)?$/, async route => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204,
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" } });
    const deliver = label => route.fulfill({ status: 200, contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*",
        "X-Vibeguru-Lab-Release": `cycle-${currentCycle}-${label}` }, body: JSON.stringify(response(label)) });
    if (!(await schedule.holdNext(deliver))) await deliver("initial");
  });
}

async function releaseAndRender(page, label) {
  const completed = page.waitForResponse(r => r.headers()["x-vibeguru-lab-release"] === `cycle-${currentCycle}-${label}`)
    .then(r => r.finished());
  const [, error] = await Promise.all([schedule.release(label), completed]);
  if (error) throw error;
  // Observe after the response body and two paint opportunities, rather than
  // declaring a stale state before the response can update the application.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

export default async function flow(page, { cycle, check, observe, mark }) {
  currentCycle = cycle;
  await page.getByRole("link", { name: "APIs", exact: true }).click();
  await page.getByRole("heading", { name: "APIs", exact: true }).waitFor();
  await page.getByRole("link", { name: "Logs", exact: true }).click();
  await page.getByRole("heading", { name: "Logs", exact: true }).waitFor();
  await page.getByText(`cycle-${cycle}-initial`, { exact: true }).waitFor();
  schedule.begin(["older", "newer"]);
  observe("response-order-plan", { variant, disabled_interval_delay_ms: 10000,
    endpoint: "/admin/logs", expected_message: `cycle-${cycle}-newer`,
    release_order: variant === "race-ordered" ? ["older", "newer"] : ["newer", "older"] });
  try {
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await schedule.waitFor("older");
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await schedule.waitFor("newer");
    // Both variants overlap the same two requests. Only response order changes.
    if (variant === "race-ordered") await releaseAndRender(page, "older");
    await releaseAndRender(page, "newer");
    const newest = page.getByText(`cycle-${cycle}-newer`, { exact: true });
    await newest.waitFor();
    check("newer-refresh-rendered", await newest.isVisible(), "The newer refresh renders its controlled response");
    if (variant === "interrupted") throw new Error("Interrupted before releasing the older refresh response");
    if (variant !== "race-ordered") await releaseAndRender(page, "older");
    const stabilityWindowMs = 400;
    const trace = [];
    const started = Date.now();
    do {
      trace.push({ elapsed_ms: Date.now() - started, latest_visible: await newest.isVisible(),
        visible_table: await page.getByRole("table").innerText() });
      if (Date.now() - started < stabilityWindowMs) await page.waitForTimeout(25);
    } while (Date.now() - started < stabilityWindowMs);
    trace.push({ elapsed_ms: Date.now() - started, latest_visible: await newest.isVisible(),
      visible_table: await page.getByRole("table").innerText() });
    const observation = { releases: schedule.events, stability_window_ms: stabilityWindowMs, trace,
      expected_message: `cycle-${cycle}-newer`, latest_stable: trace.every(sample => sample.latest_visible) };
    observe("response-order-result", observation);
    if (process.env.VIBEGURU_LAB_EVIDENCE_DIR) {
      await writeFile(join(process.env.VIBEGURU_LAB_EVIDENCE_DIR, `race-${cycle}.json`), JSON.stringify(observation, null, 2));
      if (cycle === 1) await page.screenshot({ path: join(process.env.VIBEGURU_LAB_EVIDENCE_DIR, "race-result.png"), fullPage: true });
    }
    check("latest-refresh-wins", observation.latest_stable,
      "The newer refresh result must remain visible throughout the 400ms observation window after both responses finish");
    await mark("logs-refresh-order");
  } finally {
    await schedule.drain();
    observe("response-order-cleanup", { events: schedule.events });
  }
}
