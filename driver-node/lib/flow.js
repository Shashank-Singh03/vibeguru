// flow.js — advanced input: replay a user-recorded interaction instead of auto-crawl.
//
// A flow file is an ES module that default-exports an async function run once per
// cycle. It receives the Playwright `page` and a context object:
//
//     // my-flow.js
//     export default async function flow(page, { cycle, mark }) {
//       await page.getByRole("link", { name: "Dashboard" }).click();
//       await page.getByRole("button", { name: "Open chart" }).click();
//       await page.getByRole("button", { name: "Close" }).click();
//       await mark("dashboard-chart"); // optional: take a labeled retained-state sample
//     }
//
// `mark(label)` lets the flow attribute leaks to a named step; if never called, the
// driver samples once at the end of the cycle under the label "flow".

import { pathToFileURL } from "node:url";
import path from "node:path";

export async function loadFlowModule(flowPath) {
  const abs = path.resolve(flowPath);
  const mod = await import(pathToFileURL(abs).href);
  const fn = mod.default || mod.flow;
  if (typeof fn !== "function") {
    throw new Error(`flow file ${flowPath} must export a default async function (page, ctx)`);
  }
  if (mod.setup != null && typeof mod.setup !== "function") {
    throw new Error(`flow file ${flowPath} setup must be a function`);
  }
  const checks = Object.hasOwn(mod, "checks") ? mod.checks : [];
  if (!Array.isArray(checks) || checks.some(id => typeof id !== "string" || !id.trim()) || new Set(checks).size !== checks.length) {
    throw new Error("Flow checks must be an array of unique non-empty assertion IDs");
  }
  return { run: fn, setup: mod.setup || null, checks };
}

export async function loadFlow(flowPath) {
  return (await loadFlowModule(flowPath)).run;
}

export class JourneyAssertionError extends Error {
  constructor(id, message) {
    super(message || `Journey assertion failed: ${id}`);
    this.name = "JourneyAssertionError";
    this.assertionId = id;
  }
}

// Only an explicit false is an asserted application failure. A locator timeout or
// exception while computing the condition remains an incomplete interaction.
export function journeyCheck(emit, cycle, route, declared = null) {
  const seen = new Set();
  return (id, condition, message = id) => {
    if (typeof id !== "string" || !id.trim() || seen.has(id)) {
      throw new Error("Journey check IDs must be non-empty and unique per cycle");
    }
    if (declared !== null && !declared.includes(id)) throw new Error(`Journey check ${id} is not declared in flow checks`);
    if (typeof condition !== "boolean") throw new Error("Journey check condition must be a boolean");
    seen.add(id);
    emit({ type: "evidence", kind: "journey_assertion", phase: "cycle", cycle,
      timestamp: Date.now(), context: { route: route() },
      data: { assertionId: id, status: condition ? "pass" : "fail", message: String(message) } });
    if (!condition) throw new JourneyAssertionError(id, String(message));
  };
}

// Observations describe controlled inputs and observed state. They never create a
// finding on their own. Snapshot the payload so later mutation cannot rewrite it.
export function journeyObservation(emit, cycle, route) {
  const seen = new Set();
  function snapshot(value, ancestors = new Set(), depth = 0) {
    if (depth > 20) throw new Error("Observation exceeds the maximum JSON depth");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || ancestors.has(value)) throw new Error("Observation must contain JSON-safe values without cycles");
    if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      throw new Error("Observation must contain plain JSON objects");
    }
    ancestors.add(value);
    const result = Array.isArray(value)
      ? Array.from(value, child => snapshot(child, ancestors, depth + 1))
      : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, snapshot(child, ancestors, depth + 1)]));
    ancestors.delete(value);
    return result;
  }
  return (id, data) => {
    if (typeof id !== "string" || !id.trim() || seen.has(id)) throw new Error("Observation IDs must be non-empty and unique per cycle");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Observation payload must be a plain JSON object");
    const payload = snapshot(data);
    if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 65536) throw new Error("Observation exceeds 64KiB");
    seen.add(id);
    emit({ type: "evidence", kind: "experiment_observation", phase: "cycle", cycle,
      timestamp: Date.now(), context: { route: route() }, data: { observationId: id, payload } });
  };
}
