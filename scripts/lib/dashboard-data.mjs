import { readdir, readFile, stat, realpath } from "node:fs/promises";
import { join, relative, resolve, isAbsolute, extname } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { sourceRevision, repositoryRoot } from "./test-history.mjs";
import { timingAnalytics } from "./timing.mjs";
const { assessReport } = createRequire(import.meta.url)("../../mcp/report.js");

const skip = new Set(["node_modules", ".git", "src", "dist", "client", "server", "vendor", "_build", "deps", "test-history"]);
const synthetic = new Set(["listener-leak", "heap-leak", "runtime-error", "combined", "partial-fixed", "invalid-fix", "reconnect-broken"]);
const slash = path => path.replaceAll("\\", "/");
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const emptyGraph = () => ({ nodes: [], edges: [] });

export function area(path) {
  if (path.startsWith("dashboard/")) return "Dashboard";
  if (path.startsWith("benchmarks/")) return "Experiments";
  if (path.startsWith("driver-node/")) return "Browser driver";
  if (path.startsWith("lib/")) return "Analysis engine";
  if (path.startsWith("test")) return "Tests";
  if (path.startsWith("docs/") || path.endsWith(".md")) return "Context & docs";
  if (path.startsWith("mcp/")) return "MCP";
  if (path.startsWith("site/")) return "Site";
  return "Tooling & distribution";
}

export function sourceState(root = repositoryRoot) {
  const run = args => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  const status = run(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const fields = (status.stdout || "").split("\0");
  const changes = [];
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]; if (!entry) continue;
    const path = slash(entry.slice(3));
    if (/R|C/.test(entry.slice(0, 2))) i++;
    changes.push({ path, status: entry.slice(0, 2), area: area(path), additions: null, deletions: null });
  }
  const stats = (run(["diff", "--numstat", "HEAD", "--"]).stdout || "").trim().split("\n");
  for (const line of stats) {
    const [add, remove, ...name] = line.split("\t");
    const item = changes.find(change => change.path === slash(name.join("\t")));
    if (item) { item.additions = /^\d+$/.test(add) ? Number(add) : null; item.deletions = /^\d+$/.test(remove) ? Number(remove) : null; }
  }
  return { branch: (run(["branch", "--show-current"]).stdout || "").trim(),
    commit: (run(["rev-parse", "HEAD"]).stdout || "").trim(), dirty: changes.length > 0,
    staged_count: changes.filter(change => ![" ", "?"].includes(change.status[0])).length,
    changes, revision: sourceRevision(root), available: status.status === 0 };
}

export async function artifactPath(root, requested) {
  if (typeof requested !== "string" || requested.includes("\0")) throw new Error("Invalid artifact path");
  const base = await realpath(root);
  const target = await realpath(resolve(root, requested));
  const name = slash(relative(base, target));
  if (isAbsolute(name) || name.startsWith("../") ||
      !["reports/", "docs/context/", "examples/"].some(prefix => name.startsWith(prefix)) ||
      ![".json", ".html", ".md", ".log", ".tap", ".png", ".svg", ".patch"].includes(extname(name).toLowerCase()) ||
      !(await stat(target)).isFile()) throw new Error("Artifact is outside the allowed report directories");
  return target;
}

export function vectorIds(report, item, registry = null) {
  const ids = [];
  if (Array.isArray(report?.evidence) && report.evidence.some(event => event?.kind === "sample")) ids.push("memory-retention", "listener-lifecycle", "runtime-failures");
  if (Array.isArray(report?.run?.censusTargets) && report.run.censusTargets.length) ids.push("constructor-retention");
  if (Array.isArray(report?.run?.journeyChecks) && report.run.journeyChecks.length) ids.push("journey-outcomes");
  if (report?.run?.mode === "auto") ids.push("route-navigation");
  if (item.variant?.startsWith("race-") || item.app?.startsWith("gateway-race")) ids.push("response-order");
  if (item.app?.includes("reconnect")) ids.push("reconnect-convergence");
  if (Array.isArray(registry)) {
    const overlaps = (rule, values) => Array.isArray(rule) && rule.some(value => values.includes(value));
    for (const vector of registry) {
      const match = vector.match;
      if (vector.stage !== "implemented" || !match || typeof match !== "object") continue;
      const findings = Array.isArray(report?.findings) ? report.findings : [];
      const evidence = Array.isArray(report?.evidence) ? report.evidence : [];
      if (overlaps(match.assertion_ids, Array.isArray(report?.run?.journeyChecks) ? report.run.journeyChecks : []) ||
          overlaps(match.signatures, findings.map(finding => finding?.signature)) ||
          overlaps(match.evidence_kinds, evidence.map(event => event?.kind)) ||
          overlaps(match.variants, [item.variant]) || overlaps(match.apps, [item.app]) || overlaps(match.modes, [report?.run?.mode]) ||
          Array.isArray(match.app_prefixes) && match.app_prefixes.some(prefix => typeof prefix === "string" && item.app?.startsWith(prefix))) ids.push(vector.id);
    }
    return [...new Set(ids)].filter(id => registry.some(vector => vector.id === id && vector.stage === "implemented"));
  }
  return [...new Set(ids)];
}

function kind(item) {
  if (item.variant === "interrupted") return "interrupted";
  if (["synthetic", "control", "existing-behavior", "observed"].includes(item.source_kind)) return item.source_kind;
  if (synthetic.has(item.variant)) return "synthetic";
  if (item.app?.includes("gateway-create") || item.app === "gateway-race-original" && item.variant === "race-reordered") return "existing-behavior";
  if (["fixed", "race-ordered"].includes(item.variant) || item.app?.includes("candidate") || item.app?.includes("reconnect")) return "control";
  return "observed";
}

// Count declared per-cycle checks independently from whole-application verdicts.
// A missing, duplicated or misplaced record is unverified, never a passing slot.
export function assertionCoverage(report) {
  const cycles = report?.run?.cycles, checks = report?.run?.journeyChecks;
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 30 || !Array.isArray(checks) ||
      checks.some(id => typeof id !== "string" || !id.trim()) || new Set(checks).size !== checks.length) return [];
  const assertions = Array.isArray(report.evidence) ? report.evidence.filter(event => event?.kind === "journey_assertion") : [];
  return checks.map(id => {
    const count = { id, expected: cycles, passed: 0, failed: 0, unverified: 0 };
    for (let cycle = 1; cycle <= cycles; cycle++) {
      const records = assertions.filter(event => event.cycle === cycle && event.data?.assertionId === id);
      const status = records.length === 1 && records[0].phase === "cycle" ? records[0].data.status : null;
      count[status === "pass" ? "passed" : status === "fail" ? "failed" : "unverified"]++;
    }
    return count;
  });
}

export function createCollector(root = repositoryRoot) {
  const cache = new Map(); let details = new Map();
  async function json(path, warnings, optional = false) {
    try {
      const info = await stat(path);
      const key = `${info.size}:${info.mtimeMs}`;
      if (cache.get(path)?.key === key) return cache.get(path).value;
      const value = JSON.parse(await readFile(path, "utf8")); cache.set(path, { key, value }); return value;
    } catch (error) {
      if (!optional || error.code !== "ENOENT") warnings.push(`${slash(relative(root, path))}: ${error.message.slice(0, 180)}`);
      return null;
    }
  }
  const rel = path => slash(relative(root, path));
  async function present(path) { try { return (await stat(path)).isFile() ? rel(path) : null; } catch { return null; } }

  async function scan(warnings) {
    const found = []; let visited = 0;
    async function walk(directory, depth = 0) {
      if (depth > 5 || visited++ > 1000) return;
      let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
      if (entries.some(entry => ["package.json", ".git"].includes(entry.name))) return;
      if (directory.split(/[\\/]/).at(-1).startsWith("campaign-")) { found.push({ directory, type: "campaign" }); return; }
      if (entries.some(entry => entry.name === "vibeguru-findings.json")) found.push({ directory, type: "standalone" });
      for (const entry of entries) if (entry.isDirectory() && !entry.isSymbolicLink() && !skip.has(entry.name)) await walk(join(directory, entry.name), depth + 1);
    }
    await walk(join(root, "reports"));
    if (visited > 1000) warnings.push("Report discovery reached its directory budget; some runs may be omitted.");
    return found;
  }

  async function snapshot() {
    const warnings = [], source = sourceState(root), campaigns = [], cases = [], nextDetails = new Map();
    const rawRegistry = await json(join(root, "dashboard/vectors.json"), warnings);
    const registry = (Array.isArray(rawRegistry) ? rawRegistry : []).filter(vector => vector && typeof vector.id === "string" &&
      typeof vector.name === "string" && ["implemented", "planned"].includes(vector.stage));
    if (Array.isArray(rawRegistry) && rawRegistry.length !== registry.length) warnings.push("Invalid vector definitions were omitted.");
    if (!source.available) warnings.push("Git working-tree information is unavailable.");
    for (const found of await scan(warnings)) {
      const summary = found.type === "campaign" ? await json(join(found.directory, "summary.json"), warnings, true) : null;
      const records = found.type === "campaign" ? await json(join(found.directory, "results.json"), warnings, true) : [{ app: "standalone", variant: "observed", report: join(found.directory, "vibeguru-findings.json") }];
      const id = found.type === "campaign" ? found.directory.split(/[\\/]/).at(-1) : `standalone:${rel(found.directory)}`;
      const started = Number(/campaign-(\d+)/.exec(id)?.[1]);
      const created = summary?.created_at || (started ? new Date(started).toISOString() : (await stat(join(found.directory, "vibeguru-findings.json"))).mtime.toISOString());
      const campaign = { id, created_at: created, label: summary?.label || (found.type === "campaign" ? found.directory.includes("network") ? "Network experiments" : "Desktop experiments" : rel(found.directory)),
        status: summary || found.type === "standalone" ? "complete" : "running", case_count: Array.isArray(records) ? records.length : 0,
        path: rel(found.directory), expected_injected_signals: summary?.expected_injected_signals || 0,
        detected_injected_signals: summary?.detected_injected_signals || 0, met_expectations: summary?.met_expectations || 0,
        declared_expectation_cases: summary?.declared_expectation_cases || 0 };
      campaigns.push(campaign);
      if (records && !Array.isArray(records)) { warnings.push(`${rel(found.directory)}: malformed campaign results array`); continue; }
      for (const [index, item] of (records || []).entries()) {
        if (!item || typeof item !== "object") { warnings.push(`${id}: malformed case ${index}`); continue; }
        const folder = found.type === "campaign" ? join(found.directory, `${item.app}-${item.variant}`) : found.directory;
        let path = item.report ? resolve(root, item.report) : join(folder, "vibeguru-findings.json");
        let report = null;
        try { path = await artifactPath(root, rel(path)); report = await json(path, warnings); } catch { warnings.push(`${id}/${item.app}/${item.variant}: fresh report unavailable`); }
        const assessment = report ? assessReport(report) : { verdict: "ERROR", reasons: ["Fresh report unavailable"] };
        if (item.execution_identity_stable === false) {
          if (assessment.verdict === "PASS") assessment.verdict = "INCONCLUSIVE";
          assessment.reasons.push("Execution source changed during case");
        }
        const evidence = Array.isArray(report?.evidence) ? report.evidence : [];
        const assertions = evidence.filter(event => event.kind === "journey_assertion");
        const caseId = `${id}/${item.app || "unknown"}/${item.variant || "unknown"}/${index}`;
        const record = { id: caseId, campaign_id: id, app: item.app || "unknown", variant: item.variant || "unknown",
          verdict: assessment.verdict, expectation: item.execution_identity_stable === false
            ? { met: false, mismatches: [...(item.expectation?.mismatches || []), "Execution source changed during case"] }
            : item.expectation || null, source_kind: kind(item),
          cycles: report?.run?.cycles ?? null, duration_ms: item.duration_ms ?? report?.run?.durationMs ?? null,
          scope_complete: ["PASS", "FAIL"].includes(assessment.verdict) && assessment.reasons.length === 0,
          passed_assertions: assertions.filter(event => event.data?.status === "pass").length,
          failed_assertions: assertions.filter(event => event.data?.status === "fail").length,
          assertion_coverage: assertionCoverage(report),
          vector_ids: vectorIds(report, item, registry), findings: Array.isArray(report?.findings) ? report.findings.filter(finding => finding && typeof finding === "object").map(finding => ({ signature: finding.signature, severity: finding.severity,
            summary: finding.summary, metrics: finding.metrics })) : [],
          report_path: report ? rel(path) : null, html_path: await present(join(folder, "vibeguru-report.html")),
          capsule_path: await present(join(folder, "incident-capsule.json")), created_at: created };
        cases.push(record); nextDetails.set(caseId, { record, path, folder, reasons: assessment.reasons, limits: Array.isArray(summary?.limitations) ? summary.limitations : [] });
      }
    }
    campaigns.sort((a, b) => b.created_at.localeCompare(a.created_at));
    cases.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
    const suites = [];
    try {
      for (const entry of await readdir(join(root, "reports/test-history"), { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const record = await json(join(root, "reports/test-history", entry.name), warnings);
        if (record?.id && ["PASS", "FAIL", "ERROR", "RUNNING"].includes(record.status)) suites.push({ ...record, stale: record.source_revision ? record.source_revision !== source.revision : null });
        else warnings.push(`Invalid test history record: ${entry.name}`);
      }
    } catch (error) { if (error.code !== "ENOENT") warnings.push(error.message); }
    const packageRecord = await json(join(root, "reports/package-smoke-win32-x64.json"), warnings, true);
    if (packageRecord && !suites.some(item => item.suite === "Package smoke" && item.log_path === "reports/package-smoke-win32-x64.json")) {
      const info = await stat(join(root, "reports/package-smoke-win32-x64.json"));
      suites.push({ id: "package-smoke-win32-x64", suite: "Windows package smoke", command: "npm run test:package",
        status: packageRecord.passed === true ? "PASS" : "FAIL", started_at: info.mtime.toISOString(), finished_at: info.mtime.toISOString(),
        duration_ms: packageRecord.duration_ms ?? null, tests: packageRecord.checks?.length || null, passed: packageRecord.passed ? packageRecord.checks?.length : 0,
        failed: packageRecord.passed ? 0 : null, skipped: 0, failures: [], log_path: "reports/package-smoke-win32-x64.json",
        source_revision: packageRecord.source_revision ?? null, stale: packageRecord.source_revision ? packageRecord.source_revision !== source.revision : null });
    }
    suites.sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""));
    const activity = await json(join(root, "dashboard/activity.json"), warnings);
    const vectors = (Array.isArray(registry) ? registry : []).map(vector => {
      const related = cases.filter(item => item.vector_ids.includes(vector.id));
      const targetIds = vector.stage === "implemented" && Array.isArray(vector.match?.assertion_ids) ? vector.match.assertion_ids : [];
      const targetChecks = targetIds.length ? { ids: targetIds, expected: 0, passed: 0, failed: 0, unverified: 0 } : null;
      if (targetChecks) for (const item of related) for (const check of item.assertion_coverage) {
        if (targetIds.includes(check.id)) for (const key of ["expected", "passed", "failed", "unverified"]) targetChecks[key] += check[key];
      }
      return { ...vector, case_count: related.length, passed: related.filter(item => item.verdict === "PASS").length,
        target_checks: targetChecks,
        failed: related.filter(item => item.verdict === "FAIL").length, inconclusive: related.filter(item => item.verdict === "INCONCLUSIVE").length,
        error: related.filter(item => item.verdict === "ERROR").length, latest_verdict: related[0]?.verdict || null,
        last_run: related[0]?.created_at || null, assertions_passed: related.reduce((n, item) => n + item.passed_assertions, 0),
        assertions_failed: related.reduce((n, item) => n + item.failed_assertions, 0) };
    });
    const summary = { campaigns: campaigns.length, cases: cases.length, pass: cases.filter(item => item.verdict === "PASS").length,
      fail: cases.filter(item => item.verdict === "FAIL").length, inconclusive: cases.filter(item => item.verdict === "INCONCLUSIVE").length,
      error: cases.filter(item => item.verdict === "ERROR").length, expected_matched: cases.filter(item => item.expectation?.met === true).length,
      expected_total: cases.filter(item => item.expectation).length, assertions_passed: cases.reduce((n, item) => n + item.passed_assertions, 0),
      assertions_failed: cases.reduce((n, item) => n + item.failed_assertions, 0), active_vectors: vectors.filter(vector => vector.stage === "implemented").length };
    const uiStamps = await Promise.all(["index.html", "app.js", "styles.css"].map(async name => {
      try { const info = await stat(join(root, "dashboard", name)); return [name, info.size, info.mtimeMs]; } catch { return [name, null]; }
    }));
    const data = { schema_version: 1, ui_revision: hash(uiStamps), source, summary, campaigns, cases, vectors, suites,
      timing: timingAnalytics(suites, cases),
      activity: Array.isArray(activity) ? activity : [], warnings: [...new Set(warnings)], limitations: [
        "Historical runs include calibration and repeated experiments; totals are not independent trials or product accuracy.",
        "App verdicts and expected experiment outcomes are separate. An expected negative case remains an app FAIL.",
        "Vector counts represent attempted scoped cases. Overall case verdicts may be caused by another vector or missing measurements.",
        "Planned vectors have no validation claim. Source changes do not automatically rerun tests.",
        "Suite records capture npm test and mix test from this workflow; older undocumented terminal runs are not invented."] };
    details = nextDetails;
    return { ...data, generated_at: new Date().toISOString(), revision: hash(data) };
  }

  async function caseDetail(id) {
    const entry = details.get(id); if (!entry) return null;
    const warnings = [];
    const report = await json(entry.path, warnings, true);
    const capsule = await json(join(entry.folder, "incident-capsule.json"), warnings, true);
    const evidence = Array.isArray(report?.evidence) ? report.evidence : [];
    const graph = capsule?.graph && Array.isArray(capsule.graph.nodes) && Array.isArray(capsule.graph.edges) ? capsule.graph : emptyGraph();
    const paths = [{ label: "Findings JSON", path: entry.record.report_path }, { label: "HTML evidence report", path: entry.record.html_path },
      { label: "Incident capsule", path: entry.record.capsule_path }, { label: "Execution log", path: await present(join(entry.folder, "execution.log")) },
      { label: "Markdown report", path: await present(join(entry.folder, "vibeguru-report.md")) }].filter(item => item.path);
    return { ...entry.record, assertions: evidence.filter(event => event.kind === "journey_assertion").map(event => ({ id: event.data?.assertionId, cycle: event.cycle, status: event.data?.status, message: event.data?.message })),
      observations: evidence.filter(event => event.kind === "experiment_observation").map(event => ({ id: event.id, cycle: event.cycle, name: event.data?.observationId, payload: event.data?.payload })),
      graph: { nodes: graph.nodes.map(node => ({ ...node, label: node.signature || node.kind || node.type || node.id })), edges: graph.edges },
      limitations: [...entry.limits, ...warnings], validity_reasons: entry.reasons, run: report?.run || null, artifact_paths: paths };
  }
  return { snapshot, caseDetail };
}
