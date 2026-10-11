# Robot main: real local backend evaluation

10 October 2026, Asia/Calcutta. Requested source:
`C:/Users/Shashank/Desktop/robot-programming-main`.
This is distinct from the earlier `improvementsV1` public-only frontend test.
Nothing is staged, committed, pushed or published. Original inventoried source
stays unchanged; builds, generated credentials, database and evidence live in the
ignored `reports/robot-main-evaluation-1791611919310/` workspace.

## Setup and scope

The sanitized copy excludes `.env*`, keys, source Git state, existing dependencies,
builds, databases and runtime/upload/output directories. Its manifest inventories
1,598 source files. A fresh frontend `npm ci --ignore-scripts` and unchanged
`npm run build` succeeded, including TypeScript and Next 16.1.6 static generation.
No font substitution or application source patch was needed. Dependency advisories
in the installation log are an inventory, not a confirmed exploit assessment.

Pinned backend requirements installed in a fresh Python 3.12 virtual environment;
`pip check` passed. Uvicorn ran on loopback port 65343 with explicitly isolated
SQLite, uploads, outputs and runtime stores. Next production served port 65342.
Both listeners were checked against owned process IDs. Fresh state initially held
zero users, projects, jobs, uploads and outputs, with no AI provider configured.

The normal UI created the first administrator through the backend's explicitly
enabled fresh-install bootstrap, then signed in with a disposable test identity.
Later browser sessions also used normal UI signin. Tokens were never injected;
no live credentials or Desktop database were used. Reports retain HTTP paths and
statuses, without authentication bodies, passwords or tokens.

Vibe Guru ran authored workflows using its actual `memory:client` CLI, Chromium,
runtime observer, post-GC samples and declared outcome assertions:

- Projects: real authenticated list, search, filter selection, clear and refresh.
- Configuration: required inputs, bundled PDF selection and preview lifecycle,
  draft back navigation, dependent robot fields, literal text preview and removal,
  and draft discard on returning to the dashboard.
- Missing provider: a valid local upload reaches the real backend and receives its
  genuine 503; check the error, usable form, return to projects and absent jobs.

External HTTP, unexpected mutations and all WebSockets are blocked and counted.
Responses are never replaced with synthetic successes. No inference provider,
robot/hardware operation, auth bypass, load or rate-enforcement test ran.

## Results

| Workflow / attempt | Cycles completed / planned | Verdict | Passed / failed / unverified assertions |
|---|---:|---|---:|
| configuration | 6 / 6 | FAIL | 84 / 0 / 0 |
| missing-provider | 6 / 6 | FAIL | 42 / 0 / 0 |
| projects (initial locator mismatch) | 0 / 6 | INCONCLUSIVE | 12 / 0 / 48 |
| configuration-long | 12 / 12 | FAIL | 168 / 0 / 0 |
| projects | 6 / 6 | PASS | 60 / 0 / 0 |
| configuration-no-pdf | 6 / 6 | FAIL | 72 / 0 / 0 |

Totals: **6 retained browser cases, 36/42 completed cycles, 438 passing assertions, 0 failing assertions and 48 unverified slots**. Actual verdicts: **1 PASS, 4 FAIL, 1 INCONCLUSIVE, 0 ERROR**. All five completed case expectations matched; that does not turn resource/runtime FAIL into PASS. The initial projects flow incorrectly addressed a searchbox as a textbox; its six incomplete cycles remain INCONCLUSIVE. A separate setup filename typo stopped an earlier attempt before any browser run. Both raw attempts remain retained.

The six-cycle configuration case adds 298 nodes and 19 listeners per post-first interval. The twelve-cycle repeat shows the same increments: nodes 454 baseline → 4,031 final/cooldown; listeners 341 → 595. Skipping PDF preview still adds **294 nodes and 19 listeners** per interval (454 → 2,219 nodes; 341 → 481 listeners). Therefore PDF iframe opening is **not required for this observed growth**. It does not identify the retaining owner or prove a permanent application leak. All GC samples succeeded, the main document stayed stable, and no iframe remained at cycle end. No heap-growth threshold finding occurred.

Missing-provider recovery passed all 42 checks, while the raw verdict remained FAIL for its real six HTTP 503 responses, logged upload error, and resource counts (+113 nodes/+8 listeners per interval). Final independent state inspection confirms exactly one disposable approved user and **zero workflow sessions/runs/events/fragments, queued jobs, upload files and output files**. No provider was configured.

All case execution, copied source, build artifacts and lab hashes stayed stable during each run. The same engine/source/build was used across the comparisons. Verified snapshots of the exact authored flow/common source are retained beside each case. Original inventory verification reports no changes. The owned frontend and backend were stopped after testing; the evidence dashboard remains available.

[Portable results](robot-main-evaluation-results.json) retain counts, samples, finding metrics, identities and artifact paths. The dashboard at [127.0.0.1:4545](http://127.0.0.1:4545/#runs) displays all six cases, assertion gaps, trend graphs and evidence links. Browser QA verified all six drawers, graph identifiers/support edges and 24 report/capsule links, with zero browser errors.

Next engineering investigation: separate repeated form mount/unmount from text preview and step transitions, compare a minimal unchanged control outside the normal observer, then collect retaining paths before proposing a source fix. Any candidate fix belongs in another ignored copy and must rerun the same successful outcomes plus retention checks. Do not hide these alerts or raise thresholds to obtain a PASS.

## Repository verification

Final `npm run check` passed formatting, compilation with warnings treated as
errors, **197 ExUnit tests plus one doctest**, and **160 Node tests**. The dashboard
confirmed these suite records match its current source revision and are not stale;
older stale records remain visible. Retained records:
`reports/test-history/elixir-1791613320013-258.json` and
`reports/test-history/1791613333478-83597d70.json`.
`git diff --check` passed, staging is empty, and HEAD remains
`2f6429988a98b7ddc2833f9d312880b6fdd59353`.
The context graph/index were refreshed after the final documentation edits.


## Interpretation and remaining boundaries

A missing-provider 503 is a real fresh-install configuration condition, not proof
that a configured production provider fails. Vibe Guru's raw runtime verdict stays
visible even when the UI handles the rejection correctly. A post-GC threshold
crossing is a resource-growth signal, not proof of permanent ownership or a leak.

The empty database cannot establish successful project creation, durable restore,
project deletion, generated-code correctness, live job streaming, HITL/editor,
exports or recovery halfway through real generation. PDF iframe creation/cleanup
does not assert decoded PDF correctness. Robot model selection does not verify
robot compatibility or physical safety. Session expiry and sustained responsiveness
remain planned vectors. Source-only rate controls are recorded separately in
[RATE_LIMIT_INVENTORY.md](RATE_LIMIT_INVENTORY.md); their enforcement was not tested.

These are three authored workflows on one local app, not independent samples or
a product success-rate estimate. Vibe Guru is useful for supervised evaluation;
it still needs an app-specific oracle and does not autonomously understand the
robot application's business requirements.

Reproduce using the ignored workspace's preparation manifest, build/setup logs,
`tooling/BACKEND_SETUP.md`, flow files and `run-evaluation.mjs`. Bootstrap must run
only against an empty disposable database; reuse existing test credentials for
reruns. Never copy its generated secrets or database into portable documentation.
