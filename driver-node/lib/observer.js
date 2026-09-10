// observer.js — passive runtime observation, riding along on the memory run.
//
// The memory cycle already mounts and unmounts every route in a real browser. That
// is exactly the exercise you need to surface runtime breakage, so we attach a set
// of listeners to the same page and collect what the app *says* while it runs:
// uncaught exceptions, console errors, failed requests, and runaway DOM mutation.
//
// Like the sampler, this file never decides "broken / fine" — it reports what
// happened, deduplicated and counted. The Elixir analyzer does the judging.

// Dev servers are noisy. These patterns are framework/tooling chatter that says
// nothing about the app's own health, so they never become evidence.
const NOISE = [
  /\[vite\]/i,
  /\[hmr\]/i,
  /react devtools/i,
  /download the react devtools/i,
  /webpack-dev-server/i,
  /\[webpack\]/i,
  /sourcemap/i,
  /favicon\.ico/i,
  /chrome-extension:\/\//i,
  /devtools:\/\//i,
];

const isNoise = (text) => NOISE.some((re) => re.test(text));

/**
 * Collapse a message into a stable signature so the same error raised 400 times
 * across 20 cycles is one finding with a count, not 400 findings. URLs, hashes and
 * bare numbers vary per build/run, so they are masked before comparison.
 */
function signature(message) {
  return String(message ?? "")
    .replace(/https?:\/\/[^\s)"']+/g, "<url>")
    .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .trim()
    .slice(0, 300);
}

/** First app-owned frame of a stack, so a finding can point somewhere useful. */
function topFrame(stack) {
  if (!stack) return null;
  const lines = String(stack).split("\n").slice(1);
  const frame = lines.find((l) => /\.(jsx?|tsx?|mjs|cjs|vue|svelte)/.test(l) && !/node_modules/.test(l));
  return (frame || lines[0] || "").trim().slice(0, 200) || null;
}

/**
 * Attach observers to a page. Returns a handle:
 *   route(path)  — tell the observer which route is being exercised
 *   mutations()  — read + reset the DOM-mutation counter
 *   events()     — aggregated, deduplicated events
 */
export async function observe(page) {
  // key -> { type, message, count, routes:Set, frame, status }
  const seen = new Map();
  let currentRoute = "/";

  // `route` is the route to blame, which is NOT always the route that is current
  // when the event fires — see the request-origin tracking below.
  const record = (type, message, extra = {}, route = currentRoute) => {
    const text = String(message ?? "");
    if (!text || isNoise(text)) return;

    const key = `${type}::${signature(text)}`;
    const hit = seen.get(key);

    if (hit) {
      hit.count += 1;
      hit.routes.add(route);
      return;
    }

    seen.set(key, {
      type,
      message: text.slice(0, 500),
      count: 1,
      routes: new Set([route]),
      ...extra,
    });
  };

  // A request started on one route can fail after the crawler has already moved on,
  // so blaming "whatever route is current when it fails" is wrong — and wrong in the
  // worst way, since it can pin a failure on a route that is actually healthy.
  // Remember which route issued each request and attribute the outcome back to it.
  const requestOrigin = new WeakMap();
  // Also keyed by URL, because Chrome's own console narration of a failed request
  // ("Failed to load resource") arrives as a console message with no request object
  // attached — only a location URL. Without this the echo lands on whichever route
  // happened to be mounted when the connection finally gave up.
  //
  // Restricted to fetch/xhr on purpose. Every module, stylesheet and image is also a
  // request, and most are fetched during the initial load while the current route is
  // still "/" — so indexing those would re-tag an ordinary console.error from a
  // component file to the home route. Only the app's own data calls belong here.
  const DATA_REQUESTS = new Set(["fetch", "xhr"]);
  const urlOrigin = new Map();

  page.on("request", (req) => {
    requestOrigin.set(req, currentRoute);
    if (DATA_REQUESTS.has(req.resourceType?.())) urlOrigin.set(req.url(), currentRoute);
  });

  const originOf = (req) => requestOrigin.get(req) ?? currentRoute;

  // Uncaught exceptions — the white-screen class of failure.
  page.on("pageerror", (err) => {
    record("page_error", err?.message || String(err), { frame: topFrame(err?.stack) });
  });

  // console.error only. Warnings are too noisy in dev to be actionable.
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // console messages carry a structured location, not a stack.
    const loc = msg.location?.();
    const frame = loc?.url ? `${loc.url}:${loc.lineNumber ?? 0}:${loc.columnNumber ?? 0}` : null;
    // If the message points at a URL we issued a request for, blame the route that
    // issued it rather than the route that happens to be mounted now.
    const route = (loc?.url && urlOrigin.get(loc.url)) ?? currentRoute;
    record("console_error", msg.text(), { frame }, route);
  });

  // Network failures: transport-level (DNS, refused, aborted).
  page.on("requestfailed", (req) => {
    const failure = req.failure?.()?.errorText || "request failed";
    // Aborted requests are normal during client-side nav teardown.
    if (/ERR_ABORTED/i.test(failure)) return;
    record("request_failed", `${failure} — ${req.url()}`, { url: req.url() }, originOf(req));
  });

  // Application-level HTTP failures.
  page.on("response", (res) => {
    const status = res.status();
    if (status < 400) return;
    record(
      "http_error",
      `HTTP ${status} — ${res.url()}`,
      { url: res.url(), status },
      originOf(res.request())
    );
  });

  // Runaway-render detector. A component that sets state in an unguarded effect
  // re-renders forever; the visible symptom is DOM mutations that never stop even
  // when the page is idle. We count mutations in-page and let the run loop read the
  // counter across idle settle windows.
  await page.addInitScript(() => {
    window.__vibeguru_mutations = 0;
    const start = () => {
      if (!document.body || window.__vibeguru_observer) return;
      window.__vibeguru_observer = new MutationObserver((records) => {
        window.__vibeguru_mutations += records.length;
      });
      window.__vibeguru_observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  });

  return {
    route(path) {
      currentRoute = path || "/";
    },

    /** Read the mutation counter and reset it, so each window is independent. */
    async mutations() {
      return page
        .evaluate(() => {
          const n = window.__vibeguru_mutations || 0;
          window.__vibeguru_mutations = 0;
          return n;
        })
        .catch(() => null);
    },

    events() {
      return [...seen.values()].map((e) => ({
        type: e.type,
        message: e.message,
        count: e.count,
        routes: [...e.routes],
        frame: e.frame ?? null,
        url: e.url ?? null,
        status: e.status ?? null,
      }));
    },
  };
}
