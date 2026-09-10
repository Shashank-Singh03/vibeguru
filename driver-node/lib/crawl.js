// crawl.js — decide which routes to exercise, and report what could not be reached.
//
// CRITICAL invariant: we navigate CLIENT-SIDE only. We click the app's own <a> links,
// or push history state, and use history back. We must NEVER use page.goto() for
// cycling, because a full document reload resets the JS heap on every navigation —
// leaks would never accumulate and every app would falsely pass. Client-side nav keeps
// the SPA mounted so retained memory builds up across cycles, which is what we measure.
//
// Routes come from two places, and the difference matters:
//
//   declared   — read from the app's own source by the Elixir detector (file-system
//                routers are exact; React/Vue Router are parsed from source).
//   discovered — anchors found in the live DOM.
//
// Crawling alone only ever sees what the landing page links to, which on a real app
// is a small and unrepresentative slice. Worse, it could not tell "this app is clean"
// apart from "I only saw three of its nineteen routes" — so a run reported a confident
// all-clear having looked at almost nothing. Declared routes close that gap, and
// anything still unreachable is reported rather than quietly dropped.

/** A route the run could not exercise, and why. This is the coverage report. */
function skip(path, reason, detail) {
  return { path, reason, detail: detail || null };
}

/**
 * Discover same-origin route links reachable from the current (home) page.
 *
 * Only *visible* anchors are returned. Links inside a collapsed menu are real routes,
 * but Playwright's click waits for actionability, so each hidden one burns the full
 * timeout and yields nothing — on a mobile-style nav that is the entire run spent
 * doing nothing. Declared routes reach those pages anyway, via history navigation.
 */
export async function discover(page) {
  return page.$$eval("a[href]", (anchors) => {
    const out = [];
    const seen = new Set();

    for (const a of anchors) {
      const hrefAttr = a.getAttribute("href");
      if (!hrefAttr) continue;
      if (/^(mailto:|tel:|javascript:|#)$/i.test(hrefAttr) || hrefAttr === "#") continue;

      // offsetParent is null for display:none and for detached nodes; position:fixed
      // elements report null too, so they are allowed through explicitly.
      const visible =
        a.offsetParent !== null || getComputedStyle(a).position === "fixed";
      if (!visible) continue;

      let u;
      try {
        u = new URL(a.href, location.href);
      } catch {
        continue;
      }

      if (u.origin !== location.origin) continue;
      if (u.pathname === location.pathname && (!u.hash || u.hash === location.hash)) continue;

      const key = u.pathname + u.hash;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path: u.pathname + u.hash, hrefAttr });
    }

    return out;
  });
}

/** Fill `[id]` / `:id` / `[...slug]` segments from configured values. */
function resolveDynamic(path, params) {
  const missing = [];

  const filled = path
    .split("/")
    .map((segment) => {
      const m =
        segment.match(/^\[\.\.\.(.+)\]$/) ||
        segment.match(/^\[(.+)\]$/) ||
        segment.match(/^:(.+)$/) ||
        segment.match(/^_(.+)$/);

      if (!m) return segment;

      const name = m[1];
      const value = params[name];
      if (value === undefined || value === null || value === "") {
        missing.push(name);
        return segment;
      }
      return String(value);
    })
    .join("/");

  return { filled, missing };
}

/**
 * Build the list of routes to cycle, plus the ones we already know we cannot reach.
 *
 * Declared routes lead, because they are the app's real surface; anything the DOM
 * turned up that the detector missed is appended.
 */
export async function plan(page, config) {
  const declared = config.declaredRoutes || [];
  const params = config.routeParams || {};
  const limit = config.routesLimit;

  const discovered = await discover(page);
  const linkFor = new Map(discovered.map((d) => [d.path, d.hrefAttr]));

  const routes = [];
  const skipped = [];
  const taken = new Set();

  for (const entry of declared) {
    const { filled, missing } = resolveDynamic(entry.path, params);

    if (missing.length) {
      // Visiting /users/[id] literally renders a 404 or an error boundary. Reporting
      // that page as healthy would be worse than admitting we never saw the route.
      skipped.push(
        skip(entry.path, "dynamic", `no value configured for: ${missing.join(", ")}`)
      );
      continue;
    }

    if (taken.has(filled)) continue;
    taken.add(filled);
    routes.push({ path: filled, hrefAttr: linkFor.get(filled) || null, source: "declared" });
  }

  for (const d of discovered) {
    if (taken.has(d.path)) continue;
    taken.add(d.path);
    routes.push({ path: d.path, hrefAttr: d.hrefAttr, source: "discovered" });
  }

  // Over the cap, keep the first N and say so rather than silently truncating.
  const kept = routes.slice(0, limit);
  for (const dropped of routes.slice(limit)) {
    skipped.push(skip(dropped.path, "over_limit", `--routes is ${limit}`));
  }

  return { routes: kept, skipped, declaredCount: declared.length, discoveredCount: discovered.length };
}

/**
 * Navigate to one route client-side, then return home. Returns {ok, reason, detail}
 * so the caller can build an honest coverage report instead of assuming success.
 *
 * Clicking the app's own link is preferred — it exercises the real navigation path.
 * Routes with no visible link (behind a menu, or simply never linked from home) fall
 * back to pushing history state, which routers pick up via popstate. Both keep the
 * SPA mounted; neither reloads the document.
 */
export async function visitRoute(page, route, settleMs) {
  const before = page.url();
  let navigated = false;

  if (route.hrefAttr) {
    const sel = `a[href="${route.hrefAttr.replace(/"/g, '\\"')}"]`;
    try {
      await page.locator(sel).first().click({ timeout: 3000 });
      navigated = true;
    } catch {
      // Link vanished or is not actionable from this view — fall through to history.
    }
  }

  if (!navigated) {
    try {
      await page.evaluate((path) => {
        window.history.pushState({}, "", path);
        window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
      }, route.path);
      navigated = true;
    } catch (err) {
      return { ok: false, reason: "navigation_failed", detail: err.message };
    }
  }

  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(settleMs);

  const landed = await page.evaluate(() => location.pathname + location.hash).catch(() => null);
  const result = verifyLanding(route, landed);

  // Always try to get home, even after a failed landing, so the next route starts
  // from a known state rather than wherever the app diverted us.
  await returnHome(page, before, settleMs);

  return result;
}

function verifyLanding(route, landed) {
  if (landed === null) return { ok: false, reason: "navigation_failed", detail: "page unavailable" };

  const want = route.path.split("#")[0];
  const got = landed.split("#")[0];

  if (got === want || got === want.replace(/\/$/, "")) return { ok: true };

  // A router that answers a route request with a different URL is usually a guard.
  // Naming that is far more useful than "route not covered", because it tells the
  // user the fix is authentication, not configuration.
  const guard = /login|signin|sign-in|auth|unauthorized/i.test(got);

  return {
    ok: false,
    reason: guard ? "auth_required" : "redirected",
    detail: `landed on ${got}`,
  };
}

async function returnHome(page, homeUrl, settleMs) {
  try {
    await page.goBack({ waitUntil: "networkidle", timeout: 5000 });
  } catch {
    // History back can fail if the app replaced state; push home directly.
    const path = new URL(homeUrl).pathname;
    await page
      .evaluate((p) => {
        window.history.pushState({}, "", p);
        window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
      }, path)
      .catch(() => {});
  }

  await page.waitForTimeout(settleMs);
}
