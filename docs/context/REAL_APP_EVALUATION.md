# Real local applications and product readiness

**10 October subsequent evaluation:** The specifically requested
`Desktop/robot-programming-main` now has a separate fresh production build and
real isolated FastAPI/SQLite test setup, including normal signup/signin. Its
results and boundaries are in [ROBOT_MAIN_EVALUATION.md](ROBOT_MAIN_EVALUATION.md).
The earlier app/campaign counts and mocked-backend limitations below describe
their own runs; they do not describe this later robot-main integration.

Reviewed **10 October 2026, Asia/Calcutta**. The founder asked to skip auth bypass
and rate-limit traffic testing, inventory rate controls in code, and use real local
applications to collect useful evidence. Nothing is staged, committed, pushed or
published. Inventoried, nonexcluded original source files are unchanged; writable builds and test data
remain in ignored `reports/` directories.

## Decision

**Start supervised real-app evaluation now. Vibe Guru is not a finished general
application verifier.** It can run authored browser workflows, capture resource
and runtime evidence, retain declared outcomes, and display reproducible results.
That is useful alpha capability. It does not discover every workflow or business
rule, prove a backend correct, or automatically explain every threshold finding.

The next milestone is a useful repeatable workflow on existing applications,
including recorded setup effort, confirmed defects, rejected alerts and reruns.
Adding another purpose-built fixture alone is not that milestone. Treat each result
as scoped evidence; do not market case counts as product accuracy.

## Source-only rate-control inventory

The detailed review is [RATE_LIMIT_INVENTORY.md](RATE_LIMIT_INVENTORY.md).

| Application | Reviewed source result | What remains unknown |
|---|---|---|
| HTAD gateway | Redis token-bucket enforcement exists. Admin paths are exempt; missing policies and errors may allow requests. | Runtime enforcement, actual deployed configuration and capacity. |
| Swap-station | No request-frequency limiter found in reviewed backend/nginx code. | Separate production ingress or external controls. |
| Multiplayer | Payload limits and outbound cursor batching exist; no incoming request/message-frequency limiter found. | Capacity and external admission controls. |
| Vibe Guru | Rate-limit verification is not an implemented vector. | This manual inventory is not a dynamic test or automatic scanner. |

No load, rate-limit enforcement, auth-bypass or login test was run. Existing
swap-station UI setup uses the previously declared synthetic local role against
HTTP fixtures. It neither proves nor attacks server authentication.

## Fresh unchanged-source evaluation

Campaign **`campaign-1791608203042-3e4603ef`** reran the three existing founder
applications with the hardened engine. Their copied source bytes matched the
original inventoried source before testing. The previously built isolated artifacts
were reused and hashed; this was not a new clean install/build of those apps.

There were no seeded listener/heap leaks, injected JavaScript exceptions or
deliberately broken source modes. Response-order and reconnect cases deliberately
control transport timing to reproduce application behavior. The gateway race
adapter also disables every exact-10,000ms interval, including Logs polling, and
observes the displayed result over 400ms. It does not verify background polling.
Create API is a fixture-backed routing reproduction: `/admin/apis/new` receives
an explicit mocked 404, not a response from the live gateway backend.

| Workflow | Cycles | App verdict | Passed / failed assertions | Interpretation |
|---|---:|---|---:|---|
| Gateway navigation, short control | 6 | FAIL | 12 / 0 | Heap-growth threshold crossed; no declared UI assertion failed. |
| Gateway navigation, longer control | 24 | PASS | 48 / 0 | Growth slowed in this bounded run. |
| Swap-station navigation | 6 | INCONCLUSIVE | 12 / 0 | Required module-scoped chart constructor measurements unavailable. |
| Multiplayer delivery | 6 | PASS | 24 / 0 | Second client received name and reaction through the real local server. |
| Gateway refresh, ordered responses | 6 | PASS | 12 / 0 | Latest-refresh display contract held. |
| Gateway refresh, reordered responses | 6 | FAIL | 6 / 6 | Older result overwrote the latest refresh in every recorded cycle. |
| Gateway Create API navigation | 6 | FAIL | 0 / 6 | Existing route displayed API-not-found rather than a creation form. |
| Multiplayer disconnect/rejoin | 6 | PASS | 42 / 0 | Real server welcome, identity and visible roster converged under the bounded experiment. |

Totals: **8 cases, 66 attempted cycles, 4 PASS, 3 FAIL, 1 INCONCLUSIVE, 0 ERROR**;
**156 passing and 12 failing assertions**. All 8 declared experiment expectations
matched, including expected reproductions of known defects. This does not turn
the failing apps into passes or make the INCONCLUSIVE measurement complete.

The short gateway control measured **156,468 bytes per interval**, above the
unchanged 150,000 threshold. The 24-cycle control averaged **40,591 bytes** across
23 between-cycle intervals; its last five averaged **-354 bytes**. This reinforces
the earlier warm-up/bounded-retention question. It is not proof of a false positive
or a permanent leak. No thresholds or analyzer findings were suppressed.

All eight cases retained stable execution identities and `retentionInvalid=false`.
The eight incident graphs contain **513 unique-within-graph nodes, 547 resolving
edges and 66 structured experiment observations**. Graph edges retain relationships,
not causal proof. The portable [case table](real-app-evaluation-results.json) contains
actual verdicts, findings, scoped checks, measurement summaries and raw artifact
paths. Raw reports live under:

`reports/real-app-evaluation-1791608163661/campaign-1791608203042-3e4603ef/`

Reproduce with the saved prepared manifest:

```powershell
mix escript.build
node scripts/lab.mjs reports/real-app-evaluation-1791608163661/manifest.json
python scripts/desktop-prepare.py verify reports/desktop-evaluation-manifest.json
```

The manifest depends on ignored source copies and installed dependencies from the
earlier Desktop evaluation. It is a local reproduction, not a portable installation
promise. Every rerun creates a new campaign and is discovered by the dashboard.

## Fourth application: previously untested robot frontend

A fresh ignored copy of `Desktop/robot-programming-frontend-improvementsV1` was
installed with `npm ci --ignore-scripts` and built with Next 16.1.6 production
webpack compilation, TypeScript checks and static generation. The unchanged
source requires an API URL at import time, so the build explicitly uses an unused
dummy loopback URL; environment files and original dependencies were not copied.
This establishes one new setup/build result, not general Next.js support. An initial
ignored wrapper invocation failed on Windows absolute ESM import syntax before
starting any app process. The wrapper was corrected to use `pathToFileURL`; that
setup error is documented in its reproduction notes and excluded from app outcomes.

An authored public-only flow passed **6/6 cycles and 48/48 assertions**, retaining
48 structured observations. Checks cover the signed-out landing, DOM and stored
theme roundtrips, dialog opening, tab rendering, closing and restoration without
reloading the measured document. Zero API/external requests, WebSocket attempts
or form submissions were observed. No findings or validity gaps were reported.
The application's backend, login, AI generation, files, robot commands and hardware
remain untested; this is not evidence that its main product workflow works.

Execution, copied source, build and flow identities stayed unchanged. Exclusive
port preflight and the OS listener PID confirmed the actual loopback server was
the owned child. The server was stopped afterward. The graph contains **123 unique
nodes and 122 resolving edges**. Original inventoried source verification passed.

The completed capture was relocated within its owned ignored workspace into the
existing dashboard campaign layout; raw command records retain their original
capture paths. No result or verdict was changed. Campaign:
**`campaign-1791608605394-robot-public`**. See the portable
[robot public-UI results](robot-public-evaluation-results.json).

Retained setup, flow, wrapper and reproduction notes:
`reports/robot-real-evaluation-1791608219060/`. Rerun and register the new capture:

```powershell
node reports/robot-real-evaluation-1791608219060/run-evaluation.mjs
node reports/robot-real-evaluation-1791608219060/make-capsule.mjs
node reports/register-robot-evaluation.mjs
python reports/robot-real-evaluation-1791608219060/prepare.py verify
```

Combined fresh evidence: **4 founder-owned apps, 9 cases, 72 cycles, 5 PASS,
3 FAIL, 1 INCONCLUSIVE and 0 ERROR; 204 passing and 12 failing assertions**.
There are 114 structured observations and 636 graph nodes with 669 resolving
edges across the nine separate case graphs. Different apps and scopes make an
aggregate “success rate” misleading. These counts are recorded outcomes only.

## Verification and dashboard

`npm run check` passed formatting, compilation with warnings treated as errors,
**197 Elixir tests plus one doctest and 160 Node tests**. Those suite records match
the final source revision. Real Chromium dashboard QA passed against **218 saved
cases**, inspecting all nine new case details and forty-five artifact links.
It verified the real heap alert, unavailable-census result and labelled robot
public-only report, including preserved graphs and scope limits. The 390px view
fit without document overflow and no browser errors were recorded. Records and
screenshots are retained in `reports/real-dashboard-qa.json` and
`reports/real-dashboard-*.png`.

All original inventoried sources passed preservation checks. Only the dashboard
remains running; owned application servers were stopped. No rate/security vector
was added to the registry: it remains thirteen implemented and two planned vectors.
This iteration adds real-app evidence and source-review context, not new core
analysis behavior or an auth/rate-testing capability.

## Scope and remaining product work

Gateway and swap-station are real frontend code with controlled HTTP responses;
their actual backends, authentication, database writes and hardware were not tested.
Multiplayer used its real copied Node/WebSocket server and isolated browser clients.
Only the primary client receives the engine's resource instrumentation. These are
three founder-owned projects, not independent customer validations.

Prioritize the following before broad release:

1. **Repeatable onboarding:** reuse a team's existing workflow and legitimate test
   session with explicit backend/data requirements; measure the founder help needed.
2. **Useful signal calibration:** independently triage real findings, distinguish
   warm-up from sustained growth, and preserve unknown/missing measurements.
3. **Real integration evidence:** add agreed read/write outcomes using isolated
   test data, then exercise relevant existing state/recovery vectors on those apps.
4. **Distribution proof:** validate the exact native packages and supported platform
   matrix, beyond the earlier Windows escript/tarball smoke evidence.

Session expiry and sustained responsiveness remain planned. Auth/rate testing is
excluded from this evaluation; this document does not add either as a tested vector.
Jev, autonomous exploration/repair and general source-understanding remain proposed.
Further vectors should follow a reproducible real-app failure and a useful oracle.
