# Vibe Guru

> Runtime and repeated-use checks with explicit journey outcomes, retained evidence and candidate comparisons.

Vibe Guru exercises an app in Chromium and applies deterministic checks to browser measurements and supplied journey assertions. It observes runtime failures, retained memory and live class instances in one session, then produces findings for developers and coding agents.

An experimental reliability lab adds controlled fault campaigns, overlapping-response and reconnect experiments, source-candidate comparisons and incident evidence graphs. Structured observations retain the response schedule and visible state supporting a failed assertion. The longer-term direction is adaptive investigation; Jev planning and automatic reproduction minimization are not implemented. Earlier commercial proposals remain dated hypotheses in the context documents.

- [Robot main evaluation with a real local backend](docs/context/ROBOT_MAIN_EVALUATION.md)
- [Earlier real-app evaluation and product readiness](docs/context/REAL_APP_EVALUATION.md)
- [Source-only rate-control inventory](docs/context/RATE_LIMIT_INVENTORY.md)
- [Actual Desktop evaluation and implementation](docs/context/DESKTOP_EVALUATION.md)
- [Response race, source candidate and reconnect evaluation](docs/context/NETWORK_EVALUATION.md)
- [Pending navigation, HTTP recovery, duplicate writes and evidence hardening](docs/context/ADVERSARIAL_EVALUATION.md)
- [Storage recovery, two-client conflicts and completion integrity](docs/context/STATE_RESILIENCE.md)
- [Reliability campaign protocol](benchmarks/README.md)
- [Product vision and planned Jev architecture](docs/context/NORTH_STAR.md)
- [Actual bundled-fixture sample report](examples/sample-report.html)
- [Project architecture and saved context](PROJECT_CONTEXT.md)
- [CLI and MCP installation steps](docs/GETTING_STARTED.md)
- [Optional metadata analytics and privacy](docs/TELEMETRY.md)
- [Local launch preparation and security boundaries](docs/context/LAUNCH_PREPARATION.md)

## Local development dashboard

Run `npm run dashboard` and open [the evidence console](http://127.0.0.1:4545).
It shows saved campaigns, failure details, assertions and evidence graphs, vector
coverage, source changes and recorded test suites. It refreshes as reports and code
change; backend edits restart the local server and frontend edits reload the page.
The Changes view also shows measured full-check duration, stage logs and median/p95
timings. Parent commands and nested suites are measured separately.

`npm test` and `mix test` save test history automatically. Use `npm run check` for
formatting, compilation and both suites. Adding a vector to `dashboard/vectors.json`
extends the coverage map; implementation notes live in `dashboard/activity.json`.
The dashboard does not automatically run tests after an edit. Earlier-source test
records remain marked stale. See [dashboard workflow](docs/context/DASHBOARD.md).

Run `mix escript.build` then `npm run lab:adversarial` to exercise thirty-six cases
on four isolated local fixture apps. The matrix checks pending navigation, real
HTTP failure/retry, duplicate writes, storage recovery and two-client lost updates.
Use `npm run lab:adversarial -- --suite state` for the sixteen storage/conflict cases.
It creates fresh ignored copies and updates the dashboard as cases complete.
These are authored vulnerable/corrected controls, not a real-world accuracy score.

## Current release status

This checkout prepares **0.2.0**, with report schema 2 and an inconclusive exit code. It has not been published by this change. The market review on 8 October 2026 found npm and GitHub releases at 0.1.0; that version does not represent this checkout. Use the source workflow below until the matching native release passes its package checks.

Native build targets are Windows x64, Linux x64, macOS x64 and macOS arm64. Build configuration is not evidence of working packaged support. The release workflow now requires native CLI/browser/MCP smoke tests on all four targets before publishing assets. [Release procedure and verification status](docs/RELEASING.md).

## What is checked

| Check | Measurements | Important boundary |
|---|---|---|
| `runtime.client` | Exceptions, console errors, failed requests/HTTP errors, DOM mutation rate | Mutation rate is a heuristic; route records may describe observation rather than event origin |
| `memory.client` | Post-GC heap, DOM nodes and listeners across repeated visits | Threshold-based retention signals require reproduction; they do not prove an exact cause |
| `census.client` | Retained instances of globally accessible constructors | Module-scoped classes may be unavailable; unknown is reported explicitly |
| `journey.client` | Explicit boolean outcome assertions supplied by the flow author | Checks only declared expectations; execution errors and skipped checks remain incomplete |

Bundled defect/clean fixtures and the dated evaluation of three copied Desktop apps provide the current verification evidence. Detection also recognizes other frameworks, but does not establish their browser-navigation compatibility. History fallback requires a visible view selector to verify the rendered route.

Investigation rules and focused heap snapshots remain separate from the standard pipeline. The snapshot summary is not a retainer-chain or source-map attribution engine. Vibe Guru does not establish backend capacity, security, business correctness or general release readiness.

## Run this checkout

Development needs Node 20+, Elixir 1.18 and Erlang. Native end-user packages, once validated and released, bundle the Erlang runtime.

```bash
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix driver-node
npx playwright install chromium
mix deps.get --check-locked
mix escript.build
escript vibeguru init --root /path/to/app
escript vibeguru run --root /path/to/app --out /path/to/reports
```

`init` detects the project and writes `vibeguru.json`. `run` reuses a reachable development server or starts the configured command, then stops any server it started.

To use the npm wrapper with the development escript in PowerShell:

```powershell
$env:VIBEGURU_BINARY = (Resolve-Path .\vibeguru).Path
node bin/vibeguru.js run --root C:\path\to\app
```

On macOS/Linux, set `VIBEGURU_BINARY` to the absolute escript path before invoking the wrapper. This override also works for native assets and the MCP server.

## Reports and verdicts

Each successful analysis writes:

- `vibeguru-findings.json`: schema 2, verdict, per-check validity, run conditions, uniquely identified evidence and finding references.
- `vibeguru-report.md`: scoped human report.
- `CLAUDE.md`: suggested investigations for a coding agent.
- `vibeguru-report.html`: standalone report with trends, evidence and local baseline comparison.

| Verdict | CLI exit | Meaning |
|---|---:|---|
| `PASS` | 0 | Required scoped measurements completed; no high/critical findings |
| `FAIL` | 1 | High/critical findings detected; measurement limits remain visible |
| `ERROR` | 2 | Execution or report writing failed |
| `INCONCLUSIVE` | 3 | Required measurements or interactions incomplete, without blocking findings |
| Usage error | 64 | Invalid command usage |

Medium/low/info findings are advisories. A blocking finding takes precedence over an incomplete check. Failed GC or a reset retained-state chain suppresses memory/census conclusions while valid runtime observations remain reportable.

A PASS means **No blocking issues detected within the tested scope**. It does not mean exact return to baseline or correct business behavior. Any skipped known route makes a finding-free auto survey inconclusive; unknown routes can still be absent from the coverage inventory. Unavailable census classes are explicit measurement limits.

Report schema 1 remains readable through MCP, but cannot establish a current PASS. Filtered findings retain the full-run verdict. Interrupted drivers, missing completion records and reporter failures are errors.

## Project configuration

```json
{
  "url": "http://localhost:5173",
  "dev_command": "npm run dev",
  "cycles": 4,
  "settle_ms": 400,
  "routes_limit": 10,
  "routeParams": { "id": "42" },
  "routeExpectations": { "/users/42": "[data-testid=users-detail]" },
  "censusTargets": ["MyGlobalClass"],
  "thresholds": { "per_route_min_nodes": 100 }
}
```

`routeExpectations` maps resolved paths to visible selectors, especially for routes reached through history fallback. This verifies a selected view element, not its business outcome. Custom census targets are added ahead of detected/universal targets, subject to the twelve-target cap. Thresholds use the documented analyzer names; unknown keys are ignored without creating atoms from arbitrary input.

CLI flags override config values for cycles, routes, settle time and flow. At least three cycles are required for a conclusive repeated-use check; four is the MCP default and twelve is the CLI default. Use `--timeout` for a total run deadline and `--quiet` to hide progress; validity remains present in every report.

Use `escript vibeguru auth --root /path/to/app` for headed sign-in and session reuse. Session files are live credentials, stored separately from reports. Use local/staging test accounts and agreed test data for client work.

Recorded flows are `.mjs` files exporting an async function. Required outcomes can
be declared explicitly:

```js
export const checks = ["report-visible"];

export default async (page, { cycle, mark, check }) => {
  await page.getByRole("link", { name: "Reports" }).click();
  await page.getByTestId("report-table").waitFor();
  check("report-visible", await page.getByTestId("report-table").isVisible(), "Report table remains visible");
  await page.getByRole("link", { name: "Home" }).click();
  await mark("reports-roundtrip");
};
```

Run with `--flow /absolute/path/journey.mjs`. A supplied boolean false produces a
blocking journey finding; a timeout or execution error leaves the interaction
incomplete. Every declared check must execute exactly once per cycle for PASS.
Every emitted check must belong to the declaration; unknown IDs are execution
errors and malformed persisted assertion records invalidate a clean scope.
Incomplete journeys suppress retention conclusions. An optional exported
`setup(page, { config })` runs before initial navigation for test accounts or fixtures.
Samples at marks include mutation windows and census records. Business outcomes
without explicit assertions remain unverified.

Experimental source-checkout [reliability campaigns](benchmarks/README.md) add
labelled fault injection, candidate comparisons and incident capsules with an
evidence graph. The [Desktop evaluation](docs/context/DESKTOP_EVALUATION.md)
records what was actually tested. These are fixed-plan experiments; Jev planning
and automatic reproduction reduction remain proposed capabilities.

## MCP

For this checkout, launch `node /absolute/path/to/vibecheck/bin/vibeguru.js mcp` with `VIBEGURU_BINARY` set to the built escript or validated native asset. After 0.2.0 is released, a client can use `npx -y vibeguru@0.2.0 mcp`.

The server exposes `verify_runtime` and `read_findings`. It uses the same engine, findings and verdict contract. Compact responses reduce report-reading overhead; this project makes no unverified token-saving comparison against current browser-agent tools.

Reports use a temporary directory unless `write_report` is enabled. Config-driven first runs can create `vibeguru.json`. Temporary reports are removed after being loaded; cached findings can be read again without another browser run.
Config-driven MCP calls require `allow_project_execution:true` before running a
project's server commands or full-privilege flow code. Supply an already-running
`url` to avoid config execution. See the installation guide for both modes.

## Verification

```bash
mix format --check-formatted
mix compile --warnings-as-errors
mix test
npm test
npm ci --ignore-scripts --prefix test-app
mix escript.build
npm run test:package -- --binary /absolute/path/to/vibeguru
```

The package smoke test installs the real npm tarball in an isolated directory, checks CLI exits 0/1/2/3/64, exercises intentionally broken and independent clean React fixtures, and checks the installed MCP server. Local escript results are distinguished from native Burrito results. Release CI uses `--require-native`.

[Repository architecture and context](PROJECT_CONTEXT.md) explain the current implementation. The original audit is a dated baseline; [implementation verification](docs/context/IMPLEMENTATION.md) records subsequent changes and remaining external validation.

## License

MIT. See [LICENSE](LICENSE).
