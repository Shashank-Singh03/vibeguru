"use strict";

// Runs after `npm install` / `npx vibeguru`. Both steps are best-effort: if the
// machine is offline or the platform is unsupported we DON'T fail the install —
// the launcher retries the binary download lazily and `vibeguru init` re-checks
// Chromium. Failing here would make the package uninstallable on flaky networks.

const { ensureBinary, ensureChromium } = require("./lib/setup");

async function main() {
  try {
    await ensureBinary();
  } catch (err) {
    process.stderr.write(
      `vibeguru: binary download deferred (${err.message}). It will be fetched on first run.\n`
    );
  }

  try {
    ensureChromium();
  } catch (err) {
    process.stderr.write(
      `vibeguru: Chromium install deferred (${err.message}). Run \`vibeguru init\` to finish setup.\n`
    );
  }
}

main();
