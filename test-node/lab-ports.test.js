"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");

test("port preflight refuses occupied loopback listeners and releases successful probes", async t => {
  const { assertPortAvailable } = await import("../scripts/lib/lab-ports.mjs");
  const server = http.createServer((request, response) => response.end("Existing listener"));
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise(done => server.close(done)));
  const port = server.address().port;
  await assert.rejects(assertPortAvailable(port), /unavailable.*existing listeners are left running/);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "Existing listener");
  await new Promise(done => server.close(done));
  await assertPortAvailable(port);
  await new Promise(done => server.listen(port, "127.0.0.1", done));
});

test("fixture readiness requires the owned instance and port and handles split stdout records", async () => {
  const { fixtureReadiness } = await import("../scripts/lib/lab-ports.mjs");
  const gate = fixtureReadiness(65326, "owned-instance");
  for (const line of ["ready", JSON.stringify({ vibeguru_lab_ready: "another", port: 65326 }),
    JSON.stringify({ vibeguru_lab_ready: "owned-instance", port: 65327 })]) gate.consume(`${line}\n`);
  assert.equal(gate.ready, false);
  gate.consume('{"vibeguru_lab_ready":"owned-'); assert.equal(gate.ready, false);
  gate.consume('instance","port":65326}\n'); assert.equal(gate.ready, true);
});

test("a full campaign refuses an existing HTTP server before spawning its fixture", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibeguru-port-collision-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("vibeguru-port-collision-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  const server = http.createServer((request, response) => response.end("Owned control"));
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  t.after(() => new Promise(done => server.close(done)));
  await fs.writeFile(path.join(root, "server.mjs"), 'throw new Error("Fixture must not start");');
  const manifest = path.join(root, "manifest.json");
  await fs.writeFile(manifest, JSON.stringify({ workspace: root, apps: [{ id: "collision", adapter: "storage-resilience", adapter_group: "lab",
    runtime: "node-fixture", snapshot: root, port: server.address().port, source_hashes: { "server.mjs": "source" }, variants: ["storage-normal"] }] }));
  const result = await new Promise(done => execFile(process.execPath, [path.resolve("scripts/lab.mjs"), manifest],
    { windowsHide: true, timeout: 10000 }, (error, stdout, stderr) => done({ error, stdout, stderr })));
  assert.equal(result.error?.code, 1);
  assert.match(result.stderr, /Lab port .* is unavailable/);
  assert.doesNotMatch(result.stderr, /Fixture must not start/);
  assert.equal(await (await fetch(`http://127.0.0.1:${server.address().port}`)).text(), "Owned control");
});
