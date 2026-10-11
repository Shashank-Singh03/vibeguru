import { setupWorkbench, control, requireState, paint } from "./workbench.mjs";
export const setup = setupWorkbench;
export const checks = ["pending-request-observed", "home-view-reached", "pending-view-isolation"];
const variant = process.env.VIBEGURU_LAB_VARIANT || "nav-pending";

export default async function flow(page, { cycle, check, observe, mark }) {
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await control(page, "plan", { token: `navigation-${cycle}`, scenario: "hold" });
  let released = false, primary;
  try {
    await page.getByRole("button", { name: "Details", exact: true }).click();
    const state = await requireState(page, value => value.held && value.attempt === 1);
    observe("pending-request", { variant, server: state, view: await page.locator("#heading").innerText() });
    check("pending-request-observed", state.held && state.attempt === 1, "Server is holding the actual Details request");
    if (variant === "nav-complete") {
      const response = page.waitForResponse(item => new URL(item.url()).pathname === "/api/detail").then(item => item.finished());
      await control(page, "release", {}); released = true;
      const error = await response; if (error) throw new Error(String(error)); await paint(page);
    }
    await page.getByRole("button", { name: "Home", exact: true }).click();
    check("home-view-reached", await page.getByRole("heading", { name: "Home", exact: true }).isVisible(), "Navigation reaches Home without reloading");
    if (variant === "interrupted") throw new Error("Deliberately interrupted before pending response release");
    if (!released) {
      const response = page.waitForResponse(item => new URL(item.url()).pathname === "/api/detail").then(item => item.finished());
      await control(page, "release", {}); released = true;
      const error = await response; if (error) throw new Error(String(error)); await paint(page);
    }
    const trace = [], started = Date.now();
    do {
      trace.push({ elapsed_ms: Date.now() - started, heading: await page.locator("#heading").innerText(), status: await page.locator("#view-status").innerText() });
      await page.waitForTimeout(25);
    } while (Date.now() - started < 300);
    observe("pending-navigation-result", { window_ms: 300, trace, server: await control(page, "state") });
    check("pending-view-isolation", trace.every(value => value.heading === "Home" && value.status === "Home ready"), "The departed Details response must not alter Home during the 300ms post-response window");
    await mark("pending-navigation");
  } catch (error) { primary = error; }
  finally {
    try {
      if (!released) await control(page, "release", {});
      await paint(page); await page.getByRole("button", { name: "Home", exact: true }).click();
      const restored = await page.locator("#view-status").innerText() === "Home ready";
      observe("pending-cleanup", { restored, server: await control(page, "state") });
      if (!restored) throw new Error("Home restoration failed");
    } catch (cleanup) { throw primary ? new AggregateError([primary, cleanup], "Scenario and restoration failed") : cleanup; }
  }
  if (primary) throw primary;
}
