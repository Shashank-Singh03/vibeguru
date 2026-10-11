// Wall-clock samples are summarized within comparable groups, never added across
// parent commands and their nested Node/ExUnit records.
export function distribution(values) {
  const sorted = values.filter(value => typeof value === "number" && Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { samples: 0, median_ms: null, p95_ms: null, min_ms: null, max_ms: null };
  const mid = Math.floor(sorted.length / 2);
  return { samples: sorted.length, median_ms: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    p95_ms: sorted[Math.ceil(sorted.length * .95) - 1], min_ms: sorted[0], max_ms: sorted.at(-1) };
}

export function timingAnalytics(suites, cases) {
  const unique = [...new Map(suites.filter(item => item?.id).map(item => [item.id, item])).values()];
  const completed = unique.filter(item => ["PASS", "FAIL", "ERROR"].includes(item.status) && item.finished_at &&
    typeof item.duration_ms === "number" && Number.isFinite(item.duration_ms) && item.duration_ms >= 0);
  const groupName = item => item.suite === "Elixir tests" && item.scope !== "repository"
    ? `Elixir tests · scope unknown · ${Number.isInteger(item.tests) ? item.tests : "unknown"} tests` : item.suite;
  const names = ["Full repository check", "Elixir repository check", "Formatting", "Compile", "Elixir command", "Node command", "Elixir tests", "Node tests", "Package smoke"];
  for (const item of completed) if (!names.includes(groupName(item))) names.push(groupName(item));
  const suiteGroups = names.map(suite => {
    const records = completed.filter(item => groupName(item) === suite).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
    const latest = records[0];
    return { suite, ...distribution(records.map(item => item.duration_ms)),
      pass: records.filter(item => item.status === "PASS").length,
      failed: records.filter(item => item.status !== "PASS").length,
      latest: latest ? { id: latest.id, duration_ms: latest.duration_ms, status: latest.status, stale: latest.stale ?? null,
        source_revision: latest.source_revision, started_at: latest.started_at, stages: latest.stages || [], log_path: latest.log_path } : null,
      history: records.slice(0, 12).reverse().map(item => ({ id: item.id, duration_ms: item.duration_ms, status: item.status, started_at: item.started_at })) };
  }).filter(group => group.samples);
  const browser = new Map();
  for (const item of cases) {
    if (item.scope_complete !== true || !["PASS", "FAIL"].includes(item.verdict) || typeof item.duration_ms !== "number" || !Number.isFinite(item.duration_ms) || item.duration_ms < 0) continue;
    const key = JSON.stringify([item.app, item.variant, item.cycles]);
    if (!browser.has(key)) browser.set(key, { app: item.app, variant: item.variant, cycles: item.cycles, records: [] });
    browser.get(key).records.push(item);
  }
  return { suite_groups: suiteGroups, unmeasured_suites: unique.length - completed.length,
    browser_groups: [...browser.values()].map(({ records, ...group }) => ({ ...group,
      ...distribution(records.map(item => item.duration_ms)), pass: records.filter(item => item.verdict === "PASS").length,
      fail: records.filter(item => item.verdict === "FAIL").length })).sort((a, b) => b.samples - a.samples),
    incomplete_browser_cases: cases.filter(item => item.scope_complete !== true).length,
    limitations: ["Full checks are measured wall time; nested suite durations are not added to their parent commands.",
      "Browser samples require complete assessed measurements and journeys; FAIL alone does not establish completion. Incomplete cases are counted separately.",
      "Elixir runs without explicit repository scope are separated by recorded test count; historical focused runs are not assumed to be full suites.",
      "Historical local samples differ in source, load and cache state. These are observations, not customer latency guarantees.",
      "p95 uses nearest rank; with fewer than twenty samples it often equals the maximum."] };
}
