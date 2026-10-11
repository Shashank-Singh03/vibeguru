#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { corruptionCorpus } from "../benchmarks/report-corruption.mjs";
import { beginSuite, finishSuite, repositoryRoot } from "./lib/test-history.mjs";
const { assessReport } = createRequire(import.meta.url)("../mcp/report.js");
if (!process.argv[2]) throw new Error("Usage: node scripts/adversarial-reports.mjs <recorded-clean-report.json>");
const seedPath = resolve(process.argv[2]), body = await readFile(seedPath), seed = JSON.parse(body);
if (assessReport(seed).verdict !== "PASS") throw new Error("Corpus needs a complete, currently passing recorded seed");
const record = beginSuite("Evidence corruption corpus", `node scripts/adversarial-reports.mjs ${process.argv[2]}`);
const results = corruptionCorpus(seed).map(({ id, expected, report }) => {
  let actual;
  try { actual = assessReport(report); } catch (error) { actual = { verdict: "THREW", reasons: [error.message] }; }
  return { id, expected, actual: actual.verdict, reasons: actual.reasons, passed: actual.verdict === expected };
});
const output = `reports/adversarial-evidence/${record.id}.json`, logPath = `reports/test-history/${record.id}.log`;
await mkdir(resolve(repositoryRoot, "reports/adversarial-evidence"), { recursive: true });
const result = { schema_version: 1, synthetic: true, seed_path: seedPath, seed_sha256: createHash("sha256").update(body).digest("hex"),
  checked_at: new Date().toISOString(), cases: results.length, passed: results.filter(item => item.passed).length, results };
await writeFile(resolve(repositoryRoot, output), JSON.stringify(result, null, 2));
await writeFile(resolve(repositoryRoot, logPath), results.map(item => `${item.passed ? "PASS" : "FAIL"} ${item.id}: expected ${item.expected}, got ${item.actual}`).join("\n"));
finishSuite(record, { status: result.passed === result.cases ? "PASS" : "FAIL", tests: result.cases, passed: result.passed,
  failed: result.cases - result.passed, skipped: 0, log_path: logPath,
  failures: results.filter(item => !item.passed).map(item => ({ name: item.id, message: `Expected ${item.expected}, got ${item.actual}` })) });
console.log(JSON.stringify({ ...result, results: results.filter(item => !item.passed), output }));
process.exitCode = result.passed === result.cases ? 0 : 1;
