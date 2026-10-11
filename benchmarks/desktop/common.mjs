// Controlled faults only exist in the disposable browser context, never app source.
export const variant = process.env.VIBEGURU_LAB_VARIANT || "baseline";

export async function isolate(page, config, fixtures = null) {
  const origin = new URL(config.url).origin;
  page.setDefaultTimeout(5000);
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    // Deliberate local substitute: typography is outside this runtime experiment.
    if (url.hostname === "fonts.googleapis.com") return route.fulfill({ status: 200, contentType: "text/css", body: "" });
    const fixture = fixtures?.(url, route.request());
    if (fixture !== undefined && fixture !== null) {
      return route.fulfill({ status: 200, contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" },
        body: JSON.stringify(fixture) });
    }
    if (url.origin === origin || ["data:", "blob:"].includes(url.protocol)) return route.continue();
    return route.abort("blockedbyclient");
  });
}

export async function exerciseFault(page, cycle) {
  await page.evaluate(({ variant, cycle }) => {
    const state = globalThis.__vibeguru_lab_faults ||= { retained: [], listeners: [] };
    if (["listener-leak", "combined"].includes(variant)) {
      for (let i = 0; i < 12; i++) {
        const listener = () => cycle;
        window.addEventListener("vibeguru-lab-only", listener);
        state.listeners.push(listener);
      }
    }
    if (["heap-leak", "combined", "partial-fixed"].includes(variant)) {
      state.retained.push(new Array(200000).fill(cycle));
    }
    if (["runtime-error", "combined"].includes(variant)) {
      setTimeout(() => { throw new Error("vibeguru_lab_runtime_defect"); }, 0);
    }
  }, { variant, cycle });
  await page.waitForTimeout(150);
}

export async function requiredVisible(page, check, locator, id) {
  if (variant === "interrupted") throw new Error("Benchmark interrupted before completing required assertions");
  if (variant === "invalid-fix") await locator.evaluate(el => { el.hidden = true; });
  check(id, await locator.isVisible(), "Required application content remains visible");
}
