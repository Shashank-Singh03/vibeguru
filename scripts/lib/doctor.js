"use strict";
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { ASSETS, platformKey, binaryPath, driverPath } = require("./platform");
const { launchSpec } = require("./launch");
const { isChromiumInstalled } = require("./setup");
const { version } = require("../../package.json");

function assessInstallation(state) {
  const checks = [
    { name: "Node.js 20+", ready: Number(state.nodeVersion.split(".")[0].replace(/^v/, "")) >= 20, hint: "Install Node.js 20 or newer, then reopen your terminal." },
    { name: "Platform build target", ready: Boolean(state.supported), hint: "Use Windows x64, Linux x64, or macOS Intel/Apple Silicon. A target is not proof of a validated release." },
    { name: state.override ? "Explicit engine override" : "Verified engine cache", ready: state.binaryReady, hint: state.override ? "Check VIBEGURU_BINARY and rebuild the local engine with mix escript.build." : "Matching native release is required. Retry installation when its assets and checksums are available." },
    { name: "Engine launcher", ready: state.launcherReady, hint: "Development escripts require Erlang's escript on PATH. Validated native releases bundle Erlang." },
    { name: "Bundled browser driver", ready: state.driverReady, hint: "Reinstall the complete npm package; a bare native binary is insufficient." },
    { name: "Playwright Chromium", ready: state.chromiumReady, hint: "Run npx playwright install chromium in this installation, then rerun doctor." },
  ];
  return { ready: checks.every(check => check.ready), checks };
}

function engineKind(header, size, platform = process.platform) {
  if (!Buffer.isBuffer(header) || size < 64) return null;
  if (/^#![^\n]*\bescript\b/.test(header.toString("utf8"))) return "escript";
  if (platform === "win32" && header[0] === 0x4d && header[1] === 0x5a) return "native";
  if (platform === "linux" && header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return "native";
  if (platform === "darwin" && ["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"].includes(header.subarray(0, 4).toString("hex"))) return "native";
  return null;
}

function inspectInstallation() {
  const override = process.env.VIBEGURU_BINARY;
  const binary = override || binaryPath();
  let binaryReady = false, launcherReady = false;
  try {
    const stat = fs.statSync(binary), header = Buffer.alloc(160);
    const descriptor = fs.openSync(binary, "r");
    try { fs.readSync(descriptor, header, 0, header.length, 0); } finally { fs.closeSync(descriptor); }
    const kind = engineKind(header, stat.size);
    binaryReady = stat.isFile() && Boolean(kind);
    if (kind === "native" && process.platform !== "win32") fs.accessSync(binary, fs.constants.X_OK);
    if (!override) {
      const metadata = JSON.parse(fs.readFileSync(`${binary}.json`, "utf8"));
      binaryReady = binaryReady && metadata.version === version && /^[a-f0-9]{64}$/.test(metadata.sha256) &&
        metadata.sha256 === createHash("sha256").update(fs.readFileSync(binary)).digest("hex");
    }
    const spec = launchSpec(binary, []);
    launcherReady = binaryReady && (spec.command === binary || !spawnSync(spec.command, ["--help"], { windowsHide: true, stdio: "ignore", timeout: 3000 }).error);
  } catch { /* Missing or invalid files remain unavailable. */ }
  return assessInstallation({ nodeVersion: process.version, supported: Object.hasOwn(ASSETS, platformKey()), override: Boolean(override),
    binaryReady, launcherReady, driverReady: fs.existsSync(driverPath()), chromiumReady: isChromiumInstalled() });
}

async function runDoctor() {
  const result = inspectInstallation();
  process.stdout.write(`Vibe Guru ${version} installation check (${platformKey()}, Node ${process.version})\n`);
  for (const check of result.checks) process.stdout.write(`${check.ready ? "OK" : "MISSING"}  ${check.name}${check.ready ? "" : `\n  ${check.hint}`}\n`);
  process.stdout.write(result.ready ? "Installation prerequisites are present. Run a scoped app check to verify execution.\n" : "Installation is incomplete. No downloads or configuration changes were made.\n");
  return result.ready ? 0 : 2;
}
module.exports = { assessInstallation, engineKind, inspectInstallation, runDoctor };
