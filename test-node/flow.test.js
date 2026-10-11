"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

test("flow setup is optional, validated, and separate from the cycle function", async () => {
  const { loadFlow, loadFlowModule } = await import("../driver-node/lib/flow.js");
  const dir = await mkdtemp(join(tmpdir(), "vg-flow-"));
  try {
    const file = join(dir, "controlled.mjs");
    await writeFile(file, "export const setup = async p => { p.ready = true }; export default async p => p.ready;");
    const flow = await loadFlowModule(file);
    const page = {};
    await flow.setup(page);
    assert.equal(await flow.run(page), true);
    assert.equal(await (await loadFlow(file))(page), true);
    await writeFile(join(dir, "bad.mjs"), "export const setup = 7; export default async () => {};");
    await assert.rejects(loadFlowModule(join(dir, "bad.mjs")), /setup must be a function/);
    for (const [i, declaration] of ["null", "[\"same\",\"same\"]", "[\"\"]"].entries()) {
      const invalid = join(dir, `checks-${i}.mjs`);
      await writeFile(invalid, `export const checks = ${declaration}; export default async () => {};`);
      await assert.rejects(loadFlowModule(invalid), /Flow checks must be an array/);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("only a boolean false produces a failed journey assertion", async () => {
  const { journeyCheck, JourneyAssertionError } = await import("../driver-node/lib/flow.js");
  const evidence = [];
  const check = journeyCheck(e => evidence.push(e), 2, () => "/reports");
  check("visible", true, "Report stays visible");
  assert.throws(() => check("latest", false, "Latest selection controls results"), JourneyAssertionError);
  assert.equal(evidence[1].data.status, "fail");
  assert.equal(evidence[1].cycle, 2);
  assert.throws(() => check("unknown", Promise.resolve(true)), /must be a boolean/);
  assert.throws(() => check("visible", true), /unique/);
  assert.equal(evidence.length, 2);
  const declared = journeyCheck(e => evidence.push(e), 3, () => "/reports", ["required"]);
  assert.throws(() => declared("typo", true), /not declared/);
  declared("required", true);
  assert.equal(evidence.length, 3);
});

test("experiment observations preserve JSON snapshots without becoming assertions", async () => {
  const { journeyObservation } = await import("../driver-node/lib/flow.js");
  const evidence = [];
  const observe = journeyObservation(e => evidence.push(e), 3, () => "/logs");
  const payload = { order: ["new", "old"], visible: { message: "old" } };
  observe("response-order", payload);
  payload.visible.message = "changed later";
  assert.equal(evidence[0].data.payload.visible.message, "old");
  assert.equal(evidence[0].kind, "experiment_observation");
  assert.equal(evidence[0].cycle, 3);
  assert.throws(() => observe("response-order", {}), /unique/);
  const circular = {}; circular.self = circular;
  for (const invalid of [{ value: NaN }, { value: undefined }, { value: 1n }, { value: new Date() }, circular]) {
    assert.throws(() => observe("invalid", invalid), /JSON/);
  }
  assert.throws(() => observe("too-large", { value: "x".repeat(65536) }), /64KiB/);
  assert.equal(evidence.length, 1);
});
