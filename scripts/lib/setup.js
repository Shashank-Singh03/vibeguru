"use strict";

// The two setup steps a fresh install needs: fetch the platform binary, and make
// sure Playwright's Chromium is present. Shared by postinstall (eager, best-effort)
// and the launcher (lazy retry if postinstall was skipped via --ignore-scripts).

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { assetName, binaryPath, downloadUrl } = require("./platform");
const { download } = require("./download");
const { version } = require("../../package.json");

// Returns the path to the ready-to-run binary, downloading it if missing.
async function ensureBinary({ force = false } = {}) {
  const dest = binaryPath();

  if (!force && fs.existsSync(dest)) {
    return dest;
  }

  process.stderr.write(`vibeguru: downloading ${assetName()} (v${version})\n`);
  await download(downloadUrl(version), dest);
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);

  return dest;
}

// `playwright` is a direct dependency, so its package resolves from here. We can't
// require its cli.js subpath directly (not whitelisted in playwright's "exports"),
// so we resolve the package.json (which is) and read the real bin path off it.
function ensureChromium() {
  const pkgJson = require.resolve("playwright/package.json");
  const cli = path.join(path.dirname(pkgJson), require(pkgJson).bin.playwright);
  execFileSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
}

// Cheap presence check so the launcher doesn't shell out to the installer on every
// run. executablePath() reports where Chromium WOULD live; existsSync confirms it's
// actually been downloaded.
function isChromiumInstalled() {
  try {
    const { chromium } = require("playwright");
    const exe = chromium.executablePath();
    return Boolean(exe) && fs.existsSync(exe);
  } catch {
    return false;
  }
}

module.exports = { ensureBinary, ensureChromium, isChromiumInstalled };
