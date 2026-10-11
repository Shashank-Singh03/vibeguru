#!/usr/bin/env node
"use strict";

// `npx vibeguru ...` lands here. We pick the self-contained binary fetched for
// this platform, point it at the bundled Node driver via VIBEGURU_DRIVER_PATH,
// forward argv + stdio, and mirror its exit code. The Elixir/Burrito binary needs
// no Erlang on the user's machine; Node is already present (they ran us via npx).

const { spawn } = require("child_process");

const { driverPath } = require("../scripts/lib/platform");
const { ensureBinary, ensureChromium, isChromiumInstalled } = require("../scripts/lib/setup");
const { launchSpec, binaryOverride } = require("../scripts/lib/launch");
const { telemetryCommand, startCliRun } = require("../scripts/lib/telemetry-cli");

// Commands that drive a browser. `init` is here too so the explicit setup step
// fetches Chromium up front, per the project's "init auto-fetches the browser" goal.
const BROWSER_COMMANDS = new Set(["init", "run", "memory:client", "auth"]);

// `mcp` is handled in Node rather than forwarded: it speaks the Model Context
// Protocol over stdio and drives the same binary underneath, one analysis per
// tool call. It must be intercepted before the spawn below, because stdio here
// belongs to the protocol — anything the Elixir binary printed to stdout would
// be read by the client as a malformed JSON-RPC frame.
function startMcpServer() {
  require("../mcp/server.js");
}

async function resolveBinary() {
  const override = binaryOverride();
  if (override) return override;
  // postinstall may have been skipped (--ignore-scripts) or have failed offline.
  return ensureBinary();
}

// Best-effort: guarantee Chromium before a browser command so the first run never
// dies on a missing browser. Non-fatal — `init` must still write config offline,
// and a real run will surface a clearer Playwright error if the browser is absent.
function ensureBrowserFor(argv) {
  if (!BROWSER_COMMANDS.has(argv[0]) || isChromiumInstalled()) return;

  try {
    ensureChromium();
  } catch (err) {
    process.stderr.write(`vibeguru: Chromium not ready (${err.message}); continuing.\n`);
  }
}

async function main() {
  if (process.argv[2] === "doctor") {
    process.exitCode = await require("../scripts/lib/doctor").runDoctor();
    return;
  }
  if (process.argv[2] === "telemetry") {
    try { process.exitCode = await telemetryCommand(process.argv.slice(3)); }
    catch (err) { process.stderr.write(`vibeguru: ${err.message}\n`); process.exitCode = 64; }
    return;
  }
  if (process.argv[2] === "mcp") {
    startMcpServer();
    return;
  }

  // The MCP server owns its own lifecycle events; its child calls the engine
  // binary directly, so the same run is never counted by both entry points.
  const run = startCliRun(process.argv.slice(2));
  await run?.started;
  let bin;

  try {
    bin = await resolveBinary();
  } catch (err) {
    process.stderr.write(`vibeguru: could not obtain the platform binary.\n  ${err.message}\n`);
    await run?.finish({ code: 2, errorCategory: "setup" });
    process.exit(2);
    return;
  }

  ensureBrowserFor(process.argv.slice(2));

  let child;
  try {
    const launch = launchSpec(bin, process.argv.slice(2));
    child = spawn(launch.command, launch.args, {
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, VIBEGURU_DRIVER_PATH: driverPath() },
    });
  } catch (err) {
    process.stderr.write(`vibeguru: failed to launch binary: ${err.message}\n`);
    await run?.finish({ code: 2, errorCategory: "launch" });
    process.exitCode = 2;
    return;
  }

  child.on("error", async (err) => {
    process.stderr.write(`vibeguru: failed to launch binary: ${err.message}\n`);
    await run?.finish({ code: 2, errorCategory: "launch" });
    process.exit(2);
  });

  child.on("exit", async (code, signal) => {
    await run?.finish({ code: code ?? 2, signal });
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 2);
  });
}

main().catch((err) => {
  process.stderr.write(`vibeguru: execution failed: ${err.message}\n`);
  process.exitCode = 2;
});
