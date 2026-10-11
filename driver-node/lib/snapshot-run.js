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
import { visitRoute, discover, documentToken } from "./crawl.js";
import { capture, growth } from "./snapshot.js";

const settle = (page, ms) => page.waitForTimeout(ms);

// The optional dependency seam exercises failure paths without pretending that a
// malformed capture is a successful browser measurement.
export async function runSnapshot(config, emit, dependencies = {}) {
  const startedAt = Date.now();
  const route = config.route || "/";
  const visits = config.cycles ?? 3;
  const targets = config.constructorHints || [];
  if (!Number.isInteger(visits) || visits < 1) throw new Error("snapshot visits must be a positive integer");
  const collect = dependencies.collectGarbage || collectGarbage;
  const visit = dependencies.visitRoute || visitRoute;
  const findLinks = dependencies.discover || discover;
  const token = dependencies.documentToken || documentToken;
  const captureHeap = dependencies.capture || capture;

  const browser = await (dependencies.chromium || chromium).launch({
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
    const response = await page.goto(config.url, { waitUntil: "networkidle", timeout: 30000 });
    if (response && response.status() >= 400) throw new Error(`snapshot initial page returned HTTP ${response.status()}`);
    await settle(page, config.settleMs);
    const initialDocument = await token(page);
    if (!initialDocument) throw new Error("snapshot document identity is unavailable");
    const linked = (await findLinks(page)).find(link => link.path === route);
    const descriptor = { path: route, hrefAttr: linked?.hrefAttr || null, expectedSelector: config.routeExpectations?.[route] };
    const checkDocument = async () => {
      if (await token(page) !== initialDocument) throw new Error("snapshot document changed; retained-state comparison is invalid");
    };
    const checkedVisit = async phase => {
      const outcome = await visit(page, descriptor, config.settleMs);
      if (outcome?.ok !== true || outcome.retentionInvalid) {
        throw new Error(`snapshot ${phase} route ${route} unverified: ${outcome?.reason || "invalid_visit"}${outcome?.detail ? ` (${outcome.detail})` : ""}`);
      }
      await checkDocument();
    };
    const checkedGc = async phase => {
      if (await collect(client) !== true) throw new Error(`snapshot ${phase} garbage collection failed`);
      await checkDocument();
    };

    // The app has to be warm before the baseline, or one-time module and framework
    // allocations land in the growth and every route looks like it leaks.
    await checkedVisit("warm-up");
    await checkedGc("baseline");
    await settle(page, 200);

    emit({ type: "log", phase: "baseline", message: "capturing baseline heap snapshot" });
    const before = await captureHeap(client, { targets });
    await checkDocument();

    for (let i = 1; i <= visits; i++) {
      await checkedVisit(`cycle ${i}`);
    }

    // Two collections: the second lets finalizers from the first run, which is what
    // separates "retained" from "not collected yet".
    await checkedGc("cooldown first pass");
    await settle(page, Math.max(config.settleMs, 500));
    await checkedGc("cooldown second pass");
    await settle(page, 200);

    emit({ type: "log", phase: "cooldown", message: "capturing final heap snapshot" });
    const after = await captureHeap(client, { targets });
    await checkDocument();

    // The independent top-N summaries are not whole-heap censuses. A class entering
    // the final ranking was not necessarily absent initially. Compare only entries
    // represented in both snapshots (explicit targets include measured zeroes).
    const represented = Object.keys(before.constructors).filter(name => Object.hasOwn(after.constructors, name));
    const from = Object.fromEntries(represented.map(name => [name, before.constructors[name]]));
    const to = Object.fromEntries(represented.map(name => [name, after.constructors[name]]));
    const retained = growth(from, to, visits);
    const excludedConstructors = [...new Set([...Object.keys(before.constructors), ...Object.keys(after.constructors)])].filter(name => !represented.includes(name));

    emit({
      type: "evidence",
      kind: "heap_census",
      phase: "cooldown",
      cycle: visits,
      timestamp: Date.now(),
      context: { route },
      data: {
        growth: retained, visits, visitsCompleted: visits, gcOk: true, navigationOk: true,
        nodeCount: after.nodeCount, targets, comparisonScope: "ranked_constructor_summary",
        excludedConstructors, before: from, after: to
      },
    });

    await context.close();

    return {
      ok: true,
      url: config.url,
      route,
      visits,
      visitsCompleted: visits,
      gcOk: true,
      navigationOk: true,
      comparisonScope: "ranked_constructor_summary",
      retained: Object.keys(retained).length,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
