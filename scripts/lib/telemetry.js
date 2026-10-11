"use strict";

// Explicit, default-off product analytics. This module deliberately has no SDK,
// autocapture, disk event queue, source inspection or arbitrary event properties.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { randomUUID } = require("node:crypto");
const { assessReport } = require("../../mcp/report");
const { version } = require("../../package.json");

const HOSTS = new Set(["https://us.i.posthog.com", "https://eu.i.posthog.com"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENUMS = {
  channel: ["cli", "mcp"],
  command: ["run", "memory:client", "verify_runtime"],
  mode: ["auto", "flow", "unknown"],
  verdict: ["PASS", "FAIL", "INCONCLUSIVE", "ERROR"],
  framework: ["react", "next", "vue", "svelte", "unknown"],
  error_category: ["setup", "launch", "execution", "interrupted", "usage", "report_unavailable", "report_invalid"],
  feedback: ["confirmed", "dismissed", "helpful", "not_helpful"],
  audience: ["solo_developer", "product_team", "agency", "consultant", "student", "other"],
  use_case: ["dashboard", "internal_tool", "ecommerce", "content", "other"],
  team_size: ["solo", "2_5", "6_20", "21_plus"],
};
const COUNTS = new Set(["cycles", "routes_visited", "routes_unreachable", "findings_total", "findings_blocking", "assertions_passed", "assertions_failed", "evidence_count", "checks_complete", "checks_partial", "checks_unavailable"]);
const EVENTS = new Set(["vibeguru_run_started", "vibeguru_run_completed", "vibeguru_run_error", "vibeguru_feedback"]);
const MAX_CONFIG_BYTES = 8192;
const MAX_PENDING = 20;
const MAX_SEEN = 256;
// A cold cross-region TLS connection can exceed one second. Keep reporting
// bounded without dropping ordinary successful connections before they respond.
const TIMEOUT_MS = 5000;

function configPath(env = process.env) {
  const directory = env.VIBEGURU_CONFIG_DIR || (process.platform === "win32"
    ? path.join(env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "vibeguru")
    : path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "vibeguru"));
  return path.join(directory, "telemetry.json");
}

function validKey(value) {
  // The write-only PostHog project token is not a personal/admin API key.
  return typeof value === "string" && /^phc_[A-Za-z0-9_-]{10,200}$/.test(value);
}

function validHost(value) { return HOSTS.has(value); }
function validUuid(value) { return typeof value === "string" && UUID.test(value); }

function readConfig(env = process.env) {
  try {
    const file = configPath(env);
    if (fs.statSync(file).size > MAX_CONFIG_BYTES) return {};
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}

function saveConfig(data, env = process.env) {
  const file = configPath(env);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function settings(env = process.env) {
  const data = readConfig(env);
  const key = env.VIBEGURU_POSTHOG_KEY || data.project_key;
  const host = env.VIBEGURU_POSTHOG_HOST || data.host || "https://us.i.posthog.com";
  // A token alone never constitutes consent. The environment is an explicit
  // alternative for ephemeral CI; test runners and DO_NOT_TRACK always win.
  const blocked = env.DO_NOT_TRACK === "1" || env.VIBEGURU_TELEMETRY === "0" || Boolean(env.NODE_TEST_CONTEXT);
  // A deliberate local opt-out wins over CI/shell environment opt-in. Only
  // `telemetry enable` clears it by saving enabled:true again.
  const consent = data.enabled !== false && (env.VIBEGURU_TELEMETRY === "1" || data.enabled === true);
  return { enabled: !blocked && consent && validKey(key) && validHost(host),
    consent, blocked, configured: validKey(key) && validHost(host), key, host,
    installationId: validUuid(data.installation_id) ? data.installation_id : null,
    audience: data.audience, use_case: data.use_case, team_size: data.team_size };
}

function enable({ key, host, audience, use_case, team_size } = {}, env = process.env) {
  const current = readConfig(env);
  const projectKey = key || env.VIBEGURU_POSTHOG_KEY || current.project_key;
  const endpoint = host || env.VIBEGURU_POSTHOG_HOST || current.host || "https://us.i.posthog.com";
  if (!validKey(projectKey)) throw new Error("Supply the public PostHog project token (phc_...), never a personal API key.");
  if (!validHost(endpoint)) throw new Error("Host must be https://us.i.posthog.com or https://eu.i.posthog.com.");
  const data = { schema_version: 1, enabled: true,
    installation_id: validUuid(current.installation_id) ? current.installation_id : randomUUID(),
    project_key: projectKey, host: endpoint, consented_at: new Date().toISOString() };
  for (const [field, value] of Object.entries({ audience, use_case, team_size })) {
    if (value !== undefined && !ENUMS[field].includes(value)) throw new Error(`Unsupported ${field} value.`);
    if (value !== undefined) data[field] = value;
    else if (ENUMS[field].includes(current[field])) data[field] = current[field];
  }
  saveConfig(data, env);
  return status(env);
}

function disable(env = process.env) {
  // Drop token and pseudonym. Re-enabling starts a new installation history.
  saveConfig({ schema_version: 1, enabled: false }, env);
  return status(env);
}

function status(env = process.env) {
  const value = settings(env);
  return { enabled: value.enabled, consent: value.consent, configured: value.configured,
    blocked: value.blocked, host: validHost(value.host) ? value.host : "invalid",
    installation_id: value.enabled ? value.installationId : null,
    audience: ENUMS.audience.includes(value.audience) ? value.audience : null,
    use_case: ENUMS.use_case.includes(value.use_case) ? value.use_case : null,
    team_size: ENUMS.team_size.includes(value.team_size) ? value.team_size : null };
}

function sanitize(properties = {}) {
  const result = {};
  for (const [key, values] of Object.entries(ENUMS)) if (values.includes(properties[key])) result[key] = properties[key];
  for (const key of COUNTS) {
    const value = properties[key];
    if (Number.isSafeInteger(value) && value >= 0) result[key] = Math.min(value, 1000000);
  }
  if (validUuid(properties.run_id)) result.run_id = properties.run_id;
  for (const key of ["duration_ms", "engine_duration_ms"]) {
    const value = properties[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) result[key] = Math.min(Math.round(value / 100) * 100, 86400000);
  }
  if (properties.report_schema === 2) result.report_schema = 2;
  return result;
}

function summarizeReport(report) {
  // Always reassess the actual persisted contract. No verdict is inferred from
  // an exit code, and none of the report's free text crosses this boundary.
  try {
    const assessment = assessReport(report);
    if (assessment.verdict === "ERROR" || report?.schema_version !== 2) return null;
    const checks = Object.values(report.measurement_validity);
    const assertions = report.evidence.filter(e => e.kind === "journey_assertion");
    return sanitize({ report_schema: 2, verdict: assessment.verdict, mode: report.run.mode,
      framework: ENUMS.framework.includes(report.profile?.stack) ? report.profile.stack : "unknown",
      cycles: report.run.cycles, routes_visited: report.coverage?.visited?.length,
      routes_unreachable: report.coverage?.unreachable?.length,
      findings_total: report.findings.length,
      findings_blocking: report.findings.filter(f => ["high", "critical"].includes(f.severity)).length,
      evidence_count: report.evidence.length,
      assertions_passed: assertions.filter(e => e.data.status === "pass").length,
      assertions_failed: assertions.filter(e => e.data.status === "fail").length,
      checks_complete: checks.filter(c => c.status === "complete").length,
      checks_partial: checks.filter(c => c.status === "partial").length,
      checks_unavailable: checks.filter(c => c.status === "unavailable").length,
      engine_duration_ms: report.run.durationMs });
  } catch { return null; }
}

function send(host, payload) {
  return new Promise(resolve => {
    const body = JSON.stringify(payload);
    let settled = false;
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    let request;
    const timer = setTimeout(() => { request?.destroy(); finish(false); }, TIMEOUT_MS);
    try {
      request = https.request(`${host}/i/v0/e/`, { method: "POST", headers: {
        "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body),
        "User-Agent": `vibeguru/${version}`,
      } }, response => {
        response.on("error", () => finish(false));
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.destroy?.();
          finish(false);
          return;
        }
        let bytes = 0;
        response.on("data", chunk => {
          bytes += chunk.length;
          if (bytes > 4096) { response.destroy?.(); request.destroy(); finish(false); }
        });
        response.on("end", () => finish(true));
        response.on("aborted", () => finish(false));
        response.resume();
      });
      request.on("error", () => finish(false));
      request.end(body);
    } catch { finish(false); }
  });
}

function createTelemetry({ env = process.env, transport = send } = {}) {
  const pending = new Set();
  const seen = new Set();
  let ephemeralId = null;
  function capture(event, properties) {
    try {
      const config = settings(env);
      if (!config.enabled || !EVENTS.has(event) || pending.size >= MAX_PENDING) return Promise.resolve(false);
      const safe = sanitize(properties);
      // One lifecycle event per run per process. Feedback kinds remain distinct.
      const identity = `${event}:${safe.run_id || "none"}:${safe.feedback || ""}`;
      if (seen.has(identity)) return Promise.resolve(false);
      seen.add(identity);
      if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value);
      ephemeralId ||= randomUUID();
      const payload = { api_key: config.key, distinct_id: config.installationId || ephemeralId,
        event, uuid: randomUUID(), timestamp: new Date().toISOString(), properties: {
          ...sanitize(config), ...safe, tool_version: version,
          operating_system: ["win32", "darwin", "linux"].includes(process.platform) ? process.platform : "other",
          architecture: ["x64", "arm64"].includes(process.arch) ? process.arch : "other",
          node_major: Number(process.versions.node.split(".")[0]),
          ci: env.CI === "true" || env.CI === "1",
          $process_person_profile: false, $geoip_disable: true,
        } };
      let timer;
      const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(false), TIMEOUT_MS + 50); });
      const task = Promise.race([Promise.resolve().then(() => transport(config.host, payload)).catch(() => false), deadline])
        .then(Boolean).finally(() => { clearTimeout(timer); pending.delete(task); });
      pending.add(task);
      return task;
    } catch { return Promise.resolve(false); }
  }
  return { capture, enabled: () => settings(env).enabled,
    flush: () => Promise.allSettled([...pending]),
    runId: () => randomUUID() };
}

module.exports = { createTelemetry, summarizeReport, sanitize, configPath, enable, disable, status, validHost, validKey, validUuid, UUID };
