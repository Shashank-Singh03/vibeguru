// snapshot-run.js — the focused probe: exercise ONE route and report what it retained.
//
// The survey pass measures every route shallowly. This does the opposite: one route, in
// depth, because the investigation loop only reaches for it once something cheaper has
// narrowed the question to a single place.
//
// Two snapshots, not one per cycle. Each costs seconds, and the question here is
// "how much does one visit leave behind", which two snapshots either side of N visits
// answers just as well for a fraction of the time.

import { chromium } from "playwright";
import { collectGarbage } from "./sampler.js";
import { visitRoute } from "./crawl.js";
import { capture, growth } from "./snapshot.js";

const settle = (page, ms) => page.waitForTimeout(ms);

export async function runSnapshot(config, emit) {
  const startedAt = Date.now();
  const route = config.route || "/";
  const visits = config.cycles || 3;
  const targets = config.constructorHints || [];

  const browser = await chromium.launch({
    headless: config.headless,
    args: ["--enable-precise-memory-info"],
  });

  try {
    const context = await browser.newContext(
      config.storageState ? { storageState: config.storageState } : {}
    );
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send("HeapProfiler.enable").catch(() => {});

    emit({ type: "log", phase: "baseline", message: `loading ${config.url} to probe ${route}` });
    await page.goto(config.url, { waitUntil: "networkidle", timeout: 30000 });
    await settle(page, config.settleMs);

    // The app has to be warm before the baseline, or one-time module and framework
    // allocations land in the growth and every route looks like it leaks.
    await visitRoute(page, { path: route, hrefAttr: null }, config.settleMs);
    await collectGarbage(client);
    await settle(page, 200);

    emit({ type: "log", phase: "baseline", message: "capturing baseline heap snapshot" });
    const before = await capture(client, { targets });

    for (let i = 1; i <= visits; i++) {
      await visitRoute(page, { path: route, hrefAttr: null }, config.settleMs);
    }

    // Two collections: the second lets finalizers from the first run, which is what
    // separates "retained" from "not collected yet".
    await collectGarbage(client);
    await settle(page, Math.max(config.settleMs, 500));
    await collectGarbage(client);
    await settle(page, 200);

    emit({ type: "log", phase: "cooldown", message: "capturing final heap snapshot" });
    const after = await capture(client, { targets });

    const retained = growth(before.constructors, after.constructors, visits);

    emit({
      type: "evidence",
      kind: "heap_census",
      phase: "cooldown",
      cycle: visits,
      timestamp: Date.now(),
      context: { route },
      data: { growth: retained, visits, nodeCount: after.nodeCount, targets },
    });

    await context.close();

    return {
      ok: true,
      url: config.url,
      route,
      visits,
      retained: Object.keys(retained).length,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
