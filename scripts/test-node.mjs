// Run the Node test suite the same way on every Node version we support.
//
// `node --test` accepts different things depending on the version: older runners do
// not understand glob patterns, newer ones do not treat a bare directory as one to
// recurse. Picking either form means the suite works on some versions and not others.
//
// The failure mode is what makes this worth a script. A `node --test` run that matches
// NO files exits 0, so a discovery regression does not turn CI red — it turns it green
// while running nothing, which is the one outcome a test suite must never produce.
//
// So discovery happens here, with readdir, and the runner is handed explicit file
// paths. Explicit paths are understood by every version; a file that has gone missing
// is an error rather than silence; and a new test file is picked up without anyone
// remembering to edit this script.

import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { beginSuite, finishSuite, parseTap, repositoryRoot } from "./lib/test-history.mjs";

const DIR = "test-node";

// A hand-rolled walk rather than `readdirSync(..., { recursive: true })`, which only
// arrived in Node 20.1 — this file is the one place that must not assume a version.
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.name.endsWith(".test.js")) out.push(path);
  }
  return out;
}

const files = walk(DIR).sort();

if (files.length === 0) {
  console.error(`No test files found under ${DIR}/ — refusing to report success.`);
  process.exit(1);
}

// Browser suites cold-start real Chromium. Avoid one worker per CPU core (twenty
// on this host) competing during fixture startup. Scenario deadlines are unchanged.
const concurrency = 4;
console.log(`Running ${files.length} test files on Node ${process.version} (${concurrency} file workers)`);

const record = beginSuite("Node tests", "npm test");
const logPath = `reports/test-history/${record.id}.tap`;
const run = spawnSync(process.execPath, ["--test", `--test-concurrency=${concurrency}`, "--test-reporter=spec", "--test-reporter=tap",
  "--test-reporter-destination=stdout", `--test-reporter-destination=${join(repositoryRoot, logPath)}`, ...files],
  { stdio: "inherit", windowsHide: true });
let output = "";
try { output = readFileSync(join(repositoryRoot, logPath), "utf8"); } catch {}
const result = parseTap(output, run.status);
finishSuite(record, { ...result, scope: "repository", runner_concurrency: concurrency, log_path: logPath, exit_code: run.status });

// A signal (a crash, a timeout kill) leaves status null; that is a failure, not a pass.
process.exit(run.status === 0 && result.status === "PASS" ? 0 : run.status || 1);
