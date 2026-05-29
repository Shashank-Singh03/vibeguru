# Architecture — Vibe Guru `memory.client` vector

**Status:** Accepted (v1 shipped & verified; 2-step CLI added)
**Date:** 2026-05-30
**Scope:** The frontend memory-leak vector and the CLI flow around it. The four-layer
model is shared by all future vectors; concrete details here are about `memory.client`.

---

## 1. What this vector does

Detect **frontend memory leaks** in a running SPA (React/Vue/Svelte/Next) and emit
**agent-readable findings** with **no LLM in the analysis loop** (zero API cost). It
answers: *which route/interaction leaks, what kind, how much, and how to fix it.*

Catches: DOM nodes retained after unmount, listeners/subscriptions never removed, JS
heap held in module-globals/stores, oversized initial heap.

---

## 2. System overview — the four-layer pipeline

Every vector is built as four **decoupled** layers, each an Elixir `behaviour` so new
vectors/analyzers/reporters (incl. paid-tier custom ones) drop in **without forking**.

```
            ┌───────────┐     ┌──────────────────┐     ┌────────────────┐     ┌───────────────┐
  URL +     │ Detector  │     │ Probe            │     │ Analyzer       │     │ Reporters     │
  project ─▶│ (no AI)   │────▶│ memory.client    │────▶│ memory         │────▶│ JSON          │
            │           │     │ (CDP harness)    │     │ (deterministic)│     │ Markdown      │
            └───────────┘     └──────────────────┘     └────────────────┘     │ CLAUDE.md     │
                 │                    │                       │               └───────────────┘
            StackProfile        [Evidence]               [Finding]                  files
```

- **Detector** → `%StackProfile{}` from `package.json` (structural, no code semantics).
- **Probe** → gathers raw `%Evidence{}` by driving a headless browser via CDP.
- **Analyzer** → turns evidence into `%Finding{}` via thresholds/ratios. **No LLM.**
- **Reporters** → render findings to JSON / human markdown / `CLAUDE.md`.

**Why the strict split:** Evidence is interpretation-free data; Findings are opinions.
Because they're separate, analysis re-runs on cached evidence for free, one evidence
stream can feed many analyzers, and a custom analyzer needs no re-run of the probe.

| Layer | Module(s) | Contract |
|---|---|---|
| Detector | `VibeGuru.Detector`, `…Detector.Stack`, `…Detector.Frontend` | `detect/2 → StackProfile` |
| Probe | `VibeGuru.Probes.Memory.Client` (+ `driver-node/`) | `VibeGuru.Probe`: `run/2 → {:ok,[Evidence]}` |
| Analyzer | `VibeGuru.Analyzers.Memory` | `VibeGuru.Analyzer`: `analyze/2 → {:ok,[Finding]}` |
| Reporter | `VibeGuru.Reporter.Json`, `…Reporter.Markdown` | `VibeGuru.Reporter`: `render/2` |
| Orchestrator | `VibeGuru.Pipeline` | wires the four layers |

---

## 3. The 2-step CLI flow (how a user runs it)

The whole experience is two commands, backed by small focused modules:

```
vibeguru init   →  CLI.Init  →  Project.detect + Config.save   →  vibeguru.json
vibeguru run    →  CLI.Run   →  ensure target → Pipeline → Presenter
```

| Module | Job |
|---|---|
| `VibeGuru.CLI` | 12-line dispatcher: `init` / `run` / `memory:client` → command module |
| `VibeGuru.CLI.Init` | detect + write `vibeguru.json` (CLI flags override detection) |
| `VibeGuru.CLI.Run` | load config → ensure target → run pipeline → present → halt code |
| `VibeGuru.CLI.Presenter` | all terminal output (summary, logs, errors, usage) in one place |
| `VibeGuru.Project` | dev command + port from `package.json` (parses `--port`, framework defaults) |
| `VibeGuru.Config` | load/save `vibeguru.json`; forward-compatible (unknown keys ignored) |
| `VibeGuru.DevServer` | start the dev server, wait for TCP-listen, tear the process tree down |

**`run` target resolution** (`CLI.Run.ensure_target/4`) returns a `stop` function so
teardown is symmetric with startup:

1. URL already reachable → use it, `stop` is a noop.
2. else `dev_command` present → `DevServer.start` it, `stop` kills it afterwards.
3. else → `:no_target` error with guidance.

CLI commands return `:ok | {:halt, code}`; `CLI.main/1` is the only place that calls
`System.halt`. Exit codes: **1** on high/critical findings (CI gate), **2** on run
error, **64** on usage error.

---

## 4. Our approach to measuring frontend memory

### 4.1 Why frontend needs its own harness
Frontend memory lives in the **browser tab**, not a server process, so we drive a real
headless Chrome (Playwright) and read memory through the **Chrome DevTools Protocol
(CDP)**. The stress axis is **interaction cycles**, not concurrency or wall-clock.

### 4.2 The harness (`driver-node/`)
```
baseline  → load app, settle, force GC, sample the clean floor
cycles    → per route: mount → unmount → FORCE GC → sample retained home state (tagged)
cooldown  → return home, force GC twice, final sample (recovery check)
```
Two load-bearing decisions (ADR-1, ADR-2):
1. **Client-side navigation only** — clicking the app's `<a>` links + history back. A
   `page.goto()` reload would reset the heap each navigation, so leaks would never
   accumulate and every app would falsely pass.
2. **Force GC before every sample** — measure *retained* memory, not transient garbage.
   Real leaks survive GC; framework churn doesn't. This is what makes per-route
   attribution trustworthy.

### 4.3 Two ways to drive the app
- **Auto-crawl (default):** `crawl.js` discovers same-origin route links and cycles them.
- **Recorded flow (advanced):** `run --flow file.js` replays a Playwright script each
  cycle; `mark("label")` attributes leaks to named steps.

---

## 5. What data we collect, and the data contract

### 5.1 Metrics (all from CDP / page APIs — deterministic)
| Metric | Source | Why |
|---|---|---|
| `nodes`, `documents`, `jsEventListeners` | CDP `Memory.getDOMCounters` | **gold metrics** for DOM/listener leaks |
| `heapUsed` / `heapTotal` / `heapLimit` | `performance.memory` (`--enable-precise-memory-info`) | heap retention & headroom |
| `canvases`, `webglContexts` | `page.evaluate` over `<canvas>` | coarse chart/WebGL-leak signal |
| GC control | CDP `HeapProfiler.collectGarbage` | retained-vs-transient separation |

### 5.2 The Evidence model
`%VibeGuru.Evidence{}` is one interpretation-free fact: `kind`
(`:sample│:snapshot│:profile│:config│:marker`), `phase`
(`:baseline│:cycle│:cooldown`), `cycle`, `timestamp`, `context` (e.g.
`%{"route"=>…}`), `data` (the metric map). A run emits one baseline sample,
`cycles × routes` cycle samples (each tagged with the route just exercised), one
cooldown sample, and a `:config` marker.

### 5.3 The Elixir↔Node contract: NDJSON
The Port boundary uses newline-delimited JSON on stdout (config goes in via a temp
`--config` file). One object per line:

```jsonc
{"type":"evidence","kind":"sample","phase":"cycle","cycle":2,
 "context":{"route":"/detached"},
 "data":{"heapUsed":…,"nodes":18062,"listeners":175,"documents":1,"canvases":0}}
{"type":"marker","kind":"config","data":{"routes":["/clean",…],"mode":"auto"}}
{"type":"log","phase":"cycle","message":"cycle 5/8 …"}
{"type":"result","ok":true,"cycles":8,"routeCount":5,"durationMs":…}
{"type":"error","message":"…"}        // exit 1 on failure
```

`VibeGuru.Probes.Memory.Client` reads these in a `receive` loop, buffers partial lines,
maps `evidence`/`marker` → `%Evidence{}` (whitelisted string→atom for `kind`/`phase` —
never `String.to_atom` on dynamic input), forwards `log` to an `on_log` callback, and
returns `{:ok, [Evidence]}` / `{:error, …}`.

---

## 6. How we check the data (the Analyzer)

`VibeGuru.Analyzers.Memory` is **100% deterministic**. Method:

1. **Diff chain:** `[baseline | cycle_samples]`; take consecutive deltas, attributed to
   the route tagged on the later sample. Clean route ≈ 0 retained/visit; leaky route =
   consistent positive delta.
2. **Drop the warm-up:** when `max_cycle ≥ 3`, cycle 1 is discarded (framework/HMR churn).
3. **Attribute per route × metric:** `avg`, `pos_frac` (consistency), `total`, `n`.
4. **Flag a leak** when `avg ≥ per_route_min` **and** `pos_frac ≥ consistency_min`.
5. **Overall health:** `recovery_ratio = (peak − cooldown) / (peak − baseline)`.

### Default thresholds (tunable via `config.thresholds`)
| Key | Default |
|---|---|
| `per_route_min_nodes` | 100 |
| `per_route_min_listeners` | 2 |
| `per_route_min_heap` | 150 000 |
| `consistency_min` | 0.6 |
| `recovery_leak` / `recovery_slow_hi` | 0.3 / 0.8 |
| `bundle_heap_bytes` | 80 000 000 |

### Signatures (v1 active)
`detached_dom_leak` (nodes) · `listener_leak` (listeners; Chart.js hint when a chart lib
is detected) · `route_heap_growth` (heap, excluding routes already flagged for nodes) ·
`initial_bundle_heap` (baseline heap) · `slow_recovery` (advisory). Deferred to v1.1
(never false-fired): `timer_leak`, precise `canvas_webgl_leak`, `allocation_hotspot`.

---

## 7. How we generate the report

Reporters consume the **same `[Finding]`** and write to `--out` (defaults to the project
root, so `CLAUDE.md` lands where the agent will read it):

| File | Reporter | Audience |
|---|---|---|
| `CLAUDE.md` | `Reporter.Markdown` | coding agent — ordered `ai_prompt` blocks |
| `vibeguru-report.md` | `Reporter.Markdown` | human |
| `vibeguru-findings.json` | `Reporter.Json` | machine |

`Pipeline` `mkdir_p`'s the output dir so reporters never silently fail. Each Finding
carries a **pre-templated** `ai_prompt` built from the signature + measured numbers (no
LLM): names signature, numbers, likely location, and fix.

---

## 8. Key architectural decisions (ADRs)

### ADR-1: Client-side navigation, never `page.goto()`
Full reload resets the heap → leaks never accumulate → all apps falsely pass. We click
the app's links + `history.back()`. Cost: depends on discoverable links (mitigated by
`--flow`).

### ADR-2: Force GC before every sample (measure *retained*, not *current*)
Raw listener/heap counters are dominated by transient framework garbage (observed
listener deltas swung +6 / −32 / +6). GC-before-sample makes per-route attribution clean.

### ADR-3: No LLM in the analysis loop
All detection is thresholds/statistics; LLM use is optional and downstream (the user
pipes `CLAUDE.md` into their agent). Zero API cost, reproducible.

### ADR-4: Evidence ⟂ Finding separation + behaviour-based layers
Four `behaviour`s; raw Evidence cached separately from Findings. New vectors = implement
the behaviour again; custom probes/reporters drop in without forking.

### ADR-5: NDJSON over a temp-file config across the Port
Elixir can't cleanly half-close a Port's stdin, so config goes via `--config <tempfile>`
and results stream as NDJSON on stdout (stderr kept separate so stdout stays pure JSON).

### ADR-6: Autostart the dev server without shell redirection
`DevServer` spawns the bare command (Windows `cmd /c` mishandles nested quotes in a
redirect) and **drains** the process output into a log file in-process. Readiness is a
dependency-free TCP probe across **all** resolved addresses (IPv4 *and* IPv6 — dev
servers often bind `localhost` to `::1` on Windows). Teardown kills the process *tree*
via the OS (`taskkill /T` / `pkill -P`), because closing the port alone orphans
grandchildren (npm → node → bundler).

---

## 9. Failure modes & handling
- No route links (auto-crawl) → warn, still produce a series; suggest `--flow`.
- Node / driver missing → `:node_not_found` / `{:driver_not_found, path}` with a hint.
- Dev server won't start / times out → error names the captured log path.
- Run too long → `--timeout` guard; Port closed cleanly.
- `performance.memory` unavailable → heap fields null; DOM-counter signatures still fire.
- Missing `--out` dir → `Pipeline` creates it (`mkdir_p`).

---

## 10. Extensibility (the revenue lever) & roadmap
Drop-in, no fork: **custom probe** (`VibeGuru.Probe`), **custom thresholds/scenario**
(`config.thresholds`), **custom reporter** (`VibeGuru.Reporter` → Jira/Slack/MCP).

**Next (v1.1):** heap-snapshot diff + allocation sampling + **source maps** to name the
exact component file; precise `canvas_webgl_leak`, `allocation_hotspot`, `timer_leak`.
**Distribution:** self-contained binaries (Burrito) + an `npx vibeguru` wrapper so end
users need no Elixir. **Fast-follow vector:** `memory.server` (RSS under load).

---

## 11. File map
```
lib/vibe_guru/
  probe.ex · analyzer.ex · reporter.ex        # behaviours (contracts)
  evidence.ex · finding.ex · stack_profile.ex # data structs
  detector.ex · detector/{stack,frontend}.ex  # structural detection
  probes/memory/client.ex                     # Port orchestration of the driver
  analyzers/memory.ex                         # signatures + recovery ratio
  reporters/{json,markdown}.ex                # artifacts incl. CLAUDE.md
  config.ex · project.ex · dev_server.ex      # 2-step support (config, detection, autostart)
  pipeline.ex                                  # wires the four layers
  cli.ex · cli/{init,run,presenter}.ex         # CLI dispatch + commands + output
driver-node/
  index.js                                    # NDJSON entry, config loading
  lib/{run,sampler,crawl,flow}.js             # phases, CDP sampling, crawl, flow replay
test-app/                                      # leaky React app + /clean control + flows/
```

## 12. Verification (2026-05-30)
8 cycles vs `test-app/`: `/detached`→`detached_dom_leak` (+9000 nodes/visit, recovery
0%), `/listeners`+`/charts`→`listener_leak`, `/grow`+`/charts`→`route_heap_growth`,
`/clean`→**0 findings**. Both `run` paths verified: reuse a running server, and
autostart + teardown when none is running (port free afterwards). Flow mode attributes
to `mark()` labels.
