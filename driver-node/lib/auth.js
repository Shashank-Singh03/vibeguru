// auth.js — capture a signed-in session once, so later runs can see the real app.
//
// Most of an app worth testing sits behind a login. Coverage reporting made that
// visible rather than silent — runs started saying "12 routes redirected to a
// sign-in page" instead of quietly reporting three routes as healthy — but seeing
// the wall is not the same as getting past it.
//
// So: open a real browser, let the person log in the way they normally would, and
// keep the resulting cookies and localStorage. No credentials are asked for, typed,
// stored, or transmitted by this tool; the user authenticates directly with their
// own app and we save only the session that results.

import { chromium } from "playwright";

// Snapshotting on an interval rather than on a signal, because there is no reliable
// signal: the driver runs with stdin closed (it is a spawned port), so there is no
// "press enter when done", and storage state cannot be read once the browser has
// already gone. Polling means the state we keep is at most one tick stale, which
// after a login that finished seconds ago is not stale at all.
const SNAPSHOT_MS = 2000;

export async function authenticate(config, emit) {
  const startedAt = Date.now();

  // Headed, always. The whole point is that a person can see and use the page.
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  let latest = null;
  let snapshots = 0;

  const snapshot = async () => {
    try {
      latest = await context.storageState();
      snapshots += 1;
    } catch {
      // Context is gone (browser closing). Whatever we captured last still stands.
    }
  };

  try {
    emit({ type: "log", phase: "auth", message: `opening ${config.url}` });
    await page.goto(config.url, { waitUntil: "domcontentloaded", timeout: 30000 });

    emit({
      type: "log",
      phase: "auth",
      message: "sign in as you normally would, then close the browser window to save the session",
    });

    await snapshot();
    // A navigation usually means the login just completed, so capture promptly
    // rather than waiting out the interval.
    page.on("framenavigated", snapshot);
    const timer = setInterval(snapshot, SNAPSHOT_MS);

    try {
      await waitForClose(browser, config.timeoutMs);
    } finally {
      clearInterval(timer);
    }

    if (!latest) {
      throw new Error("the browser closed before any session could be captured");
    }

    return {
      ok: true,
      url: config.url,
      cookies: latest.cookies?.length || 0,
      origins: latest.origins?.length || 0,
      snapshots,
      storageState: latest,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Resolve when the user closes the browser, or when we give up waiting.
 *
 * A timeout is not a failure — someone may have logged in and wandered off. We stop
 * waiting and save whatever was captured, which is usually exactly what they wanted.
 */
function waitForClose(browser, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(finish, timeoutMs || 600000);
    browser.on("disconnected", finish);
  });
}
