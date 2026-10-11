#!/usr/bin/env node
// Repeatable source-checkout benchmark: copy bundled fixtures into ignored output,
// then run the real engine against a declared vulnerable/corrected condition matrix.
import { mkdir, readFile, writeFile, readdir, access } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { repositoryRoot as root } from "./lib/test-history.mjs";

const options = process.argv.slice(2);
let cycles = 6, port = 65324, suite = "all";
const usage = "Usage: npm run lab:adversarial -- [--suite all|state] [--cycles 3..30] [--port 1024..65532]";
for (let index = 0; index < options.length; index += 2) {
  if (options[index] === "--suite") {
    if (!["all", "state"].includes(options[index + 1])) throw new Error(usage);
    suite = options[index + 1]; continue;
  }
  if (!["--cycles", "--port"].includes(options[index]) || !/^\d+$/.test(options[index + 1] || "")) throw new Error(usage);
  if (options[index] === "--cycles") cycles = Number(options[index + 1]); else port = Number(options[index + 1]);
}
if (cycles < 3 || cycles > 30 || port < 1024 || port > 65532) throw new Error("Invalid cycles or starting port");
await access(join(root, "vibeguru")).catch(() => { throw new Error("Build the local engine first: mix escript.build"); });
const workspace = join(root, "reports", `adversarial-evaluation-${Date.now()}`);
await mkdir(workspace, { recursive: false });
const skip = new Set(["node_modules", ".git", "dist", "build", ".vibeguru"]);
async function prepare(name) {
  const source = join(root, "test-app", name), snapshot = join(workspace, name), source_hashes = {};
  async function copy(directory = "") {
    for (const entry of await readdir(join(source, directory), { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!skip.has(entry.name)) await copy(file); continue; }
      if (!entry.isFile() || entry.name.startsWith(".env") || /\.(pem|key)$/.test(entry.name)) continue;
      const destination = resolve(snapshot, file), boundary = relative(snapshot, destination);
      if (boundary.startsWith("..") || resolve(snapshot) === destination) throw new Error("Unsafe fixture destination");
      const body = await readFile(join(source, file));
      await mkdir(join(destination, ".."), { recursive: true }); await writeFile(destination, body);
      source_hashes[file.replaceAll("\\", "/")] = createHash("sha256").update(body).digest("hex");
    }
  }
  await copy(); return { source, snapshot, source_hashes };
}
const asyncApp = suite === "all" ? await prepare("async-workbench") : null;
const writeApp = suite === "all" ? await prepare("write-integrity") : null;
const storageApp = await prepare("storage-workbench"), conflictApp = await prepare("conflict-workbench");
const offsets = { "pending-navigation": 0, "http-recovery": 0, "write-integrity": 1, "storage-resilience": 2, "conflicting-writes": 3 };
const app = (id, adapter, fixture, urlMode, variants, expectations, candidate = null) => ({
  id, adapter, adapter_group: "lab", runtime: "node-fixture", ...fixture, port: port + offsets[adapter],
  url_path: `/?mode=${urlMode}`, source_kind: candidate ? "control" : "synthetic", cycles, variants,
  expectations: Object.fromEntries(Object.entries(expectations).map(([variant, failures]) => [variant, { failures }])),
  ...(candidate ? { compare_with: candidate } : {})
});
const navVariants = ["nav-complete", "nav-pending", "interrupted"];
const httpVariants = ["http-normal", "http-503", "http-disconnect", "http-malformed"];
const writeVariants = ["write-single", "write-double", "write-retry"];
const storageVariants = ["storage-normal", "storage-corrupt", "storage-shape", "storage-denied", "storage-quota"];
const conflictVariants = ["conflict-serial", "conflict-stale", "conflict-reversed"];
const manifest = { label: suite === "state" ? "State resilience lab" : "Adversarial reliability lab", workspace, apps: [
  ...(suite === "all" ? [
  app("navigation-vulnerable", "pending-navigation", asyncApp, "broken", navVariants, { "nav-complete": [], "nav-pending": ["pending-view-isolation"] }),
  app("navigation-candidate", "pending-navigation", asyncApp, "fixed", navVariants, { "nav-complete": [], "nav-pending": [] }, "navigation-vulnerable"),
  app("http-vulnerable", "http-recovery", asyncApp, "broken", httpVariants, { "http-normal": [], "http-503": ["recovery-usable"], "http-disconnect": ["recovery-usable"], "http-malformed": ["recovery-usable"] }),
  app("http-candidate", "http-recovery", asyncApp, "fixed", httpVariants, Object.fromEntries(httpVariants.map(variant => [variant, []])), "http-vulnerable"),
  app("write-vulnerable", "write-integrity", writeApp, "vulnerable", writeVariants, { "write-single": [], "write-double": ["single-persisted-order"], "write-retry": ["single-persisted-order"] }),
  app("write-candidate", "write-integrity", writeApp, "idempotent", writeVariants, Object.fromEntries(writeVariants.map(variant => [variant, []])), "write-vulnerable")
  ] : []),
  app("storage-vulnerable", "storage-resilience", storageApp, "vulnerable", storageVariants, Object.fromEntries(storageVariants.map(variant => [variant, variant === "storage-normal" ? [] : ["storage-recovery-contract"]]))),
  app("storage-candidate", "storage-resilience", storageApp, "defensive", storageVariants, Object.fromEntries(storageVariants.map(variant => [variant, []])), "storage-vulnerable"),
  app("conflict-vulnerable", "conflicting-writes", conflictApp, "vulnerable", conflictVariants, { "conflict-serial": [], "conflict-stale": ["both-edits-preserved"], "conflict-reversed": ["both-edits-preserved"] }),
  app("conflict-candidate", "conflicting-writes", conflictApp, "versioned", conflictVariants, Object.fromEntries(conflictVariants.map(variant => [variant, []])), "conflict-vulnerable")
], limitations: [
  "Purpose-built vulnerable/corrected fixtures; no new naturally occurring customer defect is claimed.",
  "Navigation has a 300ms post-response window. Recovery has a 600ms UI deadline and an explicit disabled-button reset between cycles.",
  "HTTP 503 and transport faults remain app runtime findings even when the recovery expectation matches.",
  "Writes use one isolated in-memory process; no durable database, distributed locking or ambiguous lost-response recovery is evaluated.",
  "Storage corruption uses real browser bytes; access denial and quota errors are scoped injected DOMExceptions, not actual exhausted browser quota.",
  "Storage cold starts use same-origin iframe documents; the main measurement document stays loaded. Explicit retry follows controlled fault removal.",
  "Conflict checks use two isolated clients, distinct field edits, and acknowledged stale-write schedules against one in-memory versioned server; secondary-client runtime has separately bounded observation.",
  "Candidate modes are manually authored in the same fixture source; this is not autonomous source repair."
] };
const manifestPath = join(workspace, "manifest.json");
await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ manifest: manifestPath, workspace, suite, cases: manifest.apps.reduce((sum, entry) => sum + entry.variants.length, 0), cycles_per_case: cycles }));
const child = spawn(process.execPath, [join(root, "scripts/lab.mjs"), manifestPath], { cwd: root, windowsHide: true, stdio: "inherit" });
const code = await new Promise((done, reject) => { child.once("error", reject); child.once("close", done); });
process.exitCode = code ?? 1;
