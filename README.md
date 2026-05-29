# Vibecheck

> Your AI wrote the code. Vibecheck tells it what it forgot.

Vibecheck attaches to any app, stress-tests it across quality/performance **vectors**,
and emits **AI-readable findings** (`CLAUDE.md`, JSON) that a coding agent
(Claude Code / Cursor) can act on directly — with **zero LLM cost** at analysis time.

This repo is the first vector built end-to-end: **`memory.client`** — frontend memory
leak detection for React/Vue/SPA apps.

## How it works

Four decoupled layers (each an Elixir `behaviour`, so vectors/analyzers/reporters drop
in without forking — the customization hook):

```
Detector → Probe (gathers Evidence) → Analyzer (Evidence → Findings) → Reporter
```

- **Detector** — structural stack detection from `package.json` (no AI).
- **Probe** (`memory.client`) — drives **headless Chrome via CDP** (Node/Playwright
  sidecar in `driver-node/`). It mounts+unmounts each route over many cycles and
  samples **retained** memory *after forced GC*, so per-route consecutive diffs cleanly
  attribute leaks. Navigation is **client-side only** (never a full reload) so leaks
  actually accumulate.
- **Analyzer** — deterministic signature recognition (thresholds, ratios). No LLM.
- **Reporters** — `CLAUDE.md` (agent-readable), `vibecheck-report.md` (human),
  `vibecheck-findings.json` (machine).

## Signatures (v1)

| Signature | What it catches |
|---|---|
| `detached_dom_leak` | DOM nodes retained per visit (e.g. nodes pushed to a global) |
| `listener_leak` | `addEventListener`/subscriptions never removed on unmount |
| `route_heap_growth` | JS heap retained per route visit (unbounded caches/stores) |
| `initial_bundle_heap` | huge baseline heap from eager imports |
| `slow_recovery` | partial recovery (advisory) |

_Next milestone (v1.1):_ heap-snapshot diff + allocation sampling + **source maps** to
name the exact component **file**, plus precise `canvas_webgl_leak` and
`allocation_hotspot`. (`timer_leak` too.)

## Usage

```bash
# one-time: install the browser driver
cd driver-node && npm install   # downloads Playwright Chromium

# build the CLI
mix deps.get && mix escript.build

# run against your running app
./vibecheck memory:client http://localhost:5173 --cycles 20 --root /path/to/app
```

Options: `--cycles N` · `--settle MS` · `--routes N` · `--flow FILE` (replay a recorded
Playwright flow instead of auto-crawl) · `--root DIR` · `--out DIR` · `--no-headless` ·
`--quiet`. Exits non-zero when high/critical findings exist (CI-friendly).

### Two ways to drive the app
- **Auto-crawl (default, zero-config):** discovers same-origin routes and cycles them.
- **Recorded flow (advanced):** `--flow my.flow.js` replays an app-specific interaction;
  call `mark("label")` inside the flow to attribute leaks to named steps.

## Repo layout

```
lib/vibecheck/            # Elixir: behaviours, structs, detector, probe, analyzer, reporters, CLI
driver-node/              # Node + Playwright + CDP browser-driver (the harness)
test-app/                 # deliberately-leaky React app for verification (+ /clean control)
test-app/flows/           # example recorded flows
```

## Verified

Against `test-app/` (8 cycles): `/detached`→`detached_dom_leak`, `/listeners`+`/charts`
→`listener_leak`, `/grow`+`/charts`→`route_heap_growth`, and `/clean`→**no findings**
(no false positive). See `driver-node/` for the NDJSON evidence protocol.
