// sampler.js — take one interpretation-free measurement of the page's memory state.
//
// All numbers come from the Chrome DevTools Protocol (CDP) or the page's own
// performance API. We never decide "leak / not leak" here — that's the Elixir
// analyzer's job. We just report what is true at this instant.

/**
 * Force a garbage collection in the renderer so we can distinguish *retained*
 * memory (a real leak) from *uncollected garbage* (normal, transient).
 * This is the browser analogue of the backend "cooldown" phase.
 */
export async function collectGarbage(client) {
  try {
    await client.send("HeapProfiler.collectGarbage");
  } catch {
    // Fallback: best-effort purge if HeapProfiler is unavailable.
    try {
      await client.send("Memory.forciblyPurgeJavaScriptMemory");
    } catch {
      /* ignore — GC is best-effort */
    }
  }
}

/**
 * Take a single sample. Returns a plain object the caller wraps into an evidence line.
 *
 *  - DOM counters via CDP `Memory.getDOMCounters`: { documents, nodes, jsEventListeners }
 *    `nodes` is the gold leak metric — native DOM nodes alive in the renderer.
 *  - JS heap via `performance.memory` (needs --enable-precise-memory-info for exactness).
 *  - canvas count as a cheap chart/WebGL-leak signal.
 */
export async function sample(page, client) {
  let dom = { documents: null, nodes: null, jsEventListeners: null };
  try {
    dom = await client.send("Memory.getDOMCounters");
  } catch {
    /* leave nulls */
  }

  const mem = await page
    .evaluate(() => {
      const m = (typeof performance !== "undefined" && performance.memory) || {};
      const canvases = document.querySelectorAll("canvas").length;
      // Best-effort: how many canvases currently hold a live WebGL context.
      let webglContexts = 0;
      for (const c of document.querySelectorAll("canvas")) {
        try {
          if (
            c.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
            c.getContext("webgl") ||
            c.getContext("experimental-webgl")
          ) {
            // NOTE: getContext returns the *existing* context if one was created
            // with a compatible type; otherwise it creates one. We only count
            // canvases that are attached, as a coarse signal.
            webglContexts += 1;
          }
        } catch {
          /* ignore */
        }
      }
      return {
        heapUsed: m.usedJSHeapSize ?? null,
        heapTotal: m.totalJSHeapSize ?? null,
        heapLimit: m.jsHeapSizeLimit ?? null,
        canvases,
        webglContexts,
      };
    })
    .catch(() => ({
      heapUsed: null,
      heapTotal: null,
      heapLimit: null,
      canvases: null,
      webglContexts: null,
    }));

  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    heapLimit: mem.heapLimit,
    nodes: dom.nodes ?? null,
    listeners: dom.jsEventListeners ?? null,
    documents: dom.documents ?? null,
    canvases: mem.canvases,
    webglContexts: mem.webglContexts,
  };
}
