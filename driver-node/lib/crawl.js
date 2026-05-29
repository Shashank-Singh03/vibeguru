// crawl.js — zero-config auto-discovery of in-app routes to cycle through.
//
// CRITICAL invariant: we navigate CLIENT-SIDE only. We click the app's own <a>
// links and use history back. We must NEVER use page.goto() for cycling, because a
// full document reload resets the JS heap on every navigation — leaks would never
// accumulate and every app would falsely pass. Client-side nav keeps the SPA mounted
// so retained memory builds up across cycles, which is exactly what we measure.

/**
 * Discover same-origin route links reachable from the current (home) page.
 * Returns [{ path, hrefAttr }], de-duplicated and capped at routesLimit.
 */
export async function discover(page, { routesLimit }) {
  const items = await page.$$eval("a[href]", (anchors) => {
    const out = [];
    const seen = new Set();
    for (const a of anchors) {
      const hrefAttr = a.getAttribute("href");
      if (!hrefAttr) continue;
      // Skip non-navigational links.
      if (/^(mailto:|tel:|javascript:|#)$/i.test(hrefAttr) || hrefAttr === "#") continue;

      let u;
      try {
        u = new URL(a.href, location.href);
      } catch {
        continue;
      }
      if (u.origin !== location.origin) continue; // same-origin only
      // Skip self-links (same path, no hash change).
      if (u.pathname === location.pathname && (!u.hash || u.hash === location.hash)) continue;

      const key = u.pathname + u.hash;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path: u.pathname + u.hash, hrefAttr });
    }
    return out;
  });

  return items.slice(0, routesLimit);
}

/**
 * Navigate to one route by clicking its link (client-side), then go back home via
 * history (also client-side). Every step is best-effort: a flaky link must not abort
 * the whole run.
 */
export async function visitRoute(page, route, settleMs) {
  const sel = `a[href="${route.hrefAttr.replace(/"/g, '\\"')}"]`;
  try {
    await page.locator(sel).first().click({ timeout: 3000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(settleMs);
    // Return home client-side (history back), NOT a reload.
    await page.goBack({ waitUntil: "networkidle", timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(settleMs);
    return true;
  } catch {
    // If clicking failed (link not present on this view), try to recover to home.
    await page.goBack({ timeout: 3000 }).catch(() => {});
    return false;
  }
}
