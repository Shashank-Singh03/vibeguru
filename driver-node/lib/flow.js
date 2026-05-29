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

export async function loadFlow(flowPath) {
  const abs = path.resolve(flowPath);
  const mod = await import(pathToFileURL(abs).href);
  const fn = mod.default || mod.flow;
  if (typeof fn !== "function") {
    throw new Error(`flow file ${flowPath} must export a default async function (page, ctx)`);
  }
  return fn;
}
