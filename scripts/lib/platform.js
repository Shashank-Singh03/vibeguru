"use strict";

// Maps the current host to the GitHub Release asset built by Burrito in CI, and
// works out where the downloaded binary and the bundled driver live inside the
// installed package. Shared by the install step (scripts/postinstall.js) and the
// launcher (bin/vibeguru.js) so the naming only lives in one place.

const path = require("path");

const REPO = "Shashank-Singh03/vibeguru";

// `${process.platform}:${process.arch}` -> release asset filename.
// These names MUST match what .github/workflows/release.yml uploads.
const ASSETS = {
  "win32:x64": "vibeguru-windows-x64.exe",
  "darwin:x64": "vibeguru-macos-x64",
  "darwin:arm64": "vibeguru-macos-arm64",
  "linux:x64": "vibeguru-linux-x64",
};

// <pkg>/ — this file is at <pkg>/scripts/lib/platform.js.
const packageRoot = path.resolve(__dirname, "..", "..");

function platformKey() {
  return `${process.platform}:${process.arch}`;
}

function assetName() {
  const name = ASSETS[platformKey()];

  if (!name) {
    throw new Error(
      `Unsupported platform ${platformKey()}. ` +
        `Vibe Guru ships binaries for: ${Object.values(ASSETS).join(", ")}.`
    );
  }

  return name;
}

// Where we cache the fetched self-contained binary.
function binaryPath() {
  const ext = process.platform === "win32" ? ".exe" : "";
  return path.join(packageRoot, "vendor", `vibeguru${ext}`);
}

// The bundled Node/Playwright harness the Elixir binary drives (via the
// VIBEGURU_DRIVER_PATH env var the launcher sets).
function driverPath() {
  return path.join(packageRoot, "driver-node", "index.js");
}

function downloadUrl(version) {
  return `https://github.com/${REPO}/releases/download/v${version}/${assetName()}`;
}

module.exports = { REPO, packageRoot, platformKey, assetName, binaryPath, driverPath, downloadUrl };
