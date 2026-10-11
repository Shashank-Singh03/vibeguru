import { isolate, exerciseFault, requiredVisible } from "./common.mjs";
export const checks = ["metrics-loaded", "api-list-visible"];
const metrics = { total_requests: 100, requests_2xx: 98, requests_4xx: 1, requests_5xx: 1,
  average_latency_ms: 20, p95_latency_ms: 40, p99_latency_ms: 60, requests_per_second: 5 };
const api = { id: "lab-api", name: "Lab API", base_path: "/lab", enabled: true, tags: [] };

export async function setup(page, { config }) {
  await isolate(page, config, url => {
    if (!url.pathname.startsWith("/admin/")) return undefined;
    if (url.pathname === "/admin/metrics/summary") return metrics;
    if (url.pathname === "/admin/apis") return [api];
    if (url.pathname === "/admin/logs") return { logs: [], total: 0 };
    if (url.pathname === "/admin/rate-policies" || url.pathname.endsWith("/routes")) return [];
    if (url.pathname === "/admin/apis/lab-api") return api;
    return undefined;
  });
}

export default async function flow(page, { cycle, mark, check }) {
  await page.getByRole("link", { name: "Logs", exact: true }).click();
  await page.getByRole("heading", { name: "Logs", exact: true }).waitFor();
  await page.getByRole("link", { name: "Traffic & Metrics", exact: true }).click();
  await page.getByRole("heading", { name: "Traffic & Metrics", exact: true }).waitFor();
  check("metrics-loaded", await page.getByText("Total Requests", { exact: true }).isVisible(), "Metrics render with the fixture dataset");
  await page.getByRole("link", { name: "APIs", exact: true }).click();
  const heading = page.getByRole("heading", { name: "APIs", exact: true });
  await heading.waitFor();
  await page.getByText("Lab API", { exact: true }).waitFor();
  await exerciseFault(page, cycle);
  await requiredVisible(page, check, heading, "api-list-visible");
  await mark("gateway-navigation");
}
