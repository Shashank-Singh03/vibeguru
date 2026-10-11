// Separate functional evaluation of an existing source-level navigation gap.
// This is not a seeded fault and is not part of the injection detection score.
import { setup as setupGateway } from "./gateway.mjs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
export const checks = ["create-api-form"];

export async function setup(page, context) {
  await setupGateway(page, context);
  await page.route("**/admin/apis/new", route => route.fulfill({
    status: 404, contentType: "application/json",
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" },
    body: JSON.stringify({ error: "No API with id new exists in the controlled dataset" })
  }));
}

export default async function flow(page, { cycle, check }) {
  await page.getByRole("link", { name: "APIs", exact: true }).click();
  await page.getByRole("button", { name: "Create API", exact: true }).click();
  await page.getByText("API not found", { exact: true }).waitFor();
  const observation = { cycle, url: page.url(), body: await page.locator("body").innerText(),
    fixture: "GET /admin/apis/new returns 404; other API list/metrics data uses the gateway fixtures" };
  if (process.env.VIBEGURU_LAB_EVIDENCE_DIR) {
    await writeFile(join(process.env.VIBEGURU_LAB_EVIDENCE_DIR, `create-observation-${cycle}.json`), JSON.stringify(observation, null, 2));
    if (cycle === 1) await page.screenshot({ path: join(process.env.VIBEGURU_LAB_EVIDENCE_DIR, "create-api.png"), fullPage: true });
  }
  check("create-api-form", await page.locator("form").first().isVisible(),
    "Create API should reach a creation form; the observed view instead says API not found");
}
