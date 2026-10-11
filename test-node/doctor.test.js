"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { assessInstallation, engineKind } = require("../scripts/lib/doctor");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const ready = { nodeVersion: "v20.0.0", supported: true, override: false, binaryReady: true, launcherReady: true, driverReady: true, chromiumReady: true };

test("doctor distinguishes incomplete prerequisites from verified app execution", () => {
  assert.equal(assessInstallation(ready).ready, true);
  for (const field of ["supported", "binaryReady", "launcherReady", "driverReady", "chromiumReady"]) {
    const result = assessInstallation({ ...ready, [field]: false });
    assert.equal(result.ready, false, field); assert.equal(result.checks.filter(check => !check.ready).length, 1);
  }
  assert.equal(assessInstallation({ ...ready, nodeVersion: "v18.20.0" }).ready, false);
  assert.equal(assessInstallation({ ...ready, nodeVersion: "v24.0.0" }).ready, true);
  assert.equal(assessInstallation({ ...ready, override: true }).checks[2].name, "Explicit engine override");
});

test("doctor rejects empty, arbitrary and wrong-platform engine files", () => {
  assert.equal(engineKind(Buffer.alloc(160), 0, "win32"), null);
  assert.equal(engineKind(Buffer.from("arbitrary text"), 200, "linux"), null);
  const windows = Buffer.alloc(160); windows.write("MZ");
  assert.equal(engineKind(windows, 200, "win32"), "native");
  assert.equal(engineKind(windows, 200, "linux"), null);
  assert.equal(engineKind(windows, 2, "win32"), null);
  assert.equal(engineKind(Buffer.from("#!/usr/bin/env escript\n"), 200, "win32"), "escript");
});

test("doctor CLI diagnoses an absent engine without trying to download it", () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, "../bin/vibeguru.js"), "doctor"], {
    env: { ...process.env, VIBEGURU_BINARY: path.resolve(__dirname, "fixtures/definitely-no-engine"), DO_NOT_TRACK: "1" },
    encoding: "utf8", windowsHide: true, timeout: 5000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.match(result.stdout, /MISSING  Explicit engine override/);
  assert.match(result.stdout, /No downloads or configuration changes were made/);
  assert.equal(result.stderr, "");
});
