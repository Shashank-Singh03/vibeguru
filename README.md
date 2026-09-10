# Vibe Guru

> Your AI wrote the code. Vibe Guru tells it what it forgot.

Vibe Guru attaches to any app, stress-tests it across quality/performance **vectors**,
and emits **AI-readable findings** (`CLAUDE.md`, JSON) that a coding agent
(Claude Code / Cursor) can act on directly — with **zero LLM cost** at analysis time.

Two things it checks today, in one browser run:

- **`runtime.client`** — did the app actually *work*? Uncaught exceptions, console
  errors, failed requests, and runaway re-renders.
- **`memory.client`** — what did it *retain*? Frontend memory leaks in React/Vue/SPA apps.

## Use it from a coding agent (MCP)

The reason this exists. Your agent can read your code but cannot watch it run — so it
writes a change, the tests pass, and nobody finds out the page throws on mount until a
person opens it. Point the agent here and it can check its own work.

```json
{
  "mcpServers": {
    "vibeguru": { "command": "npx", "args": ["-y", "vibeguru", "mcp"] }
  }
}
```

That goes in your MCP client's config — `.mcp.json` for Claude Code, or the equivalent
for Cursor / Windsurf. Two tools show up:

| Tool | What it does |
|---|---|
| `verify_runtime` | Runs the app in a real browser and returns measured findings with a fix for each. ~1 minute. |
| `read_findings` | Re-reads the last run without repeating it — filter by severity or route. Free. |

A typical verification of a nine-route app returns **around 1,200 tokens**. Driving the
same browser through a generic automation server costs an agent roughly
[114,000](https://www.ytyng.com/en/blog/ai-browser-automation-tools-comparison-2026),
because it has to look at the page and reason about what it sees. Here the looking and
the reasoning already happened, deterministically, before the agent was handed anything.

Verification leaves nothing behind in your repo by default — reports go to a temp
directory unless you ask for `write_report`.

## Quick start (2 steps)

No toolchain required — just Node. From your app's project directory:

```bash
npx vibeguru init     # 1. detect your stack + dev command, write vibeguru.json
npx vibeguru run      # 2. start the app if needed, analyze it, write CLAUDE.md
```

`npx` pulls a self-contained binary for your OS (no Erlang/Elixir to install) and
auto-fetches Chromium on first use. Prefer a global install? `npm i -g vibeguru`, then
drop the `npx` prefix:

```bash
vibeguru init
vibeguru run
```

`run` reuses your dev server if it's already up, otherwise it starts it
(`npm run dev`), waits until it's ready, analyzes, and shuts it back down. Then it
drops three files in your repo:

- **`CLAUDE.md`** — hand this to your coding agent; it fixes the issues directly.
- `vibeguru-report.md` — human-readable.
- `vibeguru-findings.json` — machine-readable.

It exits non-zero when high/critical issues exist, so it works in CI too.

## How much of your app it actually saw

A crawler only finds what the landing page links to. On a real app that is a small,
unrepresentative slice — anything behind a login, behind a collapsed menu, or two
clicks in simply does not exist as far as crawling is concerned.

The dangerous part was not the missed routes. It was that a run could not tell
**clean** from **blind**: reaching 3 of 19 routes and finding nothing printed the same
confident "no issues found" as reaching all 19.

So Vibe Guru reads routes from the app's own source, and every run reports what it
reached:

```
Exercised 4 of 19 routes (21%).
  · 12 routes redirected to a sign-in page — the app needs authentication to reach them
  · 3 routes take a dynamic segment with no value configured. Set `routeParams` in vibeguru.json
```

Routes come from the framework, not from guesswork — `app/**/page.tsx` for Next,
`src/routes/**` for SvelteKit, `pages/**` for Nuxt, and `<Route path>` /
`createBrowserRouter` for React Router and Vue Router. Routes with no clickable link
are reached by pushing history state, so they are exercised client-side without the
full reload that would reset the heap.

Dynamic segments are **not** guessed. Visiting `/users/[id]` with an invented id
renders an error page, and reporting that as healthy is worse than admitting the gap —
so they count as uncovered until you supply values:

```json
{ "routeParams": { "id": "1", "slug": "example" } }
```

When coverage is low, a clean result is reported as **inconclusive** rather than a
pass. That matters most for the MCP path: an agent told `PASS` after a tenth of the app
was reached will report work as verified that was never looked at.

### Getting past a login

Most of an app worth testing sits behind a sign-in, and coverage reporting only makes
that *visible* — it does not get you in. `vibeguru auth` does:

```bash
vibeguru auth      # opens a real browser; sign in as you normally would, then close it
vibeguru run       # now reaches everything behind the login
```

Your password is never asked for, typed, stored, or transmitted by this tool. You
authenticate directly with your own app; what gets kept is the resulting session
(cookies + localStorage), written to `.vibeguru/auth.json`.

**That file is equivalent to being logged in.** The directory ships with its own
`.gitignore` containing `*`, so it cannot be committed even in a repo whose ignore
rules you never touch. Delete the file to sign out.

## What it catches

**Runtime** — the app broke while it ran:

| Signature | What it catches |
|---|---|
| `uncaught_exception` | a throw that reached `window.onerror` — the white-screen class of failure |
| `render_loop` | a component re-rendering forever (unguarded `useEffect` setting its own state) |
| `failed_request` | a request that never completed, or answered 5xx |
| `console_error` | an error the app logged and swallowed |
| `http_error` | a 4xx — usually a wrong path or an endpoint that was never built |

**Memory** — the app retained what it should have released:

| Signature | What it catches |
|---|---|
| `detached_dom_leak` | DOM nodes retained per visit (e.g. nodes pushed to a global) |
| `listener_leak` | `addEventListener`/subscriptions never removed on unmount |
| `route_heap_growth` | JS heap retained per route visit (unbounded caches/stores) |
| `initial_bundle_heap` | huge baseline heap from eager imports |
| `slow_recovery` | partial recovery (advisory) |

One defect is reported once. When React logs "Maximum update depth exceeded" on a
route already flagged as a render loop, or Chrome logs "Failed to load resource" for
a request already reported as failed, the weaker echo is dropped rather than sent to
an agent as a second bug to chase.

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
- **Observer** — rides along on that same browser session, recording what the app
  throws, logs, requests, and how hard it churns the DOM. No extra navigation.
- **Analyzer** — deterministic signature recognition (thresholds, ratios). No LLM.
  Every analyzer sees the same evidence, so adding a check costs no extra browser time.
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
vibeguru run  [--root DIR] [--out DIR] [--cycles N] [--routes N] [--flow FILE] [--no-headless] [--quiet]
vibeguru memory:client <url> [--cycles N] [--flow FILE] [--out DIR]   # low-level, no autostart
vibeguru mcp                                                          # MCP server on stdio
```

## Building from source (contributors)

End users get prebuilt binaries via `npx` (see Quick start). To build the engine
locally you need Elixir 1.18+ and Node 18+:

```bash
cd driver-node && npm install   # downloads Playwright Chromium (~150 MB), one time
cd .. && npm install            # MCP server deps
mix deps.get && mix escript.build
./vibeguru init --root /path/to/app
./vibeguru run  --root /path/to/app
```

Tests are `mix test` (analyzers) and `npm test` (MCP server + rendering). To run the
MCP server against a locally built binary instead of a published release, set
`VIBEGURU_BINARY` to its path.

### How the `npx` distribution is built

- **Self-contained binaries** come from [Burrito](https://github.com/burrito-elixir/burrito)
  (`mix release`), which bundles the BEAM + ERTS so users need no Erlang/Elixir. Targets
  are defined in [`mix.exs`](mix.exs); CI cross-compiles one per OS in
  [`.github/workflows/release.yml`](.github/workflows/release.yml) and attaches them to a
  GitHub Release.
- **The `npx vibeguru` wrapper** ([`package.json`](package.json), [`bin/`](bin/),
  [`scripts/`](scripts/)) is a thin Node shim: it downloads the binary matching the host
  from the Release, ensures Chromium, bundles `driver-node/`, points the binary at it via
  `VIBEGURU_DRIVER_PATH`, and forwards argv.

**Cutting a release:** bump the version in `package.json` *and* `mix.exs`, push a matching
`v<version>` tag (CI builds + publishes the binaries), then `npm publish`.

## Repo layout

```
lib/vibe_guru/            # Elixir: behaviours, structs, detector, probe, analyzer,
                          #   reporters, config, project/dev-server, CLI
driver-node/              # Node + Playwright + CDP browser-driver (the harness)
mcp/                      # MCP server: engine (drives the binary) + render (agent-facing text)
bin/ · scripts/           # npx wrapper: launcher + install (binary fetch, Chromium)
test-node/                # Node tests: rendering + a real MCP handshake over stdio
package.json              # the published `vibeguru` npm package
.github/workflows/        # release.yml — Burrito cross-build + GitHub Release
test-app/                 # deliberately-leaky React app for verification (+ /clean control)
test-app/flows/           # example recorded flows
docs/                     # architecture
```

## Verified

`test-app/` is deliberately broken, one signature per route, with `/clean` as the
control. A run must reproduce exactly this:

| Route | Expected |
|---|---|
| `/detached` | `detached_dom_leak` |
| `/listeners`, `/charts` | `listener_leak` |
| `/grow`, `/charts` | `route_heap_growth` |
| `/crash` | `uncaught_exception` |
| `/render-loop` | `render_loop` (and *only* that — the React warning is deduplicated) |
| `/log-error` | `console_error` |
| `/bad-fetch` | `failed_request` (and only that) |
| `/clean` | **nothing** |

The analyzers are unit-tested against synthetic evidence chains covering each
signature, the thresholds, the warm-up exclusion, and the no-false-positive cases —
so a regression fails `mix test` without needing a browser. Both `run` paths are
verified too: reuse a running server, and autostart + teardown when none is running.
