# Vibe Guru

> Your AI wrote the code. Vibe Guru tells it what it forgot.

Vibe Guru attaches to any app, stress-tests it across quality/performance **vectors**,
and emits **AI-readable findings** (`CLAUDE.md`, JSON) that a coding agent
(Claude Code / Cursor) can act on directly — with **zero LLM cost** at analysis time.

The first vector, shipped and verified, is **`memory.client`** — frontend memory-leak
detection for React/Vue/SPA apps.

## Quick start (2 steps)

From your app's project directory:

```bash
vibeguru init     # 1. detect your stack + dev command, write vibeguru.json
vibeguru run      # 2. start the app if needed, analyze it, write CLAUDE.md
```

`run` reuses your dev server if it's already up, otherwise it starts it
(`npm run dev`), waits until it's ready, analyzes, and shuts it back down. Then it
drops three files in your repo:

- **`CLAUDE.md`** — hand this to your coding agent; it fixes the issues directly.
- `vibeguru-report.md` — human-readable.
- `vibeguru-findings.json` — machine-readable.

It exits non-zero when high/critical issues exist, so it works in CI too.

## What it catches (v1 signatures)

| Signature | What it catches |
|---|---|
| `detached_dom_leak` | DOM nodes retained per visit (e.g. nodes pushed to a global) |
| `listener_leak` | `addEventListener`/subscriptions never removed on unmount |
| `route_heap_growth` | JS heap retained per route visit (unbounded caches/stores) |
| `initial_bundle_heap` | huge baseline heap from eager imports |
| `slow_recovery` | partial recovery (advisory) |

_Next milestone (v1.1):_ heap-snapshot diff + allocation sampling + **source maps** to
name the exact component **file**, plus precise `canvas_webgl_leak`, `allocation_hotspot`
and `timer_leak`.

## How it works

Four decoupled layers, each an Elixir `behaviour` so vectors/analyzers/reporters/clients
drop in **without forking** (the open-source-to-paid customization hook):

```
Detector → Probe (gathers Evidence) → Analyzer (Evidence → Findings) → Reporter
```

- **Detector** — structural stack detection from `package.json` (no AI).
- **Probe** (`memory.client`) — drives **headless Chrome via CDP** (Node/Playwright
  sidecar in `driver-node/`). It mounts+unmounts each route over many cycles and samples
  **retained** memory *after forced GC*, so per-route diffs cleanly attribute leaks.
  Navigation is **client-side only** (never a full reload) so leaks actually accumulate.
- **Analyzer** — deterministic signature recognition (thresholds, ratios). No LLM.
- **Reporters** — `CLAUDE.md`, `vibeguru-report.md`, `vibeguru-findings.json`.

See [`docs/ARCHITECTURE-memory-client.md`](docs/ARCHITECTURE-memory-client.md) for the
full design.

## Two ways to drive the app

- **Auto-crawl (default, zero-config):** discovers same-origin routes and cycles them.
- **Recorded flow (advanced):** `vibeguru run --flow my.flow.js` replays an
  app-specific interaction; call `mark("label")` inside the flow to attribute leaks to
  named steps.

## CLI

```
vibeguru init [--root DIR] [--url URL] [--port N]
vibeguru run  [--root DIR] [--out DIR] [--cycles N] [--flow FILE] [--no-headless] [--quiet]
vibeguru memory:client <url> [--cycles N] [--flow FILE] [--out DIR]   # low-level, no autostart
```

## Building from source (contributors)

End users will get prebuilt binaries via `npx` (packaging is on the roadmap). To build
the engine locally you need Elixir 1.18+ and Node 18+:

```bash
cd driver-node && npm install   # downloads Playwright Chromium (~150 MB), one time
cd .. && mix deps.get && mix escript.build
./vibeguru init --root /path/to/app
./vibeguru run  --root /path/to/app
```

## Repo layout

```
lib/vibe_guru/            # Elixir: behaviours, structs, detector, probe, analyzer,
                          #   reporters, config, project/dev-server, CLI
driver-node/              # Node + Playwright + CDP browser-driver (the harness)
test-app/                 # deliberately-leaky React app for verification (+ /clean control)
test-app/flows/           # example recorded flows
docs/                     # architecture
```

## Verified

Against `test-app/`: `/detached`→`detached_dom_leak`, `/listeners`+`/charts`→
`listener_leak`, `/grow`+`/charts`→`route_heap_growth`, and `/clean`→**no findings**
(no false positive). Both `run` paths verified: reuse a running server, and
autostart + teardown when none is running.
