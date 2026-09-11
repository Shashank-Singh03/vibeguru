"use strict";

// A stand-in for a Playwright Page and CDP session, good enough to exercise the
// navigation and sampling logic without launching a browser.
//
// The one awkward part: both files under test hand *closures* to a remote runtime
// (`page.evaluate(() => location.pathname)` runs in the browser, not here), so the
// fake cannot execute them meaningfully. It dispatches on the closure's source text
// instead. That is a real technique for testing code that talks to another runtime,
// but it is also a coupling: if someone rewrites one of those closures the fake must
// learn about it. The e2e job is what catches that, which is why these tests
// complement it rather than replace it.

const ORIGIN = "http://localhost:5173";

/**
 * @param {object} opts
 *   path       starting pathname
 *   links      what discover() should see: [{ path, hrefAttr }]
 *   clickFails make every link click fail (simulates a hidden or detached link)
 *   guard      { "/protected": "/login" } — a router that redirects on entry
 *   mutations  what the mutation counter reports
 */
function fakePage({ path = "/", links = [], clickFails = false, guard = {}, mutations = 0 } = {}) {
  const calls = { goto: 0, clicks: [], pushes: [], back: 0, evaluates: [] };
  const history = [];
  let current = path;

  // A router that may bounce you somewhere else on entry.
  const enter = (target) => {
    history.push(current);
    current = guard[target] || target;
  };

  return {
    calls,
    get current() {
      return current;
    },

    url: () => ORIGIN + current,

    // Must never be called: a full document load resets the JS heap, which would
    // make every leak vanish. Tests assert this stays at zero.
    goto: async () => {
      calls.goto += 1;
    },

    // discover() passes a browser-side callback we cannot run; return canned links.
    $$eval: async () => links,

    locator: (sel) => ({
      first: () => ({
        click: async () => {
          calls.clicks.push(sel);
          if (clickFails) throw new Error("element is not visible");
          const href = /a\[href="(.*)"\]/.exec(sel);
          enter(href ? href[1] : "/");
        },
      }),
    }),

    evaluate: async (fn, arg) => {
      const src = String(fn);
      calls.evaluates.push(src);

      if (src.includes("pushState")) {
        calls.pushes.push(arg);
        enter(arg);
        return undefined;
      }
      if (src.includes("location.pathname")) return current;
      if (src.includes("__vibeguru_mutations")) return mutations;
      if (src.includes("performance") || src.includes("canvas")) {
        return {
          heapUsed: 10_000_000,
          heapTotal: 20_000_000,
          heapLimit: 2_000_000_000,
          canvases: 0,
          webglContexts: 0,
        };
      }
      return undefined;
    },

    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
    goBack: async () => {
      calls.back += 1;
      current = history.pop() ?? "/";
    },
    on: () => {},
    addInitScript: async () => {},
  };
}

/**
 * A stand-in CDP session.
 *
 * @param {object} opts
 *   fail      Set of method names that should reject
 *   counters  what Memory.getDOMCounters returns
 */
function fakeClient({ fail = new Set(), counters = { documents: 3, nodes: 1200, jsEventListeners: 40 } } = {}) {
  const sent = [];

  return {
    sent,
    send: async (method) => {
      sent.push(method);
      if (fail.has(method)) throw new Error(`${method} unavailable`);
      if (method === "Memory.getDOMCounters") return counters;
      return {};
    },
  };
}

module.exports = { fakePage, fakeClient, ORIGIN };
