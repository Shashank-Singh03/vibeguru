#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { join, relative } from "node:path";
import { beginSuite, finishSuite, sourceRevision, repositoryRoot } from "./lib/test-history.mjs";

if (process.argv[2] === "--revision") { console.log(sourceRevision()); process.exit(0); }

async function check(suite, command) {
  const record = beginSuite(suite, command);
  const env = suite === "Elixir command" ? { ...process.env, VIBEGURU_TEST_SCOPE: "repository" } : process.env;
  const logPath = join(repositoryRoot, "reports/test-history", `${record.id}.log`);
  const log = createWriteStream(logPath);
  const child = process.platform === "win32"
    ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], { cwd: repositoryRoot, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    : spawn("sh", ["-c", command], { cwd: repositoryRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  let tail = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => {
    process.stdout.write(data); log.write(data); tail = (tail + data).slice(-12000);
  });
  let exit = null, failure = null;
  try { exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }); }
  catch (error) { failure = error.message; }
  await new Promise(resolve => log.end(resolve));
  const finished = finishSuite(record, { status: exit === 0 ? "PASS" : "ERROR", tests: null, passed: null, failed: null, skipped: null,
    failures: exit === 0 ? [] : [{ name: suite, message: failure || tail }],
    log_path: relative(repositoryRoot, logPath).replaceAll("\\", "/"), exit_code: exit });
  return { id: finished.id, suite, status: finished.status, duration_ms: finished.duration_ms, log_path: finished.log_path, exit_code: exit };
}

const selected = process.argv[2] || "all";
if (!["all", "elixir"].includes(selected)) throw new Error("Usage: node scripts/checks.mjs [all|elixir|--revision]");
let success = true;
const aggregate = beginSuite(selected === "all" ? "Full repository check" : "Elixir repository check", selected === "all" ? "npm run check" : "npm run test:elixir");
const stages = [];
async function stage(suite, command) {
  const result = await check(suite, command);
  stages.push(result); success = result.status === "PASS" && success;
}
for (const [suite, command] of [["Formatting", "mix format --check-formatted"], ["Compile", "mix compile --warnings-as-errors"]]) {
  await stage(suite, command);
}
// mix test records detailed counts/failures through the test-only ExUnit formatter.
await stage("Elixir command", "mix test");
if (selected === "all") await stage("Node command", "node scripts/test-node.mjs");
finishSuite(aggregate, { status: success ? "PASS" : "ERROR", stages,
  failures: stages.filter(item => item.status !== "PASS").map(item => ({ name: item.suite, message: `See ${item.log_path}` })), exit_code: success ? 0 : 1 });
process.exitCode = success ? 0 : 1;
