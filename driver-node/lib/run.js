// run.js — phase runner for the memory.client vector.
//
// Phases (axis = interaction CYCLES, not wall-clock):
//   baseline : load app, settle, force GC, sample the clean floor
//   cycles   : repeat interactions and sample retained state after forced GC
//   cooldown : return to a neutral route, force GC, sample — does memory come back?
//
// The cooldown sample vs baseline is what makes the recovery-ratio possible.

import { chromium } from "playwright";
import { sample, collectGarbage } from "./sampler.js";
import { plan, visitRoute, documentToken } from "./crawl.js";
import { loadFlowModule, journeyCheck, journeyObservation } from "./flow.js";
import { observe } from "./observer.js";
import { census } from "./census.js";

const settle = (page, ms) => page.waitForTimeout(ms);

/**
 * Force a collection and keep score.
 *
 * Every memory number this tool reports is only meaningful because a GC ran first —
 * without one we measure transient garbage, leaks wash out, and the run reports a
 * healthy app. So a failure here does not stop the run, but it must not pass
 * unmentioned either: a clean result nobody can trust is worse than an error.
 */
function gcTracker(client, emit) {
  let failures = 0;

  return {
    async collect() {
      const ok = await collectGarbage(client);
      if (!ok) failures += 1;
      return ok;
    },
    report() {
      if (failures === 0) return;

      emit({
        type: "log",
        level: "warn",
        message:
          `forced garbage collection failed ${failures} time(s) — memory measurements ` +
          "in this run reflect uncollected garbage, not retained memory, so any " +
          "clean memory result should not be trusted",
      });
    },
    get failures() {
      return failures;
    },
  };
}

export async function run(config, emit) {
  const startedAt = Date.now();
  const browser = await chromium.launch({
    headless: config.headless,
    // Precise heap numbers from performance.memory (otherwise values are bucketed).
    args: ["--enable-precise-memory-info"],
  });
  const timer = setTimeout(() => browser.close().catch(() => {}), Math.max(1, (config.timeoutMs || 600000) - (Date.now() - startedAt)));
  timer.unref();

  try {
    // A session saved by `vibeguru auth` makes everything behind the login reachable.
    // Without it those routes show up in the coverage report as auth_required.
    const context = await browser.newContext(
      config.storageState ? { storageState: config.storageState } : {}
    );

    if (config.storageState) {
      emit({ type: "log", phase: "baseline", message: "using saved session" });
    }
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    await client.send("HeapProfiler.enable").catch(() => {});

    // Runtime observation rides along on this same session: the cycle loop below
    // already mounts and unmounts every route, which is exactly the exercise that
    // surfaces uncaught exceptions, console errors and failed requests. Attaching
    // here costs one set of listeners and no extra navigation.
    const observer = await observe(page);
    const flowModule = config.mode === "flow" ? await loadFlowModule(config.flow) : null;
    // Register fixtures, network controls or initial state before the first load.
    // Setup is run once per fresh context; failures abort execution as ERROR.
    if (flowModule?.setup) await flowModule.setup(page, { config });
    const gc = gcTracker(client, emit);
    let flowFailures = 0;
    let flowCompleted = 0;
    let navigationFailures = 0;
    let retentionInvalid = false;
    const deadline = startedAt + (config.timeoutMs || 600000);
    const checkDeadline = () => { if (Date.now() >= deadline) throw new Error("run deadline exceeded"); };

    // --- baseline ---------------------------------------------------------
    emit({ type: "log", phase: "baseline", message: `loading ${config.url}` });
    await page.goto(config.url, { waitUntil: "networkidle", timeout: 30000 });
    await settle(page, config.settleMs);
    const baselineDocument = await documentToken(page);

    const flowFn = flowModule?.run || null;
    const plannedRun =
      config.mode === "auto"
        ? await plan(page, config)
        : { routes: [], skipped: [], declaredCount: 0, discoveredCount: 0 };

    const routes = plannedRun.routes;

    // Which routes were attempted and how each turned out. A run that reports "no
    // issues" having reached three of nineteen routes has not found an app healthy;
    // it has found it mostly invisible, and must say so.
    const coverage = {
      mode: config.mode,
      declared: plannedRun.declaredCount,
      discovered: plannedRun.discoveredCount,
      planned: routes.map((r) => r.path),
      visited: [],
      unreachable: [...plannedRun.skipped],
    };

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
          "no routes to exercise: none declared in the app's source and none linked from the landing page. Cycles will only re-settle home (limited signal). Consider --flow for app-specific navigation.",
      });
    }

    const baseGc = await gc.collect();
    await settle(page, 200);
    const base = await sample(page, client);
    emit({ type: "evidence", kind: "sample", phase: "baseline", cycle: 0, timestamp: Date.now(), context: { route: "/" }, data: { ...base, gcOk: baseGc } });

    const censusTargets = config.censusTargets || [];
    if (censusTargets.length) {
      emit({
        type: "evidence",
        kind: "census",
        phase: "baseline",
        cycle: 0,
        timestamp: Date.now(),
        context: { route: "/" },
        data: { counts: await census(client, censusTargets) },
      });
    }

    // --- cycle loop -------------------------------------------------------
    // For attribution we mount+unmount ONE route at a time, then sample the
    // home state. Consecutive post-GC diffs suggest which interaction retained state.
    for (let i = 1; i <= config.cycles; i++) {
      checkDeadline();
      if (flowFn) {
        // Recorded-flow replay. The flow may call mark(label) to take labeled
        // retained-state samples; otherwise we sample once at the end as "flow".
        let marked = false;
        observer.route("flow");
        await observer.mutations();
        let mutationStart = Date.now();
        const mark = async (label) => {
          checkDeadline();
          if (baselineDocument == null || await documentToken(page) !== baselineDocument) retentionInvalid = true;
          const mutations = await observer.mutations();
          const mutationWindowMs = Date.now() - mutationStart;
          const gcOk = await gc.collect();
          const s = await sample(page, client);
          const route = label || "flow";
          emit({ type: "evidence", kind: "sample", phase: "cycle", cycle: i, timestamp: Date.now(), context: { route }, data: { ...s, gcOk, mutations, mutationWindowMs } });
          if (censusTargets.length) emit({ type: "evidence", kind: "census", phase: "cycle", cycle: i, timestamp: Date.now(), context: { route }, data: { counts: await census(client, censusTargets) } });
          mutationStart = Date.now();
          marked = true;
        };
        try {
          const check = journeyCheck(emit, i, () => page.url(), flowModule.checks);
          const flowStarted = Date.now();
          const observeExperiment = journeyObservation(emit, i, () => page.url());
          await flowFn(page, { cycle: i, mark, check, observe: observeExperiment });
          emit({ type: "evidence", kind: "journey_result", phase: "cycle", cycle: i,
            timestamp: Date.now(), context: { route: page.url() },
            data: { completed: true, durationMs: Date.now() - flowStarted } });
          flowCompleted += 1;
        } catch (err) {
          flowFailures += 1;
          emit({ type: "evidence", kind: "journey_result", phase: "cycle", cycle: i,
            timestamp: Date.now(), context: { route: page.url() },
            data: { completed: false, errorType: err.name, message: String(err.message).slice(0, 2000) } });
          emit({ type: "log", level: "warn", phase: "cycle", message: `flow error on cycle ${i}: ${err.message}` });
        }
        if (!marked) await mark("flow");
      } else if (routes.length === 0) {
        // No routes to cycle: just re-settle home so the run still produces a series.
        await settle(page, config.settleMs);
        await gc.collect();
        const s = await sample(page, client);
        emit({ type: "evidence", kind: "sample", phase: "cycle", cycle: i, timestamp: Date.now(), context: { route: "/" }, data: s });
      } else {
        for (const route of routes) {
          checkDeadline();
          observer.route(route.path);
          // Reset the DOM-mutation counter so the window below belongs to this
          // route alone. A route that mounts and settles produces a burst then
          // stops; one that re-renders in a loop never stops, which is what the
          // analyzer looks for.
          await observer.mutations();
          const mutStart = Date.now();

          const visit = await visitRoute(page, route, config.settleMs); // mount+unmount, client-side
          if (!visit.ok) navigationFailures += 1;
          if (visit.retentionInvalid) retentionInvalid = true;

          // Recorded once: cycle 1 establishes whether a route is reachable at all,
          // and repeating the same verdict every cycle would just inflate the report.
          if (visit.ok && i === 1) coverage.visited.push(route.path);
          if (!visit.ok) {
              coverage.visited = coverage.visited.filter((p) => p !== route.path);
              if (!coverage.unreachable.some((r) => r.path === route.path)) coverage.unreachable.push({
                path: route.path,
                reason: visit.reason,
                detail: visit.detail || null,
              });
          }

          const mutations = await observer.mutations();
          const mutationWindowMs = Date.now() - mutStart;

          // GC before sampling so we measure RETAINED state, not transient garbage.
          // This is what makes per-route attribution clean: a real leak (window
          // listener, global-retained nodes) survives GC; framework churn does not.
          const gcOk = await gc.collect();
          const s = await sample(page, client); // retained home-state, tagged with the route just exercised
          emit({
            type: "evidence",
            kind: "sample",
            phase: "cycle",
            cycle: i,
            timestamp: Date.now(),
            context: { route: route.path },
            data: { ...s, gcOk, mutations, mutationWindowMs },
          });

          // Counts are taken at the same post-GC point as the sample, so "retained
          // 178KB" and "retained one Chart instance" describe the same moment and can
          // be reasoned about together.
          if (censusTargets.length) {
            emit({
              type: "evidence",
              kind: "census",
              phase: "cycle",
              cycle: i,
              timestamp: Date.now(),
              context: { route: route.path },
              data: { counts: await census(client, censusTargets) },
            });
          }
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
    const cooldownGc1 = await gc.collect();
    await settle(page, Math.max(config.settleMs, 500));
    const cooldownGc2 = await gc.collect(); // second pass: let finalizers run
    await settle(page, 200);
    const cool = await sample(page, client);
    emit({ type: "evidence", kind: "sample", phase: "cooldown", cycle: config.cycles + 1, timestamp: Date.now(), context: {}, data: { ...cool, gcOk: cooldownGc1 && cooldownGc2 } });

    // --- runtime events ---------------------------------------------------
    // One evidence per distinct problem, carrying how often it fired and where.
    // Emitted at the end because the count only means something once every cycle
    // has run: an error seen in all cycles is systematic, one seen once is a fluke.
    gc.report();

    Object.assign(coverage, { flow_completed: flowCompleted, flow_planned: flowFn ? config.cycles : 0, flow_failures: flowFailures });
    emit({ type: "evidence", kind: "coverage", phase: "cooldown", cycle: config.cycles, timestamp: Date.now(), context: {}, data: coverage });

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
      coverage,
      gcFailures: gc.failures,
      flowFailures,
      flowCompleted,
      journeyChecks: flowModule?.checks || [],
      journeyProtocolVersion: flowModule ? 1 : null,
      navigationFailures,
      retentionInvalid,
      runtimeObserved: true,
      browserVersion: browser.version(),
      driverNodeVersion: process.version,
      mode: config.mode,
      settleMs: config.settleMs,
      routesLimit: config.routesLimit,
      censusTargets,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
    await browser.close().catch(() => {});
  }
}
