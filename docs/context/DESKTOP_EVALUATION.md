# Reliability lab implementation and Desktop evaluation

Date: **9 October 2026, Asia/Calcutta**. The founder authorized improving Vibe Guru
and testing Desktop projects, with **nothing committed to Git**. This is a local
implementation record, not a claim of customers, autonomous repair or market validation.

## Implemented in this iteration

| Capability | Actual behavior |
|---|---|
| Explicit journey outcomes | Flow modules can declare required check IDs and emit boolean assertions. A failed assertion becomes a blocking `journey.client` finding with evidence references. Missing/duplicate/invalid required checks prevent PASS. |
| Setup before navigation | An optional flow `setup` function configures test data, sessions or fixtures before the initial page load. Legacy flows remain usable. |
| Persisted execution outcomes | Successful and failed cycle outcomes, assertion records, conditions and browser/Node versions survive the driver protocol. Saved-report validation independently checks the required assertions. |
| Controlled campaigns | A source-checkout runner starts isolated builds and runs fresh browser contexts under normal, injected-fault, partial-removal, broken-functionality and interrupted conditions. |
| Candidate comparison | Compares finding identities while ignoring volatile measured magnitudes; preserves remaining and newly introduced findings. Candidate PASS is separate from symptom disappearance. |
| Incident capsules | Save build/lock/engine/flow identities, conditions, findings and observations, with graph edges connecting experiments, workflows, builds and evidence. No causal graph is claimed. |
| Investigation validity | Missing/flat/partial observations do not eliminate hypotheses. Ranked constructor summaries cannot establish object ownership, exact fixes or one shared cause for co-growing objects. Failed route visits, reloads and GC invalidate focused retention comparisons. |
| Cautious diagnosis text | Memory and census findings describe observed counters and suggest investigation. Signatures, thresholds, severities and numeric measurements were preserved. Aggregate counters no longer assert detached DOM, permanent leaks or confirmed view unmounts. |

The normal pipeline still uses deterministic analyzers. The separate investigation
loop is not connected to normal CLI/MCP runs. Jev, adaptive exploration, automatic
reproduction minimization, incident retrieval and autonomous source edits remain
planned capabilities. See [NORTH_STAR.md](NORTH_STAR.md).

## Projects and isolation

Only copies under ignored `reports/desktop-evaluation-20261009/` were installed,
built and served. Original dependencies, source, configuration and Git metadata were
not used as writable test workspaces. Environment/key files and symlinks were excluded.
This source inventory covers non-excluded files; it is not a complete filesystem backup.

| Project | Original Desktop source | Build and exercised scope |
|---|---|---|
| API gateway UI | `Desktop/proj/HTAD/ui` | React 18 / Vite / React Router. Normal TypeScript build fails; a separate transpile-only Vite build supplies the browser artifact. Logs → Metrics → APIs, with controlled HTTP fixtures and a rendered API row. |
| Swap-station frontend | `Desktop/proj/work/swapp_station/frontend-react` | React 19 / Vite / React Router. Normal build passes. Brokers ↔ Access Control, using empty HTTP fixtures and a synthetic local Super Admin role. No real backend, authorization, hardware, firmware or chart screen is exercised. |
| Multiplayer sync | `Desktop/proj/flam-multiplayer-sync` | Client and server builds pass. Two isolated browser clients use the copied real Node/WebSocket server. Name changes and reactions must reach the second client; connection and required content are also checked. Only the primary client receives memory/runtime instrumentation. |

Dependency installs used `--ignore-scripts`, with explicit build commands after
source inspection. Google Fonts CSS is replaced with an empty fixture, and other
external HTTP is blocked unless the adapter explicitly mocks it. Tests used local
ports 65310–65313. These conditions deliberately limit what integration conclusions
can be drawn.

The gateway's normal build errors are a real setup result: missing `ImportMeta.env`
typing in `src/api/client.ts`, plus unused `LineChart` and `Line` imports in
`MetricsDashboardPage.tsx`. Its transpile-only success does not make that check pass.

## Campaign protocol and score interpretation

The main campaign uses nine variants per app, six cycles per variant, fresh browser
contexts and a 200ms settle setting. Definitions and reproduction commands are in
[benchmarks/README.md](../../benchmarks/README.md).

There are **eight expected synthetic signals per app**, across six fault-bearing
variants: listener growth, heap growth, runtime exception, all three together, heap
growth remaining after partial removal, and an explicitly failed UI requirement.
That gives **24 expected signals across 18 fault-bearing cases**, within 27 total
cases. Missing/invalid reports count as failures to detect. Counts come from fresh
reports, not CLI exit alone.

These faults are deliberately strong: twelve retained listeners and an approximately
1.6MB retained array per cycle, plus a named exception. Successful detection does not
establish sensitivity to small leaks, real-world precision or general app correctness.
“Fixed” means the synthetic intervention was omitted, not that an application source
patch was generated or verified. Normal apps are not known-clean controls.

### Calibration retained for audit

- Initial smoke: a blocked Google font created a harness-induced request finding;
  the multiplayer adapter also expected `connected` instead of the app's actual
  `open` connection state. These runs are retained but excluded from detection scores.
- Corrected smoke: gateway and multiplayer passed their scoped checks; swap-station
  completed all outcomes but remained INCONCLUSIVE due unavailable chart census classes.
- First full campaign, `campaign-1791533381677-550b3e6e`: 27 cases, 24/24 expected
  signals detected, no execution errors, all three interrupted cases INCONCLUSIVE.
  The multiplayer hidden-heading locator failed after its first explicit failed
  assertion; it was corrected to address hidden content directly for repeat cycles.
- That first full campaign also produced an unseeded gateway heap alert of
  **151,057 bytes per measured interval**, just above the unchanged 150,000 threshold.
  It was preserved and drove cautious wording, rather than threshold tuning.

### Final results

Main campaign: **`campaign-1791533841508-8ed96020`**. Raw data:
[summary](../../reports/desktop-evaluation-20261009/campaign-1791533841508-8ed96020/summary.json),
[per-case results](../../reports/desktop-evaluation-20261009/campaign-1791533841508-8ed96020/results.json).

| Measure | Observed result |
|---|---|
| Browser cases | 27 across three copied projects |
| Expected injected signals detected | **24/24 (100% under these controlled conditions)** |
| Fault-bearing cases with all expected signals | **18/18** |
| Partial fault removal | Heap-growth finding remained in **3/3** apps |
| Required functionality deliberately hidden | Explicit journey finding in **3/3** apps, six failed assertions each |
| Interrupted cases | **3/3 INCONCLUSIVE**, none PASS |
| Execution/report errors | **0/27** |
| Baseline journey assertions | **48/48 passed** across the three apps |
| Incident graphs | **27** validated graphs, **1,274** edges, three distinct built artifacts |

Baseline journey completion and the overall verdict are deliberately separate:

| App | Baseline / synthetic-faults-omitted verdict | Why |
|---|---|---|
| Gateway | FAIL / PASS | Baseline heap average was 156,686 bytes per interval; the otherwise equivalent second control stayed below the unchanged threshold. |
| Swap-station | INCONCLUSIVE / INCONCLUSIVE | All declared outcomes complete; module-scoped Chart/ECharts census measurements unavailable. |
| Multiplayer | PASS / PASS | All 24 declared outcomes complete in each control, including real delivery to the second client. |

The run used **Node v24.0.0 and Chromium 153.0.8010.12 on Windows**. Cases preserve
individual build/lock hashes and conditions. After collection, the persisted outcome
validator was additionally hardened against missing/contradictory cycle results;
all **27 saved reports were reassessed with unchanged verdicts**. Follow-up runs use
the rebuilt engine and current outcome protocol. No detection threshold was tuned.

### Repeated and longer gateway controls

Across the first full campaign, main campaign and a dedicated repeat
(`campaign-1791534229579-23c63202`), there were **six unseeded six-cycle gateway
controls**. Three crossed the heap threshold and three did not. Their averages ranged
from **138,516 to 156,686 bytes per interval**. This is control-alert frequency,
**not a false-positive rate**: expected ownership and lifetime are not independently known.

Two fresh **24-cycle** controls
([`campaign-1791534262112-962e3a03`](../../reports/desktop-evaluation-20261009/campaign-1791534262112-962e3a03/summary.json))
both passed, with **48/48 assertions each**. Average heap deltas after cycle one
were approximately **39,840** and **37,280 bytes per interval**; the last five
intervals averaged **10,359** and **−6,767 bytes**. The measured growth slowed in
these longer runs. This supports investigating warm-up/bounded retention before
calling the short-window alert a permanent leak; it does not identify a cause or
establish that every future session remains bounded.

### Existing Create API navigation gap

A separate six-cycle reproduction, excluded from the injection score, produced
**six explicit failures** of `create-api-form`:
[`campaign-1791534334201-274939b4`](../../reports/desktop-evaluation-20261009/campaign-1791534334201-274939b4/gateway-create-baseline/vibeguru-report.md).
The copied source's Create API button navigates to `/apis/new`; `App.tsx` only
declares `/apis/:apiId`, which renders `ApiDetailPage` and requests API ID `new`.
With a controlled 404 for that ID, the browser displays **API not found** instead
of a creation form. Source routing and browser observation agree on this gap.

The [screenshot](../../reports/desktop-evaluation-20261009/campaign-1791534334201-274939b4/gateway-create-baseline/create-api.png)
and per-cycle observations are retained. This is a fixture-backed UI reproduction;
the actual gateway backend was not started or tested. No remediation was applied
to the original app.

## Verification and next decisions

Source verification: **191 Elixir tests plus one doctest**, **96 Node tests**, format
check and compile with warnings as errors passed. The agent additionally validated a
focused capture in real Chromium against an ephemeral SPA: three verified visits
retained three known objects with required GC and navigation validity confirmed.

A **fresh npm tarball installed on Windows x64 passed** CLI initialization, exits
0/1/2/3/64, defect and independent clean browser controls, MCP handshake/verification
and filtered-verdict preservation. This used the local rebuilt **escript**, not a
native Burrito release; other platforms/native packages remain unverified here.
An initial smoke attempt exposed npm stderr warnings being mixed into `npm pack`
JSON. The helper now parses stdout separately, preserves both streams in failure
diagnostics, and passed with an intentionally supplied warning-producing npm config.
Proof: [package smoke](../../reports/package-smoke-win32-x64.json).

Final checks confirmed **124 inventoried original source files unchanged**, an
empty Git staging area and HEAD still
`2f6429988a98b7ddc2833f9d312880b6fdd59353`. No commits or pushes were made.
All source/context edits remain uncommitted. Private copies and raw run artifacts
are ignored under `reports/`; the portable
[evaluation data](desktop-evaluation-results.json) preserves the aggregate results.

The next technical priority follows the evidence: add repeated/longer control
experiments and retaining-path inspection before escalating borderline growth; support
module-scoped library measurements without pretending missing classes equal zero;
and add controlled response-order, timeout/retry and reconnect experiments around
meaningful outcome assertions. Those experiments can later become supported actions
for Jev. A model planner should choose among measured experiments with a budget and
an auditable ledger, after the execution primitives are reliable.

Recommended next vectors, in implementation order:

1. **Request races and data freshness:** reorder controlled responses and assert the
   latest user selection owns the displayed result. The oracle needs actual expected
   data, beyond a visible table.
2. **Reconnect and convergence:** disconnect one multiplayer client, make agreed
   changes, reconnect it and compare required state across clients. Current delivery
   tests cover a perfect connection only.
3. **Retry/idempotency and partial failure:** verify an isolated test backend does not
   duplicate writes after agreed retries and that UI state recovers correctly.
4. **Permission/tenant boundaries:** use explicitly provisioned test identities and
   server assertions; local role injection and hidden frontend controls do not verify
   authorization.
5. **Long-session resource ownership:** extend controls and integrate retaining-path
   analysis where useful, before building a competing heap-analysis backend.

Reproduction entry point: [benchmarks/README.md](../../benchmarks/README.md).
Future chats should read this document, [PROJECT_CONTEXT.md](../../PROJECT_CONTEXT.md)
and the source relevant to their task. Private raw evidence stays under ignored
`reports/`; the dated findings and limitations here preserve the project context.
