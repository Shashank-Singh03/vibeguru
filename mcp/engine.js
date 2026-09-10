"use strict";

// engine.js — drive the vibeguru binary on behalf of the MCP server.
//
// The binary is the same self-contained one `npx vibeguru` runs; nothing about the
// analysis changes when it is invoked by an agent instead of a person. This module
// only handles the mechanics: pick the right sub-command, run it somewhere that does
// not litter the user's repo, and hand back parsed findings.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const { binaryPath, driverPath } = require("../scripts/lib/platform");
const { ensureBinary, ensureChromium, isChromiumInstalled } = require("../scripts/lib/setup");

// The CLI's exit codes are a contract: 0 clean, 1 findings present (the CI gate),
// 2 the run itself failed, 64 bad usage. Only the last two are errors here —
// "found problems" is a successful analysis, and is in fact the common case.
const EXIT_CLEAN = 0;
const EXIT_FINDINGS = 1;

const FINDINGS_FILE = "vibeguru-findings.json";

// VIBEGURU_BINARY short-circuits the download. Contributors working on this server
// have a locally built binary and no published release to fetch; without an override
// the first tool call would try to download a version that does not exist yet.
async function resolveBinary() {
  const override = process.env.VIBEGURU_BINARY;

  if (override) {
    if (!fs.existsSync(override)) {
      throw new Error(`VIBEGURU_BINARY points at ${override}, which does not exist`);
    }
    return override;
  }

  const cached = binaryPath();
  return fs.existsSync(cached) ? cached : ensureBinary();
}

function runBinary(bin, args, { onLog, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, VIBEGURU_DRIVER_PATH: driverPath() },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    // The CLI reports progress on stderr as "  [phase] message". A browser run takes
    // minutes, so forwarding these keeps the caller from thinking it has hung.
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) onLog?.(trimmed);
      }
    });

    child.on("error", (err) => reject(new Error(`could not launch vibeguru: ${err.message}`)));
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}

// Findings go to a scratch directory by default. Writing CLAUDE.md and two report
// files into someone's repo is a side effect they did not ask for when all they
// wanted was an answer — `writeReport` opts back into it.
function outputDir(root, writeReport) {
  if (writeReport) return root;
  return fs.mkdtempSync(path.join(os.tmpdir(), "vibeguru-mcp-"));
}

function hasConfig(root) {
  return fs.existsSync(path.join(root, "vibeguru.json"));
}

function readFindings(dir) {
  const file = path.join(dir, FINDINGS_FILE);

  if (!fs.existsSync(file)) return null;

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`findings file at ${file} is not valid JSON: ${err.message}`);
  }
}

/**
 * Run an analysis and return the parsed report.
 *
 * With `url`, the low-level path is used: it analyses an already-running server and
 * needs no config. Without it, the config-driven path runs, which also starts the
 * dev server if it is not up — and `init` is run first when the project has never
 * been set up, because an agent should not have to know about a two-step flow.
 */
async function analyze({ root, url, cycles, routes, writeReport = false, onLog } = {}) {
  const projectRoot = path.resolve(root || process.cwd());

  // Check this before fetching anything. A mistyped path is the likeliest bad input,
  // and it should come back as "no such directory" rather than as a download failure.
  if (!fs.existsSync(projectRoot)) {
    throw new Error(`project directory does not exist: ${projectRoot}`);
  }

  const bin = await resolveBinary();

  if (!isChromiumInstalled()) {
    onLog?.("fetching Chromium (first run only)");
    try {
      ensureChromium();
    } catch (err) {
      onLog?.(`Chromium install failed (${err.message}); the run may fail`);
    }
  }

  const out = outputDir(projectRoot, writeReport);
  const common = ["--out", out, "--cycles", String(cycles), "--routes", String(routes)];
  let result;

  if (url) {
    result = await runBinary(bin, ["memory:client", url, ...common], { onLog, cwd: projectRoot });
  } else {
    if (!hasConfig(projectRoot)) {
      onLog?.("no vibeguru.json found — detecting the project first");
      const init = await runBinary(bin, ["init", "--root", projectRoot], { onLog, cwd: projectRoot });

      if (init.code !== EXIT_CLEAN) {
        throw new Error(`could not detect the project: ${lastError(init) || `init exited ${init.code}`}`);
      }
    }

    result = await runBinary(bin, ["run", "--root", projectRoot, ...common], {
      onLog,
      cwd: projectRoot,
    });
  }

  if (result.code !== EXIT_CLEAN && result.code !== EXIT_FINDINGS) {
    throw new Error(lastError(result) || `vibeguru exited with code ${result.code}`);
  }

  const report = readFindings(out);

  if (!report) {
    throw new Error(`the run finished but wrote no ${FINDINGS_FILE} — check that the app started`);
  }

  return { report, outDir: out, exitCode: result.code, wroteReport: Boolean(writeReport) };
}

// The CLI prints failures as "✗ <explanation>"; surfacing that beats a bare exit code.
function lastError({ stderr }) {
  const line = stderr
    .split("\n")
    .map((l) => l.trim())
    .reverse()
    .find((l) => l.startsWith("✗"));

  return line ? line.replace(/^✗\s*/, "") : null;
}

module.exports = { analyze, readFindings, FINDINGS_FILE };
