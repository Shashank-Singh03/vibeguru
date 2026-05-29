#!/usr/bin/env node
// index.js — entry point for the Vibecheck browser-driver.
//
// Protocol (kept dead-simple so the Elixir side is trivial to implement):
//   * Config IN  : a JSON object on stdin (preferred), or a bare URL as argv[2].
//   * Events OUT : newline-delimited JSON (NDJSON) on stdout, one object per line:
//        { "type": "evidence", kind, phase, cycle, timestamp, context, data }
//        { "type": "marker",   kind, data }
//        { "type": "log",      message, phase?, level? }
//        { "type": "result",   ok, url, cycles, routeCount, durationMs }
//        { "type": "error",    message }
//   * Exit code  : 0 on success, 1 on failure.

import { readFile } from "node:fs/promises";
import { run } from "./lib/run.js";

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function argFlag(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) return resolve("");
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    // Guard: if nothing arrives quickly and there's no piped input, don't hang.
    setTimeout(() => resolve(data), 250).unref?.();
  });
}

function withDefaults(cfg) {
  const out = {
    url: cfg.url,
    mode: cfg.mode || "auto", // "auto" | "flow"
    cycles: Number.isInteger(cfg.cycles) ? cfg.cycles : 20,
    settleMs: Number.isInteger(cfg.settleMs) ? cfg.settleMs : 500,
    routesLimit: Number.isInteger(cfg.routesLimit) ? cfg.routesLimit : 8,
    headless: cfg.headless !== false,
    flow: cfg.flow || null,
  };
  if (!out.url) throw new Error("config.url is required (pass JSON on stdin or a URL as the first argument)");
  return out;
}

async function loadRawConfig() {
  // Priority: --config <file>  >  stdin JSON  >  bare URL as first positional arg.
  const configPath = argFlag("--config");
  if (configPath) {
    const text = await readFile(configPath, "utf8");
    return JSON.parse(text);
  }
  const raw = await readStdin();
  if (raw.trim()) return JSON.parse(raw);
  const firstPositional = process.argv.slice(2).find((a) => !a.startsWith("--"));
  return firstPositional ? { url: firstPositional } : {};
}

async function main() {
  let cfg;
  try {
    cfg = withDefaults(await loadRawConfig());
  } catch (e) {
    emit({ type: "error", message: `config error: ${e.message}` });
    process.exit(1);
    return;
  }

  try {
    const result = await run(cfg, emit);
    emit({ type: "result", ...result });
    process.exit(0);
  } catch (e) {
    emit({ type: "error", message: String((e && e.stack) || e) });
    process.exit(1);
  }
}

main();
