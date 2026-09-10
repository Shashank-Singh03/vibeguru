"use strict";

// Drives the real server over a real stdio transport with the real MCP client.
// Nothing here mocks the protocol: if the handshake, the tool schemas, or the
// stdio discipline break, these fail. That last one matters more than it sounds —
// stdout belongs to JSON-RPC, so a stray console.log anywhere in the server (or in
// anything it requires) corrupts the stream and the client simply never connects.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const LAUNCH = [path.join(REPO_ROOT, "bin", "vibeguru.js"), "mcp"];

async function connect() {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: LAUNCH,
    cwd: REPO_ROOT,
    stderr: "ignore",
  });

  const client = new Client({ name: "vibeguru-tests", version: "0" });
  await client.connect(transport);

  return { client, close: () => client.close() };
}

test("the server completes an MCP handshake over stdio", async () => {
  const { client, close } = await connect();

  try {
    const info = client.getServerVersion();
    assert.equal(info.name, "vibeguru");
    assert.equal(info.version, require("../package.json").version);
  } finally {
    await close();
  }
});

test("it exposes exactly the two tools, and no more", async () => {
  const { client, close } = await connect();

  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    // Deliberately strict. Every tool's schema is loaded into the agent's context
    // before it does any work, so tool count is a running cost, not a feature list.
    assert.deepEqual(names, ["read_findings", "verify_runtime"]);
  } finally {
    await close();
  }
});

test("verify_runtime advertises when to call it and what it costs", async () => {
  const { client, close } = await connect();

  try {
    const { tools } = await client.listTools();
    const verify = tools.find((t) => t.name === "verify_runtime");

    assert.match(verify.description, /deterministic/i, "the no-LLM property is the pitch");
    assert.match(verify.description, /before reporting work as done/i, "must say when to call it");
    assert.match(verify.description, /minute/i, "an agent should know this is not instant");

    const props = verify.inputSchema.properties;
    assert.deepEqual(Object.keys(props).sort(), ["cycles", "root", "routes", "url", "write_report"]);
    // Nothing is required: the useful default is "analyze the project I'm in".
    assert.ok(!verify.inputSchema.required || verify.inputSchema.required.length === 0);
  } finally {
    await close();
  }
});

test("read_findings explains why it exists rather than re-running", async () => {
  const { client, close } = await connect();

  try {
    const { tools } = await client.listTools();
    const read = tools.find((t) => t.name === "read_findings");

    assert.match(read.description, /without running it again/i);
    assert.match(read.description, /costs minutes/i);
  } finally {
    await close();
  }
});

test("read_findings before any run says so instead of failing silently", async () => {
  const { client, close } = await connect();

  try {
    const res = await client.callTool({ name: "read_findings", arguments: {} });

    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /No run yet/i);
    assert.match(res.content[0].text, /verify_runtime/, "must name the tool to call instead");
  } finally {
    await close();
  }
});

test("reading a project with no report points at how to produce one", async () => {
  const { client, close } = await connect();

  try {
    const res = await client.callTool({
      name: "read_findings",
      arguments: { root: path.join(REPO_ROOT, "driver-node") },
    });

    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /write_report/);
  } finally {
    await close();
  }
});

test("an unusable project directory is reported, not crashed on", async () => {
  const { client, close } = await connect();

  try {
    const res = await client.callTool({
      name: "verify_runtime",
      arguments: { root: path.join(REPO_ROOT, "definitely-not-here") },
    });

    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /does not exist/i);
  } finally {
    await close();
  }
});
