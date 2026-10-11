"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const https = require("node:https");
const { EventEmitter } = require("node:events");
const { createTelemetry, enable, disable, status, summarizeReport, sanitize, configPath } = require("../scripts/lib/telemetry");
const { telemetryCommand, reportFile, startCliRun } = require("../scripts/lib/telemetry-cli");
const { validReport } = require("./helpers/valid-report");

const KEY = "phc_telemetry_test_only_no_external_requests";
function isolated(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vibeguru-telemetry-test-"));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  // No inherited config, key or consent. Every enabled test injects a transport.
  return { VIBEGURU_CONFIG_DIR: directory };
}
function output() { let data = ""; return { write: value => { data += value; }, read: () => data }; }

test("telemetry is default-off; a project token alone is not consent", async t => {
  const env = isolated(t), requests = [];
  env.VIBEGURU_POSTHOG_KEY = KEY;
  const client = createTelemetry({ env, transport: (...args) => requests.push(args) });
  assert.equal(client.enabled(), false);
  assert.equal(await client.capture("vibeguru_run_started", { run_id: randomUUID() }), false);
  assert.equal(requests.length, 0);
  assert.equal(fs.existsSync(configPath(env)), false);
});

test("explicit opt-in persists a random installation ID, and disable removes it and the token", t => {
  const env = isolated(t);
  const first = enable({ key: KEY, audience: "agency", team_size: "2_5" }, env);
  assert.equal(first.enabled, true);
  assert.match(first.installation_id, /^[0-9a-f-]{36}$/);
  assert.equal(enable({ key: KEY }, env).installation_id, first.installation_id);
  assert.equal(status(env).audience, "agency");
  assert.equal(JSON.stringify(status(env)).includes(KEY), false);
  disable(env);
  assert.equal(status(env).enabled, false);
  const saved = fs.readFileSync(configPath(env), "utf8");
  assert.equal(saved.includes(KEY), false);
  assert.equal(saved.includes(first.installation_id), false);
  assert.notEqual(enable({ key: KEY }, env).installation_id, first.installation_id);
});

test("DNT, explicit disable and Node test context override saved or environment consent", async t => {
  for (const blocker of [{ DO_NOT_TRACK: "1" }, { VIBEGURU_TELEMETRY: "0" }, { NODE_TEST_CONTEXT: "child-v8" }]) {
    const env = { ...isolated(t), ...blocker };
    enable({ key: KEY }, env);
    let called = false;
    const client = createTelemetry({ env, transport: () => { called = true; } });
    assert.equal(await client.capture("vibeguru_run_started", {}), false);
    assert.equal(called, false);
  }
});

test("saved opt-out wins over environment opt-in until deliberate re-enable", async t => {
  const env = { ...isolated(t), VIBEGURU_TELEMETRY: "1", VIBEGURU_POSTHOG_KEY: KEY };
  const requests = [];
  const client = createTelemetry({ env, transport: (_host, payload) => { requests.push(payload); return true; } });
  assert.equal(client.enabled(), true);
  assert.equal(await client.capture("vibeguru_run_started", { run_id: randomUUID() }), true);
  const stdout = output(), stderr = output();
  assert.equal(await telemetryCommand(["disable"], { env, stdout, stderr }), 0);
  assert.match(stdout.read(), /Usage reporting disabled/);
  assert.equal(status(env).consent, false);
  assert.equal(client.enabled(), false);
  assert.equal(await client.capture("vibeguru_run_started", { run_id: randomUUID() }), false);
  assert.equal(requests.length, 1);
  // Re-creating the client must respect the saved opt-out too.
  assert.equal(createTelemetry({ env, transport: () => { throw new Error("must not send"); } }).enabled(), false);
  enable({}, env);
  assert.equal(client.enabled(), true);
  assert.equal(await client.capture("vibeguru_run_started", { run_id: randomUUID() }), true);
  assert.equal(requests.length, 2);
});

test("only exact supported HTTPS ingest hosts and public project tokens are accepted", t => {
  const env = isolated(t);
  for (const host of ["http://us.i.posthog.com", "https://us.i.posthog.com.evil.test", "https://127.0.0.1", "https://us.i.posthog.com/path", "https://user:pass@us.i.posthog.com"]) {
    assert.throws(() => enable({ key: KEY, host }, env), /Host must/);
  }
  assert.throws(() => enable({ key: "phx_personal_secret" }, env), /public PostHog/);
  assert.throws(() => enable({ key: KEY, audience: "Customer name" }, env), /Unsupported audience/);
  assert.equal(enable({ key: KEY, host: "https://eu.i.posthog.com" }, env).host, "https://eu.i.posthog.com");
  env.VIBEGURU_POSTHOG_HOST = "https://evil.test";
  assert.equal(status(env).enabled, false);
});

test("malformed and oversized config cannot enable telemetry", t => {
  const env = isolated(t), file = configPath(env);
  for (const contents of ["{bad", "[]", "null", " ".repeat(9000)]) {
    fs.writeFileSync(file, contents);
    assert.equal(status(env).enabled, false);
  }
});

test("metadata allowlist drops content and bounds numeric fields", () => {
  assert.deepEqual(sanitize({ url: "https://private.test", root: "C:/private", message: "secret", stack: "secret",
    run_id: "private-customer", audience: "Some Company", verdict: "secret", cycles: -1,
    findings_total: Infinity, evidence_count: 9000000, duration_ms: 1234, engine_duration_ms: NaN,
    command: "run", mode: "flow", report_schema: 2 }),
  { command: "run", mode: "flow", evidence_count: 1000000, duration_ms: 1200, report_schema: 2 });
});

test("UUID fields require primitive strings and never retain coerced objects or arrays", t => {
  const id = randomUUID(), env = isolated(t);
  for (const invalid of [[id], { toString: () => id }, new String(id), null, 123]) {
    assert.equal(Object.hasOwn(sanitize({ run_id: invalid }), "run_id"), false);
  }
  assert.equal(sanitize({ run_id: id }).run_id, id);
  enable({ key: KEY }, env);
  const file = configPath(env), data = JSON.parse(fs.readFileSync(file, "utf8"));
  data.installation_id = [id];
  fs.writeFileSync(file, JSON.stringify(data));
  assert.equal(status(env).installation_id, null);
  const repaired = enable({ key: KEY }, env);
  assert.equal(typeof repaired.installation_id, "string");
  assert.notEqual(repaired.installation_id, id);
});

test("completed telemetry is derived from valid report evidence, never saved optimism or private text", async t => {
  const env = isolated(t), calls = [];
  enable({ key: KEY, audience: "agency", use_case: "internal_tool" }, env);
  const report = validReport();
  report.profile.url = "https://secret.test/private";
  report.profile.root = "C:/private-user/code";
  report.profile.meta = { token: "do-not-send" };
  report.evidence[0].data.privateText = "do-not-send";
  const summary = summarizeReport(report);
  assert.equal(summary.verdict, "PASS");
  assert.equal(summary.engine_duration_ms, 1000);
  const client = createTelemetry({ env, transport: (host, payload) => { calls.push({ host, payload }); return true; } });
  const run = randomUUID();
  assert.equal(await client.capture("vibeguru_run_completed", { ...summary, run_id: run, channel: "cli", url: report.profile.url }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.properties.$geoip_disable, true);
  assert.equal(calls[0].payload.properties.$process_person_profile, false);
  assert.equal(calls[0].payload.properties.audience, "agency");
  const body = JSON.stringify(calls);
  for (const secret of ["secret.test", "private-user", "do-not-send"]) assert.equal(body.includes(secret), false);
  report.evidence = [];
  assert.equal(summarizeReport(report).verdict, "INCONCLUSIVE");
  report.findings = "damaged";
  assert.equal(summarizeReport(report), null);
});

test("events are deduplicated, queues are bounded, failures stay best effort", async t => {
  const env = isolated(t), calls = [];
  enable({ key: KEY }, env);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = createTelemetry({ env, transport: async (_host, payload) => { calls.push(payload); await gate; return true; } });
  const run = randomUUID(), first = client.capture("vibeguru_run_started", { run_id: run });
  assert.equal(await client.capture("vibeguru_run_started", { run_id: run }), false);
  assert.equal(await client.capture("arbitrary_secret_event", { run_id: randomUUID() }), false);
  const pending = Array.from({ length: 30 }, () => client.capture("vibeguru_run_started", { run_id: randomUUID() }));
  release();
  await Promise.all([first, ...pending]);
  await client.flush();
  assert.equal(calls.length, 20);
  const broken = createTelemetry({ env, transport: () => { throw new Error("private transport details"); } });
  assert.equal(await broken.capture("vibeguru_run_error", { run_id: randomUUID(), error_category: "execution" }), false);
});

test("optional feedback CLI validates IDs and disabled feedback never attempts network", async t => {
  const env = isolated(t), stdout = output(), stderr = output();
  assert.equal(await telemetryCommand(["status"], { env, stdout, stderr }), 0);
  assert.equal(JSON.parse(stdout.read()).enabled, false);
  assert.equal(await telemetryCommand(["feedback", "--run", "C:/private-file", "--kind", "helpful"], { env, stdout, stderr }), 64);
  assert.equal(await telemetryCommand(["feedback", "--run", randomUUID(), "--kind", "helpful"], { env, stdout, stderr }), 2);
  assert.equal(await telemetryCommand(["enable", "--key", KEY, "--audience", "agency"], { env, stdout, stderr }), 0);
  assert.equal(stdout.read().includes(KEY), false);
  assert.equal(await telemetryCommand(["disable"], { env, stdout, stderr }), 0);
  assert.equal(status(env).enabled, false);
});

test("CLI report discovery mirrors root/out defaults without transmitting their paths", () => {
  const cwd = path.resolve("example root");
  assert.equal(reportFile(["run", "--root", "app"], cwd), path.join(cwd, "app", "vibeguru-findings.json"));
  assert.equal(reportFile(["run", "--root=app", "--out=reports"], cwd), path.join(cwd, "reports", "vibeguru-findings.json"));
  assert.equal(reportFile(["memory:client", "https://private", "--root", "app"], cwd), path.join(cwd, "vibeguru-findings.json"));
});

test("CLI lifecycle reads fresh evidence, rejects old reports and preserves actual verdicts", async t => {
  const env = isolated(t), cwd = env.VIBEGURU_CONFIG_DIR, stderr = output();
  enable({ key: KEY }, env);
  const file = path.join(cwd, "vibeguru-findings.json");
  fs.writeFileSync(file, JSON.stringify(validReport()));
  const events = [], transport = (_host, payload) => { events.push(payload); return true; };
  const old = startCliRun(["run"], { env, cwd, stderr, transport });
  await old.started;
  await old.finish({ code: 0 });
  assert.deepEqual(events.map(e => e.event), ["vibeguru_run_started", "vibeguru_run_error"]);
  assert.equal(events[1].properties.error_category, "report_unavailable");
  events.length = 0;
  const fresh = startCliRun(["run"], { env, cwd, stderr, transport });
  await fresh.started;
  fs.writeFileSync(file, JSON.stringify(validReport({ cycles: 4 })));
  await fresh.finish({ code: 0 });
  await fresh.finish({ code: 2 });
  assert.deepEqual(events.map(e => e.event), ["vibeguru_run_started", "vibeguru_run_completed"]);
  assert.equal(events[1].properties.verdict, "PASS");
  assert.equal(events[1].properties.cycles, 4);
  assert.equal(events[0].properties.run_id, events[1].properties.run_id);
  assert.equal(JSON.stringify(events).includes(cwd), false);
  events.length = 0;
  const mismatch = startCliRun(["run"], { env, cwd, stderr, transport });
  await mismatch.started;
  fs.writeFileSync(file, JSON.stringify(validReport({ cycles: 5 })));
  await mismatch.finish({ code: 1 });
  assert.equal(events[1].event, "vibeguru_run_error");
  assert.equal(events[1].properties.error_category, "report_invalid");
});

test("real HTTP transport uses the documented ingest endpoint, refuses redirects and bounds failures", async t => {
  const env = isolated(t), original = https.request;
  enable({ key: KEY }, env);
  let captured;
  https.request = (url, options, callback) => {
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = body => {
      captured = { url: String(url), options, body: JSON.parse(body) };
      const response = new EventEmitter();
      response.statusCode = 302;
      response.headers = { location: "http://untrusted.test" };
      response.resume = () => {};
      queueMicrotask(() => callback(response));
    };
    return request;
  };
  t.after(() => { https.request = original; });
  const client = createTelemetry({ env });
  assert.equal(await client.capture("vibeguru_run_started", { run_id: randomUUID() }), false);
  assert.equal(captured.url, "https://us.i.posthog.com/i/v0/e/");
  assert.equal(captured.options.method, "POST");
  assert.equal(captured.body.api_key, KEY);
  assert.equal(captured.body.event, "vibeguru_run_started");
  assert.equal(captured.body.properties.$process_person_profile, false);
  https.request = () => { const request = new EventEmitter(); request.end = () => {}; request.destroy = () => {}; return request; };
  const started = performance.now();
  assert.equal(await client.capture("vibeguru_run_started", { run_id: randomUUID() }), false);
  assert.ok(performance.now() - started < 1500, "hung ingestion must have a bounded deadline");
});
