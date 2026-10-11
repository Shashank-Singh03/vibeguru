import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync, statSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const git = (root, args) => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).stdout || "";

export function sourceRevision(root = repositoryRoot) {
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0");
  const files = [];
  for (let i = 0; i < status.length; i++) {
    const entry = status[i];
    if (!entry) continue;
    const path = entry.slice(3).replaceAll("\\", "/");
    if (/R|C/.test(entry.slice(0, 2))) i++;
    if (path.startsWith("docs/") || path.endsWith(".md") || path.startsWith("reports/")) continue;
    let stamp = "deleted";
    try { const stat = statSync(join(root, path)); stamp = `${stat.size}:${stat.mtimeMs}`; } catch {}
    files.push([entry.slice(0, 2), path, stamp]);
  }
  return createHash("sha256").update(JSON.stringify([git(root, ["rev-parse", "HEAD"]).trim(), files.sort()])).digest("hex");
}

export function saveSuite(record, root = repositoryRoot) {
  const directory = join(root, "reports", "test-history");
  mkdirSync(directory, { recursive: true });
  const target = join(directory, `${record.id}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(record, null, 2));
  renameSync(temporary, target);
  return record;
}

export function beginSuite(suite, command, root = repositoryRoot) {
  return saveSuite({ schema_version: 1, id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    suite, command, status: "RUNNING", started_at: new Date().toISOString(), finished_at: null,
    duration_ms: null, tests: null, passed: null, failed: null, skipped: null, failures: [],
    log_path: null, source_revision: sourceRevision(root) }, root);
}

export function finishSuite(record, result, root = repositoryRoot) {
  return saveSuite({ ...record, ...result, finished_at: new Date().toISOString(),
    duration_ms: Date.now() - Date.parse(record.started_at) }, root);
}

export function parseTap(output, exit) {
  const count = name => { const matches = [...output.matchAll(new RegExp(`^# ${name} (\\d+)\\s*$`, "gm"))]; return matches.length ? Number(matches.at(-1)[1]) : null; };
  const tests = count("tests"), passed = count("pass"), failed = count("fail"), skipped = count("skipped");
  const failures = [];
  const lines = output.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*not ok \d+ - (.+)/.exec(lines[i]);
    if (!match) continue;
    const detail = [];
    for (let next = i + 1; next < lines.length && next < i + 32; next++) {
      if (/^\s*(?:ok|not ok) \d+ -|^# Subtest:/.test(lines[next])) break;
      detail.push(lines[next]);
    }
    failures.push({ name: match[1], message: detail.join("\n").slice(0, 4000) });
  }
  return { tests, passed, failed, skipped, failures,
    status: exit === 0 && tests > 0 && passed > 0 && failed === 0 ? "PASS" : failed > 0 ? "FAIL" : "ERROR" };
}
