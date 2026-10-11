"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const telemetry = require("./telemetry");
const MAX_REPORT_BYTES = 16 * 1024 * 1024;

function option(argv, key) {
  const prefix = `--${key}=`;
  const index = argv.findIndex(arg => arg === `--${key}` || arg.startsWith(prefix));
  if (index < 0) return undefined;
  return argv[index].startsWith(prefix) ? argv[index].slice(prefix.length) : argv[index + 1];
}

async function telemetryCommand(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  const [command, ...args] = argv;
  if (command === "status") { stdout.write(JSON.stringify(telemetry.status(env), null, 2) + "\n"); return 0; }
  if (command === "disable") { telemetry.disable(env); stdout.write("Usage reporting disabled. Local analytics token and installation ID removed.\n"); return 0; }
  if (command === "enable") {
    telemetry.enable({ key: option(args, "key"), host: option(args, "host"),
      audience: option(args, "audience"), use_case: option(args, "use-case"), team_size: option(args, "team-size") }, env);
    const current = telemetry.status(env);
    stdout.write("Usage reporting consent saved. Sends allowlisted counts, timings and optional audience categories; no app content, URLs, paths or messages.\n");
    if (current.blocked) stdout.write("Reporting remains blocked by DO_NOT_TRACK, VIBEGURU_TELEMETRY=0 or the test environment.\n");
    return 0;
  }
  if (command === "feedback") {
    const run = option(args, "run"), kind = option(args, "kind");
    if (!telemetry.validUuid(run) || !["confirmed", "dismissed", "helpful", "not_helpful"].includes(kind)) {
      stderr.write("Usage: vibeguru telemetry feedback --run <run UUID> --kind confirmed|dismissed|helpful|not_helpful\n"); return 64;
    }
    const client = telemetry.createTelemetry({ env });
    if (!client.enabled()) { stderr.write("Usage reporting is disabled or lacks a valid project token. Feedback was not sent.\n"); return 2; }
    const delivered = await client.capture("vibeguru_feedback", { run_id: run, feedback: kind });
    stdout.write(delivered ? "Feedback accepted by the analytics endpoint.\n" : "Feedback was not delivered; your test results are unaffected.\n");
    return delivered ? 0 : 2;
  }
  stderr.write("Usage: vibeguru telemetry enable --key <public phc_ token> [--host https://us.i.posthog.com|https://eu.i.posthog.com]\n       vibeguru telemetry disable|status\n       vibeguru telemetry feedback --run <run UUID> --kind confirmed|dismissed|helpful|not_helpful\n");
  return 64;
}

function snapshot(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) return null;
    const contents = fs.readFileSync(file);
    return { stamp: `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${createHash("sha256").update(contents).digest("hex")}`, contents };
  } catch { return null; }
}

function reportFile(argv, cwd = process.cwd()) {
  const output = option(argv, "out") || (argv[0] === "run" ? option(argv, "root") : undefined) || cwd;
  return path.join(path.resolve(cwd, output), "vibeguru-findings.json");
}

function startCliRun(argv, { env = process.env, cwd = process.cwd(), stderr = process.stderr, transport } = {}) {
  const client = telemetry.createTelemetry({ env, transport });
  if (!["run", "memory:client"].includes(argv[0]) || !client.enabled()) return null;
  const runId = client.runId(), file = reportFile(argv, cwd), before = snapshot(file);
  let started = performance.now();
  const base = { run_id: runId, channel: "cli", command: argv[0] };
  const startedEvent = client.capture("vibeguru_run_started", base).then(() => { started = performance.now(); });
  let finished = false;
  return { started: startedEvent, async finish({ code, signal, errorCategory } = {}) {
    if (finished) return;
    finished = true;
    try {
      const after = snapshot(file);
      let summary = null;
      if (after && after.stamp !== before?.stamp) {
        try { summary = telemetry.summarizeReport(JSON.parse(after.contents.toString("utf8"))); } catch {}
      }
      const codes = { PASS: 0, FAIL: 1, INCONCLUSIVE: 3, ERROR: 2 };
      const category = signal ? "interrupted" : errorCategory || (code === 64 ? "usage" :
        ![0, 1, 3].includes(code) ? "execution" : !after || after.stamp === before?.stamp ? "report_unavailable" : "report_invalid");
      if (summary && codes[summary.verdict] === code && !signal && !errorCategory) {
        await client.capture("vibeguru_run_completed", { ...base, ...summary, duration_ms: performance.now() - started });
      } else {
        await client.capture("vibeguru_run_error", { ...base, verdict: "ERROR", error_category: category, duration_ms: performance.now() - started });
      }
      await client.flush();
      stderr.write(`vibeguru: analytics run ID ${runId} (optional feedback: vibeguru telemetry feedback --run ${runId} --kind helpful)\n`);
    } catch { /* Analytics must never change the analysis exit code. */ }
  } };
}

module.exports = { telemetryCommand, startCliRun, reportFile };
