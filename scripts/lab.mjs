#!/usr/bin/env node
// Experimental fixed-plan campaigns. No LLM or autonomous-policy claim.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreCase, compareObserved } from "../benchmarks/assessment.mjs";
import { assertPortAvailable, fixtureReadiness } from "./lib/lab-ports.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("Usage: node scripts/lab.mjs <prepared-manifest.json> [variants-separated-by-comma]");
const manifest = JSON.parse(await readFile(resolve(manifestPath), "utf8"));
const variants = (process.argv[3] || "baseline,listener-leak,heap-leak,runtime-error,combined,partial-fixed,invalid-fix,fixed,interrupted").split(",");
const allowed = new Set(["baseline", "listener-leak", "heap-leak", "runtime-error", "combined", "partial-fixed", "invalid-fix", "fixed", "interrupted"]);
for (const variant of ["race-ordered", "race-reordered", "reconnect-broken", "nav-complete", "nav-pending",
  "http-normal", "http-503", "http-disconnect", "http-malformed", "write-single", "write-double", "write-retry",
  "storage-normal", "storage-corrupt", "storage-shape", "storage-denied", "storage-quota", "conflict-serial", "conflict-stale", "conflict-reversed"]) allowed.add(variant);
if (variants.some(v => !allowed.has(v))) throw new Error("Unsupported controlled variant");
for (const app of manifest.apps) {
  if (!/^[a-z][a-z0-9-]*$/.test(app.adapter) || ![undefined, "desktop", "lab"].includes(app.adapter_group) ||
      ![undefined, "node-fixture"].includes(app.runtime) || (app.variants &&
      (!Array.isArray(app.variants) || !app.variants.length || app.variants.some(v => !allowed.has(v))))) throw new Error("Invalid adapter or app variants");
}
const campaignId = `campaign-${Date.now()}-${randomUUID().slice(0, 8)}`;
const output = join(manifest.workspace, campaignId);
await mkdir(output, { recursive: false });
const servers = [];
const results = [];
const reports = new Map();
const identities = new Map();
const serverInstances = new Map();
const sha = value => createHash("sha256").update(value).digest("hex");
const multiplayer = app => ["multiplayer", "multiplayer-reconnect"].includes(app.adapter);

// The escript resolves an external driver in a checkout. Hash that code and the
// experiment dependencies too, rather than treating the binary as the whole tool.
async function executionIdentity() {
  const files = ["driver-node/index.js", "mcp/report.js", "scripts/lab.mjs", "scripts/lib/lab-ports.mjs"];
  async function visit(directory) {
    for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
      const name = join(directory, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) files.push(name);
    }
  }
  await visit("driver-node/lib");
  await visit("benchmarks");
  return Object.fromEntries(await Promise.all(files.sort().map(async file => [file, sha(await readFile(join(root, file)))])));
}

async function buildIdentity(app) {
  const artifacts = {};
  async function visit(relative) {
    for (const entry of (await readdir(join(app.snapshot, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(relative, entry.name);
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) artifacts[name.replaceAll("\\", "/")] = sha(await readFile(join(app.snapshot, name)));
    }
  }
  if (app.runtime === "node-fixture") {
    // Executed source is the artifact for the dependency-free Node fixtures.
    for (const file of Object.keys(app.source_hashes || {}).sort()) artifacts[file] = sha(await readFile(join(app.snapshot, file)));
    if (!artifacts["server.mjs"]) throw new Error("Node fixture is missing its inventoried server.mjs");
  } else {
    for (const directory of multiplayer(app) ? ["client/dist", "server/dist"] : ["dist"]) await visit(directory);
  }
  const sources = {};
  for (const file of Object.keys(app.source_hashes || {}).sort()) sources[file] = sha(await readFile(join(app.snapshot, file)));
  const locks = {};
  for (const file of multiplayer(app) ? ["client/package-lock.json", "server/package-lock.json"] : ["package-lock.json"]) {
    try { locks[file] = sha(await readFile(join(app.snapshot, file))); } catch (error) { if (error.code !== "ENOENT") throw error; locks[file] = null; }
  }
  return { original_source_inventory_hash: sha(JSON.stringify(app.source_hashes)),
    source_snapshot_hash: sha(JSON.stringify(sources)), sources, artifact_hash: sha(JSON.stringify(artifacts)), artifacts, locks };
}

function stop(child) {
  if (!child || child.exitCode !== null || !child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  else child.kill("SIGTERM");
}

async function start(app) {
  if (!/^[a-z][a-z0-9-]*$/.test(app.id) || !Number.isInteger(app.port) || app.port < 1024 || app.port > 65535) throw new Error("Invalid app identifier or port");
  await assertPortAvailable(app.port);
  const instance = randomUUID(), readiness = fixtureReadiness(app.port, instance);
  const args = app.runtime === "node-fixture" ? ["server.mjs"] : multiplayer(app) ? ["server/dist/server.js"] :
    ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(app.port), "--strictPort"];
  const child = spawn(process.execPath, args, { cwd: app.snapshot, windowsHide: true,
    env: { ...process.env, PORT: String(app.port), VIBEGURU_LAB_INSTANCE: instance }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", chunk => readiness.consume(chunk));
  servers.push(child);
  const log = createWriteStream(join(output, `${app.id}-server.log`));
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.on("close", () => log.end());
  const suffix = app.url_path || (app.adapter === "swap-station" ? "/brokers" : "/");
  if (typeof suffix !== "string" || !suffix.startsWith("/") || suffix.startsWith("//") || suffix.includes("\\")) throw new Error("Invalid local app URL path");
  const url = `http://127.0.0.1:${app.port}${suffix}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${app.id} server exited; inspect its log`);
    if (app.runtime !== "node-fixture" || readiness.ready) {
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok && child.exitCode === null) {
          serverInstances.set(app.id, { port: app.port, exclusive_preflight: true, instance,
            owned_listen_handshake: app.runtime === "node-fixture" && readiness.ready });
          return url;
        }
      } catch {}
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`${app.id} server readiness timed out`);
}

async function execute(app, url, variant) {
  const executionFiles = await executionIdentity();
  const engineHash = sha(await readFile(join(root, "vibeguru")));
  const cycles = app.cycles ?? 6;
  if (!Number.isInteger(cycles) || cycles < 3 || cycles > 30) throw new Error("Campaign cycles must be an integer from 3 through 30");
  const timeout = 45000 + Math.max(cycles - 6, 0) * 2000;
  const directory = join(output, `${app.id}-${variant}`);
  await mkdir(directory);
  const flow = join(root, "benchmarks", app.adapter_group || "desktop", `${app.adapter}.mjs`);
  const args = [join(root, "vibeguru"), "memory:client", url, "--root",
    multiplayer(app) ? join(app.snapshot, "client") : app.snapshot,
    "--flow", flow, "--cycles", String(cycles), "--settle", "200", "--timeout", String(timeout), "--out", directory];
  const log = createWriteStream(join(directory, "execution.log"));
  const started = Date.now();
  const child = spawn(process.platform === "win32" ? "escript.exe" : "escript", args,
    { cwd: root, windowsHide: true, env: { ...process.env, VIBEGURU_LAB_VARIANT: variant, VIBEGURU_LAB_EVIDENCE_DIR: directory }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const timer = setTimeout(() => stop(child), timeout + 20000);
  let exit;
  try { exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", code => resolve(code)); }); }
  finally { clearTimeout(timer); log.end(); }
  let report = null;
  const reportPath = join(directory, "vibeguru-findings.json");
  try { report = JSON.parse(await readFile(reportPath, "utf8")); } catch {}
  const score = scoreCase(report, variant, app.expectations?.[variant]);
  const executionIdentityStable = JSON.stringify(executionFiles) === JSON.stringify(await executionIdentity()) &&
    engineHash === sha(await readFile(join(root, "vibeguru")));
  if (!executionIdentityStable) {
    if (score.assessment.verdict === "PASS") score.assessment.verdict = "INCONCLUSIVE";
    score.assessment.reasons.push("Execution source changed during case");
    score.expectation = { met: false, mismatches: [...(score.expectation?.mismatches || []), "Execution source changed during case"] };
  }
  const checks = Array.isArray(report?.evidence) ? report.evidence.filter(e => e.kind === "journey_assertion") : [];
  const result = { app: app.id, variant, source_kind: app.source_kind || (app.runtime === "node-fixture" ? "synthetic" : null),
    execution_identity_stable: executionIdentityStable,
    exit, duration_ms: Date.now() - started, report: report ? reportPath : null,
    ...score, findings: Array.isArray(report?.findings) ? report.findings.map(f => ({ signature: f.signature, severity: f.severity, metrics: f.metrics })) : [],
    passed_assertions: checks.filter(e => e.data.status === "pass").length,
    failed_assertions: checks.filter(e => e.data.status === "fail").length };
  results.push(result);
  if (report) reports.set(`${app.id}/${variant}`, report);
  const capsule = { schema_version: 1, experimental: true, campaign_id: campaignId, app: app.id, variant,
    conditions: { build: identities.get(app.id), url, engine_sha256: engineHash, execution_files: executionFiles,
      server_startup: serverInstances.get(app.id),
      execution_identity_stable: executionIdentityStable,
      expected_outcome: app.expectations?.[variant] || null,
      flow_hash: sha(await readFile(flow)), helper_hash: sha(await readFile(join(root, "benchmarks/desktop/common.mjs"))),
      node: process.version, browser: report?.run.browserVersion || null, cycles, settle_ms: 200,
      external_resources: "Cross-origin HTTP blocked unless explicitly mocked; no external services exercised",
      backend: app.runtime === "node-fixture" ? "isolated real local Node fixture server; intentional vulnerable/corrected modes" :
        multiplayer(app) ? "isolated real local WebSocket server" : "controlled HTTP fixtures; backend integration untested" },
    result, graph: report ? {
      nodes: [{ id: `${app.id}/${variant}`, type: "experiment" },
        { id: identities.get(app.id).artifact_hash, type: "build" },
        { id: sha(await readFile(flow)), type: "workflow" },
        ...report.findings.map(f => ({ id: f.id, type: "finding", signature: f.signature })),
        ...report.evidence.map(e => ({ id: e.id, type: "observation", kind: e.kind }))],
      edges: [
        { source: `${app.id}/${variant}`, target: identities.get(app.id).artifact_hash, relation: "executed_build" },
        { source: `${app.id}/${variant}`, target: sha(await readFile(flow)), relation: "executed_workflow" },
        ...report.evidence.map(e => ({ source: e.id, target: `${app.id}/${variant}`, relation: "observed_during" })),
        ...report.findings.flatMap(f => f.evidence_refs.map(id => ({ source: id, target: f.id, relation: "supports_measurement_finding" })))
      ]
    } : null };
  await writeFile(join(directory, "incident-capsule.json"), JSON.stringify(capsule, null, 2));
  await writeFile(join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ app: app.id, variant, verdict: score.assessment.verdict,
    expected: score.expectedSignals.length, detected: score.detected.length, missed: score.missed, expectation: score.expectation,
    assertions: [result.passed_assertions, result.failed_assertions], duration_ms: result.duration_ms }));
}

try {
  for (const app of manifest.apps) {
    identities.set(app.id, await buildIdentity(app));
    const url = await start(app);
    for (const variant of process.argv[3] ? variants : (app.variants || variants)) await execute(app, url, variant);
    stop(servers.at(-1));
  }
} finally { for (const child of servers) stop(child); }

const comparisons = [];
for (const app of manifest.apps) {
  if (app.compare_with) {
    for (const variant of app.variants || variants) {
      const before = reports.get(`${app.compare_with}/${variant}`);
      const after = reports.get(`${app.id}/${variant}`);
      if (before && after) comparisons.push({ baseline_app: app.compare_with, candidate_app: app.id, variant, ...compareObserved(before, after) });
    }
  }
  const baseline = reports.get(`${app.id}/combined`);
  if (!baseline) continue;
  for (const variant of ["partial-fixed", "invalid-fix", "fixed"]) {
    const candidate = reports.get(`${app.id}/${variant}`);
    if (candidate) comparisons.push({ app: app.id, variant, ...compareObserved(baseline, candidate) });
  }
}
const expected = results.reduce((n, r) => n + r.expectedSignals.length, 0);
const detected = results.reduce((n, r) => n + r.detected.length, 0);
const summary = { campaign_id: campaignId, label: manifest.label || null, created_at: new Date().toISOString(),
  engine_sha256: sha(await readFile(join(root, "vibeguru"))),
  cases: results.length, expected_injected_signals: expected, detected_injected_signals: detected,
  fault_cases: results.filter(r => r.expectedSignals.length).length,
  fully_detected_fault_cases: results.filter(r => r.expectedSignals.length && !r.missed.length).length,
  declared_expectation_cases: results.filter(r => r.expectation).length,
  met_expectations: results.filter(r => r.expectation?.met).length,
  expectation_mismatches: results.filter(r => r.expectation && !r.expectation.met).map(r => ({ app: r.app, variant: r.variant, ...r.expectation })),
  injected_signal_detection_rate: expected ? detected / expected : null,
  execution_errors: results.filter(r => r.assessment.verdict === "ERROR").length,
  baseline_control_alerts: results.filter(r => r.control && r.findings.some(f => ["high", "critical"].includes(f.severity)))
    .map(r => ({ app: r.app, variant: r.variant, findings: r.findings })),
  interrupted_runs: results.filter(r => r.variant === "interrupted").map(r => ({ app: r.app, verdict: r.assessment.verdict })),
  comparisons, limitations: ["Synthetic injected faults are labelled; detection rate is not real-world precision or overall product accuracy.",
    "Normal app findings require independent triage; an unmodified app is not a known-clean control.",
    "Only declared workflows and conditions were exercised; no LLM/Jev policy, automated minimizer or full causal diagnosis was evaluated.",
    "Gateway and swap-station backends are mocked; authentication, hardware control and full integrations are outside scope.",
    ...(manifest.limitations || [])] };
await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ output, cases: summary.cases, expected, detected, met_expectations: summary.met_expectations,
  execution_errors: summary.execution_errors, interrupted_runs: summary.interrupted_runs }));
process.exitCode = results.some(r => r.missed.length || r.assessment.verdict === "ERROR" || r.interrupted_not_passed === false || r.expectation?.met === false) ? 1 : 0;
