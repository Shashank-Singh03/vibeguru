"use strict";

// The two setup steps a fresh install needs: fetch the platform binary, and make
// sure Playwright's Chromium is present. Shared by postinstall (eager, best-effort)
// and the launcher (lazy retry if postinstall was skipped via --ignore-scripts).

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { createHash, randomUUID } = require("crypto");

const { assetName, binaryPath, downloadUrl } = require("./platform");
const { download } = require("./download");
const { version } = require("../../package.json");
// Release hosting is a deliberate trust decision. Add a new distribution host
// here when its authenticated publication path has been reviewed.
const RELEASE_HOSTS = Object.freeze(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "github-releases.githubusercontent.com"]);

// Returns the path to the ready-to-run binary, downloading it if missing.
async function ensureBinary({ force = false } = {}) {
  const dest = binaryPath();
  const metadata = `${dest}.json`;

  if (!force && fs.existsSync(dest) && fs.existsSync(metadata)) {
    try {
      const stored = JSON.parse(fs.readFileSync(metadata, "utf8"));
      if (stored.version === version && stored.sha256 === createHash("sha256").update(fs.readFileSync(dest)).digest("hex")) return dest;
    } catch { /* Retry incomplete or outdated caches. */ }
  }

  process.stderr.write(`vibeguru: downloading ${assetName()} (v${version})\n`);
  const manifest = `${dest}.${randomUUID()}.sums`;
  let sha256;
  try {
    await download(new URL("SHA256SUMS", downloadUrl(version)).href, manifest, { maxBytes: 1024 * 1024, allowedHosts: RELEASE_HOSTS });
    sha256 = checksumFor(fs.readFileSync(manifest, "utf8"), assetName());
    await download(downloadUrl(version), dest, { sha256, allowedHosts: RELEASE_HOSTS });
  } finally {
    fs.rmSync(manifest, { force: true });
  }
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
  fs.writeFileSync(metadata, JSON.stringify({ version, sha256 }));

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

function checksumFor(manifest, asset) {
  const line = manifest.split(/\r?\n/).map(l => l.trim().split(/\s+/)).find(parts => parts[1]?.replace(/^\*/, "") === asset);
  if (!line || !/^[a-f0-9]{64}$/i.test(line[0])) throw new Error(`Release checksum missing for ${asset}.`);
  return line[0].toLowerCase();
}
module.exports = { ensureBinary, ensureChromium, isChromiumInstalled, checksumFor, RELEASE_HOSTS };
