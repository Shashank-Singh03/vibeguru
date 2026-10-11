// Standalone browser validation of the reconnect adapter. This does not start a server,
// measure memory or claim a complete engine report; root owns the broader campaign.
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import flow, { setup, cleanup } from "./desktop/multiplayer-reconnect.mjs";
import { journeyCheck, JourneyAssertionError } from "../driver-node/lib/flow.js";

export async function calibrateReconnect(url, variant = "baseline", cycles = 3) {
  const previous = process.env.VIBEGURU_LAB_VARIANT;
  process.env.VIBEGURU_LAB_VARIANT = variant;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const observations = [];
  const assertions = [];
  const outcomes = [];
  try {
    const config = { url };
    await setup(page, { config });
    await page.goto(config.url);
    for (let cycle = 1; cycle <= cycles; cycle++) {
      const observationIds = new Set();
      try {
        await flow(page, {
          cycle,
          check: journeyCheck(event => assertions.push(event), cycle, () => page.url()),
          mark: async label => observations.push({ cycle, observationId: "measurement-mark", payload: { label, memory_sampled: false } }),
          observe: (id, payload) => {
            if (observationIds.has(id)) throw new Error(`Duplicate observation ID: ${id}`);
            observationIds.add(id);
            observations.push({ cycle, observationId: id, payload });
          },
        });
        outcomes.push({ cycle, completed: true });
      } catch (error) {
        outcomes.push({ cycle, completed: false,
          classification: error instanceof JourneyAssertionError ? "bounded_expectation_failed" : "execution_incomplete",
          error: error.message });
      }
    }
    return { experiment: "multiplayer-reconnect-calibration", variant, cycles,
      passed_assertions: assertions.filter(event => event.data.status === "pass").length,
      failed_assertions: assertions.filter(event => event.data.status === "fail").length,
      outcomes, assertions, observations };
  } finally {
    await cleanup(page).catch(() => {});
    await browser.close();
    if (previous === undefined) delete process.env.VIBEGURU_LAB_VARIANT;
    else process.env.VIBEGURU_LAB_VARIANT = previous;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [url, variant = "baseline", rawCycles = "3"] = process.argv.slice(2);
  const cycles = Number(rawCycles);
  if (!url || !Number.isInteger(cycles) || cycles < 1 || cycles > 10) throw new Error("Usage: node benchmarks/reconnect-calibrate.mjs <running-copy-url> [baseline|fixed|reconnect-broken] [cycles1-10]");
  console.log(JSON.stringify(await calibrateReconnect(url, variant, cycles)));
}
