# Experimental reliability campaigns

These source-checkout tools exercise repeated workflows, inject labelled faults in
disposable browser contexts, preserve evidence and compare observed outcomes. They
are a first implementation step toward the [reliability lab](../docs/context/NORTH_STAR.md).
The campaign plan is fixed. There is no implemented Jev/LLM planner, automatic
reproduction minimizer or proof of a root cause.

## Explicit journey outcomes

An `.mjs` flow can export an optional setup function and required assertion IDs:

```js
export const checks = ["report-visible"];

// Runs once before initial navigation. Use isolated test accounts/fixtures.
export async function setup(page, { config }) {
  page.setDefaultTimeout(5000);
}

export default async function flow(page, { cycle, check, observe, mark }) {
  await page.getByRole("link", { name: "Reports", exact: true }).click();
  const report = page.getByTestId("report-table");
  await report.waitFor();
  observe("report-state", { cycle, row_count: await report.locator("tbody tr").count() });
  check("report-visible", await report.isVisible(), "Report table remains visible");
  await mark("reports");
}
```

`check` requires an actual boolean. Explicit false emits a high-severity finding
and stops that cycle. A locator timeout or other execution exception remains an
incomplete interaction. Every declared ID must appear exactly once in every cycle;
otherwise the run cannot PASS. A known failed assertion takes precedence over
incomplete measurements. IDs must be unique within a cycle. Assertions are supplied
expectations, so their usefulness depends on the author selecting meaningful outcomes.
An unasserted business requirement remains unverified.

Every emitted assertion must also be declared in `checks`; unknown IDs and malformed
assertion records invalidate a clean scope. The driver rejects undeclared IDs.

`observe(id, data)` saves an `experiment_observation`: a JSON snapshot of controlled
inputs or visible state. IDs must be unique per cycle. Payloads must be plain JSON
objects, at most 64KiB and 20 nested levels; invalid values fail execution. An
observation alone does not create a finding or establish causation. Failed journey
findings link to observations from the same cycle and route, including cleanup
observations. The standalone HTML report exposes these retained records.

Setup, assertions, outcome records and measurement evidence survive the normal
JSON/Markdown/CLI/MCP path. `durationMs` in a journey result includes instrumentation
and forced GC at marks: it is not a user latency measurement. Existing flows without
setup/check declarations continue to work, with their earlier measurement scope.

## Preparing local projects

Create a private manifest under ignored `reports/`, using a new workspace:

```json
{
  "workspace": "C:/path/to/vibecheck/reports/local-evaluation-unique",
  "apps": [{
    "id": "gateway",
    "adapter": "gateway",
    "source": "C:/path/to/original/ui",
    "port": 65310
  }]
}
```

```powershell
python scripts/desktop-prepare.py prepare reports/local-manifest.json
# Install and build only the resulting snapshot. Review each app's commands first.
# Use --ignore-scripts for dependency installs; run required build steps explicitly.
mix escript.build
node scripts/lab.mjs reports/local-manifest.json baseline
node scripts/lab.mjs reports/local-manifest.json
python scripts/desktop-prepare.py verify reports/local-manifest.json
```

The bundled adapters target specific local apps; they are examples requiring
adaptation for other applications. Dependency installation/build is deliberately
separate from execution. The preparer excludes Git metadata, dependencies, build
outputs, symlinks, `.env*`, `.pem` and `.key` files. This is not a general secret
sanitizer: choose source roots thoughtfully and keep private snapshots/reports local.
Source inventories verify the copied, non-excluded originals remain unchanged.

## What the campaign evaluates

Each case uses a fresh browser, six cycles by default and the same built
application. An app manifest can set `cycles` from 3 through 30 for a longer
control; comparisons retain the cycle count:

| Variant | Deliberate intervention | Expected signal |
|---|---|---|
| `baseline` | No seeded fault | Unmodified-app observations; no assumed clean oracle |
| `listener-leak` | 12 retained window listeners per cycle | `listener_leak` |
| `heap-leak` | Retained 200,000-element array per cycle | `route_heap_growth` |
| `runtime-error` | Named uncaught asynchronous exception | `uncaught_exception` |
| `combined` | All three faults | All three signals |
| `partial-fixed` | Only retained array remains | Heap growth must remain visible |
| `invalid-fix` | No retention faults; hide required UI content | `journey_assertion_failed` |
| `fixed` | All synthetic faults omitted, content preserved | Observe remaining findings and measurement limits |
| `interrupted` | Throw before completing required assertions | Never PASS |

These “fix” variants remove synthetic browser interventions. They are **not source
patches** and do not demonstrate that Vibe Guru can autonomously repair an app.
Failed execution or structurally invalid reports count as missed expected signals.
Signals are matched against their signatures and marker/magnitude, not verdict alone.
Large retained arrays are a relatively easy detection case; this score does not
establish sensitivity for subtle leaks, real-world precision or market readiness.

The gateway adapter uses controlled HTTP data. Swap-station uses empty API fixtures
and a local synthetic role; no backend, authorization guarantee, chart lifecycle,
firmware or physical device operation is evaluated. External HTTP is blocked except
explicit fixtures; Google Fonts CSS has an empty local substitute. Multiplayer uses
the copied real local server and two isolated clients; name and reaction delivery are
checked, with memory/runtime instrumentation on the primary client only.

`gateway-create.mjs` is a separate, source-supported functional reproduction of the
Create API navigation gap with a controlled missing-ID response. It is excluded
from the injection detection score. Its backend outcome is conditional on that fixture.

## Response races and reconnect recovery

Two additional app-specific adapters test behavior beyond resource counters:

| Adapter / variant | Condition and expected outcome |
|---|---|
| `gateway-race` / `race-ordered` | Hold both manual Logs refresh requests, then release older before newer; newer results remain visible. |
| `gateway-race` / `race-reordered` | Hold the same two requests, then release newer before older; assert newer results remain visible for 400ms after both responses finish. |
| `gateway-race` / `interrupted` | Stop before releasing the older response and before the final assertion; cleanup drains held requests, but the run cannot PASS. |
| `multiplayer-reconnect` / `baseline` or `fixed` | Disconnect a real socket, change the isolated peer's name, observe the server's current rejoin snapshot, and require both visible rosters to converge within 2000ms. |
| `multiplayer-reconnect` / `reconnect-broken` | Suppress the server's welcome frame only on the browser transport after rejoining. The socket opens and the server snapshot is current, but the UI retains stale state. |

The gateway race uses controlled HTTP responses and disables **every interval with
delay exactly 10000ms**, including its Logs background poll. Both response orders
keep requests overlapping; missing arrivals or response-completion errors remain
execution failures. The 400ms trace is a bounded observation, not indefinite state
stability. The multiplayer experiment uses the actual copied Node/WebSocket server;
its negative case is an injected transport fault, not a discovered application bug.
`fixed` restores ordinary transport, without editing multiplayer source. Negative
case cleanup must restore convergence before the next cycle; restoration failure
preserves the app assertion and also fails the experiment's execution contract.

An app manifest can select variants and declare expected assertion outcomes:

```json
{
  "id": "gateway-race-original",
  "adapter": "gateway-race",
  "port": 65321,
  "variants": ["race-ordered", "race-reordered"],
  "expectations": {
    "race-ordered": { "failures": [] },
    "race-reordered": { "failures": ["latest-refresh-wins"] }
  }
}
```

Retain the prepared `snapshot`, `source` and `source_hashes` fields too. Omit the CLI
variant argument to use each app's matrix. A second prepared app can set
`compare_with` to the original app ID; the runner compares matching variants. Keep
build artifacts, dependency locks, workflow and conditions comparable when testing
a source patch. Current copied-source hashes distinguish candidate edits from the
unchanged original inventory.

Expected-outcome scoring is separate from the synthetic signal score. It requires
every declared check exactly once per cycle with the declared status, matching
cycle execution records and counts. An expected failed assertion must produce a
`JourneyAssertionError`; a timeout, cleanup error or missing report cannot count as
a successful negative experiment. With fail-fast checks, place the expected failing
assertion last so all prerequisites remain observable. A matched negative outcome
still gives the application a FAIL verdict. No declared expectation is inferred.

## Saved evidence and comparisons

Every fresh campaign saves `results.json`, `summary.json`, execution logs, ordinary
reports and per-case `incident-capsule.json`. Capsules include build artifact and
dependency-lock hashes, source inventory identity, engine identity, adapter/helper
hashes, browser/Node versions where available, conditions, observations and finding
references. The graph connects experiments, builds, workflows, observations and
findings. It does not claim causal edges.

The capsule also hashes the external Node driver, response-order gate, campaign
runner and assessor. The binary hash alone cannot identify these checkout files.

Comparison fingerprints ignore volatile measured magnitudes but preserve vector,
signature, labelled route and assertion/error identity. `removed`, `remaining` and
`introduced` are observed differences. Basic run comparability and candidate PASS
are separate fields; neither proves a general fix. Comparable builds, backend data,
timing, adjacent workflows and independently reviewed expectations still matter.
The saved experiment is reproducible input, not bit-for-bit deterministic execution.

Read the dated [Desktop evaluation](../docs/context/DESKTOP_EVALUATION.md) for actual
results, calibration problems, retained control alerts and remaining limitations.
The follow-up [network evaluation](../docs/context/NETWORK_EVALUATION.md) records
an existing gateway race, a source candidate comparison and reconnect experiments.

## Bundled adversarial apps

`mix escript.build` followed by `npm run lab:adversarial` prepares ignored copies
of four dependency-free local apps and runs thirty-six declared cases: pending
navigation, HTTP 503/partial-body disconnect/malformed JSON recovery, rapid double
submits and acknowledged retries against an authoritative order ledger. Selectors
and expectations live in `benchmarks/lab/`; no app-specific selector was added to
the engine. The matrix includes vulnerable/corrected modes, neighboring controls
and deliberate interruptions. Corrected modes are authored benchmark variants,
not automatic source repairs. Read [ADVERSARIAL_EVALUATION.md](../docs/context/ADVERSARIAL_EVALUATION.md).

The additional sixteen cases exercise cold-start draft corruption, key-scoped
storage exceptions, honest unsaved state, explicit retry and two-client stale
document writes with version checks and distinct-field reconciliation. Run only
these with `npm run lab:adversarial -- --suite state`. Primary documents stay
loaded; cold storage loads use iframes and the second editing client uses a
separate browser context. See [STATE_RESILIENCE.md](../docs/context/STATE_RESILIENCE.md).

Prepared manifest entries use `runtime: "node-fixture"`, `adapter_group: "lab"`
and an explicit `url_path` such as `/?mode=fixed`. The runner starts inventoried
`server.mjs` directly. Runtime source is its artifact; dependency lock absence is
explicitly retained. Each case checks execution identity before/after and refuses
to score changed source as a successful experiment.

`node scripts/adversarial-reports.mjs <clean-report.json>` runs a separate
thirty-three-case evidence-corruption benchmark and saves suite history. Raw observed
blocking runtime failures cannot be hidden by deleting their analyzed findings.
Misplaced journey completions and success records containing execution errors
cannot establish a clean result or a matched campaign expectation.
Flow completion cannot be bypassed by deleting its protocol marker as well as
its records. Bundled Node servers require an exclusive port preflight and their
own per-run listen handshake before HTTP readiness; capsules retain that proof.
