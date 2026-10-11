import { isolate, exerciseFault, requiredVisible } from "./common.mjs";
export const checks = ["access-table-visible", "broker-list-visible"];

export async function setup(page, { config }) {
  await page.addInitScript(() => localStorage.setItem("user", JSON.stringify({
    username: "lab-only", role: "Super Admin", is_admin: true
  })));
  await isolate(page, config, url => {
    if (!url.pathname.startsWith("/api/")) return undefined;
    if (url.pathname === "/api/stations/daily-stats") return {};
    if (["/api/stations", "/api/brokers", "/api/users"].includes(url.pathname)) return [];
    return undefined;
  });
}

export default async function flow(page, { cycle, mark, check }) {
  await page.getByTitle("Open menu", { exact: true }).click();
  await page.getByRole("button", { name: "Access Panel", exact: true }).click();
  await page.getByRole("heading", { name: "Access Control", exact: true }).waitFor();
  check("access-table-visible", await page.getByRole("table").isVisible(), "Access table renders with isolated fixture data");
  await page.getByTitle("Open menu", { exact: true }).click();
  await page.getByRole("button", { name: "Brokers", exact: true }).click();
  const heading = page.getByRole("heading", { name: "Select a Broker", exact: true });
  await heading.waitFor();
  await exerciseFault(page, cycle);
  await requiredVisible(page, check, heading, "broker-list-visible");
  await mark("swap-access-navigation");
}
