#!/usr/bin/env node
"use strict";

// `npx vibeguru ...` lands here. We pick the self-contained binary fetched for
// this platform, point it at the bundled Node driver via VIBEGURU_DRIVER_PATH,
// forward argv + stdio, and mirror its exit code. The Elixir/Burrito binary needs
// no Erlang on the user's machine; Node is already present (they ran us via npx).

const fs = require("fs");
const { spawn } = require("child_process");

const { binaryPath, driverPath } = require("../scripts/lib/platform");
const { ensureBinary, ensureChromium, isChromiumInstalled } = require("../scripts/lib/setup");

// Commands that drive a browser. `init` is here too so the explicit setup step
// fetches Chromium up front, per the project's "init auto-fetches the browser" goal.
const BROWSER_COMMANDS = new Set(["init", "run", "memory:client"]);

async function resolveBinary() {
  const cached = binaryPath();
  if (fs.existsSync(cached)) return cached;

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
  let bin;

  try {
    bin = await resolveBinary();
  } catch (err) {
    process.stderr.write(`vibeguru: could not obtain the platform binary.\n  ${err.message}\n`);
    process.exit(1);
    return;
  }

  ensureBrowserFor(process.argv.slice(2));

  const child = spawn(bin, process.argv.slice(2), {
    stdio: "inherit",
    env: { ...process.env, VIBEGURU_DRIVER_PATH: driverPath() },
  });

  child.on("error", (err) => {
    process.stderr.write(`vibeguru: failed to launch binary: ${err.message}\n`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
}

main();
