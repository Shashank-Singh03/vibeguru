// run.js — phase runner for the memory.client vector.
//
// Phases (axis = interaction CYCLES, not wall-clock):
//   baseline : load app, settle, force GC, sample the clean floor
//   cycles   : repeat the interaction set N times, sampling each cycle WITHOUT GC
//              (so natural growth + retention show up)
//   cooldown : return to a neutral route, force GC, sample — does memory come back?
//
// The cooldown sample vs baseline is what makes the recovery-ratio possible.

import { chromium } from "playwright";
import { sample, collectGarbage } from "./sampler.js";
import { discover, visitRoute } from "./crawl.js";
import { loadFlow } from "./flow.js";
import { observe } from "./observer.js";

const settle = (page, ms) => page.waitForTimeout(ms);

export async function run(config, emit) {
  const startedAt = Date.now();
  const browser = await chromium.launch({
    headless: config.headless,
    // Precise heap numbers from performance.memory (otherwise values are bucketed).
    args: ["--enable-precise-memory-info"],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send("HeapProfiler.enable").catch(() => {});

    // Runtime observation rides along on this same session: the cycle loop below
    // already mounts and unmounts every route, which is exactly the exercise that
    // surfaces uncaught exceptions, console errors and failed requests. Attaching
    // here costs one set of listeners and no extra navigation.
    const observer = await observe(page);

    // --- baseline ---------------------------------------------------------
    emit({ type: "log", phase: "baseline", message: `loading ${config.url}` });
    await page.goto(config.url, { waitUntil: "networkidle", timeout: 30000 });
    await settle(page, config.settleMs);

    const flowFn = config.mode === "flow" ? await loadFlow(config.flow) : null;
    const routes = config.mode === "auto" ? await discover(page, config) : [];
    emit({
      type: "marker",
      kind: "config",
      data: {
        url: config.url,
        mode: config.mode,
        cycles: config.cycles,
        settleMs: config.settleMs,
        flow: config.flow || null,
        routes: routes.map((r) => r.path),
        routeCount: routes.length,
      },
    });

    if (config.mode === "auto" && routes.length === 0) {
      emit({
        type: "log",
        level: "warn",
        message:
          "no same-origin route links found on the landing page; cycles will only re-settle home (limited signal). Consider --flow for app-specific navigation.",
      });
    }

    await collectGarbage(client);
    await settle(page, 200);
    const base = await sample(page, client);
    emit({ type: "evidence", kind: "sample", phase: "baseline", cycle: 0, timestamp: Date.now(), context: { route: "/" }, data: base });

    // --- cycle loop -------------------------------------------------------
    // For attribution we mount+unmount ONE route at a time, then sample the
    // home state. Consecutive home-state diffs attribute retained memory to the
    // route just visited. We do NOT force GC here — we want natural accumulation;
    // the cooldown GC tells us what's truly retained.
    for (let i = 1; i <= config.cycles; i++) {
      if (flowFn) {
        // Recorded-flow replay. The flow may call mark(label) to take labeled
        // retained-state samples; otherwise we sample once at the end as "flow".
        let marked = false;
        const mark = async (label) => {
          await collectGarbage(client);
          const s = await sample(page, client);
          emit({ type: "evidence", kind: "sample", phase: "cycle", cycle: i, timestamp: Date.now(), context: { route: label || "flow" }, data: s });
          marked = true;
        };
        try {
          await flowFn(page, { cycle: i, mark });
        } catch (err) {
          emit({ type: "log", level: "warn", phase: "cycle", message: `flow error on cycle ${i}: ${err.message}` });
        }
        if (!marked) await mark("flow");
      } else if (routes.length === 0) {
        // No routes to cycle: just re-settle home so the run still produces a series.
        await settle(page, config.settleMs);
        await collectGarbage(client);
        const s = await sample(page, client);
        emit({ type: "evidence", kind: "sample", phase: "cycle", cycle: i, timestamp: Date.now(), context: { route: "/" }, data: s });
      } else {
        for (const route of routes) {
          observer.route(route.path);
          // Reset the DOM-mutation counter so the window below belongs to this
          // route alone. A route that mounts and settles produces a burst then
          // stops; one that re-renders in a loop never stops, which is what the
          // analyzer looks for.
          await observer.mutations();
          const mutStart = Date.now();

          await visitRoute(page, route, config.settleMs); // mount then unmount (client-side)

          const mutations = await observer.mutations();
          const mutationWindowMs = Date.now() - mutStart;

          // GC before sampling so we measure RETAINED state, not transient garbage.
          // This is what makes per-route attribution clean: a real leak (window
          // listener, global-retained nodes) survives GC; framework churn does not.
          await collectGarbage(client);
          const s = await sample(page, client); // retained home-state, tagged with the route just exercised
          emit({
            type: "evidence",
            kind: "sample",
            phase: "cycle",
            cycle: i,
            timestamp: Date.now(),
            context: { route: route.path },
            data: { ...s, mutations, mutationWindowMs },
          });
        }
        observer.route("/");
      }
      const last = await sample(page, client);
      if (i % 5 === 0 || i === config.cycles) {
        emit({ type: "log", phase: "cycle", message: `cycle ${i}/${config.cycles} (nodes=${last.nodes}, listeners=${last.listeners}, heapUsed=${last.heapUsed})` });
      }
    }

    // --- cooldown ---------------------------------------------------------
    emit({ type: "log", phase: "cooldown", message: "forcing GC and sampling recovery" });
    await collectGarbage(client);
    await settle(page, Math.max(config.settleMs, 500));
    await collectGarbage(client); // second pass: let finalizers run
    await settle(page, 200);
    const cool = await sample(page, client);
    emit({ type: "evidence", kind: "sample", phase: "cooldown", cycle: config.cycles + 1, timestamp: Date.now(), context: {}, data: cool });

    // --- runtime events ---------------------------------------------------
    // One evidence per distinct problem, carrying how often it fired and where.
    // Emitted at the end because the count only means something once every cycle
    // has run: an error seen in all cycles is systematic, one seen once is a fluke.
    const runtimeEvents = observer.events();
    for (const ev of runtimeEvents) {
      emit({
        type: "evidence",
        kind: "runtime_event",
        phase: "cycle",
        cycle: config.cycles,
        timestamp: Date.now(),
        context: { route: ev.routes[0] || "/", routes: ev.routes },
        data: ev,
      });
    }
    emit({
      type: "log",
      phase: "cooldown",
      message: `observed ${runtimeEvents.length} distinct runtime event(s)`,
    });

    await context.close();
    return {
      ok: true,
      url: config.url,
      cycles: config.cycles,
      routeCount: routes.length,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
