"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { analyze } = require("../mcp/engine");

test("project execution trust must be explicit and is checked before binary setup", async t => {
  const prior = process.env.VIBEGURU_BINARY;
  process.env.VIBEGURU_BINARY = path.join(__dirname, "does-not-exist-security-test");
  t.after(() => {
    if (prior === undefined) delete process.env.VIBEGURU_BINARY;
    else process.env.VIBEGURU_BINARY = prior;
  });
  for (const value of [undefined, false, "true", 1]) {
    await assert.rejects(analyze({ root: __dirname, allowProjectExecution: value }), /allow_project_execution=true/);
  }
  // Trust allows setup to proceed, without this test executing any project code.
  await assert.rejects(analyze({ root: __dirname, allowProjectExecution: true }), /VIBEGURU_BINARY.*does not exist/);
  await assert.rejects(analyze({ root: __dirname, url: "http://127.0.0.1:1" }), /VIBEGURU_BINARY.*does not exist/);
});
