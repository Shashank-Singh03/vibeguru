import { setupWorkbench, control, requireState, until, paint } from "./workbench.mjs";
export const setup = setupWorkbench;
export const checks = ["recovery-request-observed", "recovery-condition-delivered", "recovery-usable"];
const variant = process.env.VIBEGURU_LAB_VARIANT || "http-503";
const scenarios = { "http-normal": "normal", "http-503": "503-once", "http-disconnect": "disconnect-once", "http-malformed": "malformed-once" };

export default async function flow(page, { cycle, check, observe, mark }) {
  const scenario = scenarios[variant];
  if (!scenario) throw new Error("Unsupported HTTP recovery scenario");
  const token = `recovery-${cycle}`;
  await control(page, "plan", { token, scenario });
  // Restore between cycles through the app's normal button state; broken mode is
  // expected to stay stuck, so this isolated fixture provides a fresh view reset.
  await page.locator("#recover").evaluate(button => { button.disabled = false; });
  await page.getByRole("button", { name: "Recover data", exact: true }).click();
  let state = await requireState(page, value => value.events.some(item => item.kind === "delivered"));
  check("recovery-request-observed", state.attempt >= 1, "Actual recovery request reaches the local server");
  const wanted = scenario === "normal" ? 200 : scenario === "503-once" ? 503 : scenario === "disconnect-once" ? "disconnect" : "malformed-json";
  const delivered = state.events.some(item => item.kind === "delivered" && item.status === wanted);
  observe("recovery-condition", { variant, scenario, server: state, requested_status: wanted });
  check("recovery-condition-delivered", delivered, "The declared server response or transport fault was delivered");
  const first = await until(async () => ({ enabled: await page.locator("#recover").isEnabled(), status: await page.locator("#recovery-status").innerText() }), value => value.enabled, 600);
  if (scenario !== "normal" && first.value.enabled && !first.value.status.startsWith("Ready:")) {
    await page.getByRole("button", { name: "Recover data", exact: true }).click();
  }
  const final = await until(async () => ({ enabled: await page.locator("#recover").isEnabled(), status: await page.locator("#recovery-status").innerText() }), value => value.enabled && value.status === `Ready: ${token}`, 600);
  await paint(page); state = await control(page, "state");
  observe("recovery-result", { first, final, server: state, ui_deadline_ms: 600, reset_disabled_between_cycles: true });
  check("recovery-usable", final.reached && (scenario === "normal" ? state.attempt === 1 : state.attempt >= 2), "A usable result and enabled action return within the declared deadline after recovery/retry");
  await mark("http-recovery");
}
