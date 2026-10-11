# Vibe Guru: start here for future tasks

Code-audited context snapshot: **8 October 2026 (Asia/Calcutta)**.

**12 October 1.0.0 preparation:** The founder explicitly authorized versioning,
committing and pushing the reviewed changes for the 1.0.0 release. This supersedes
the earlier local-only instruction for this source release. The npm manifest,
lockfile and Elixir engine now target 1.0.0; the report schema stays 2. Read
[RELEASE_1_0_0.md](docs/context/RELEASE_1_0_0.md) and [CHANGELOG.md](CHANGELOG.md)
before publication. Source/tag synchronization is separate from passing native
builds and public installation: the current private-repository download URLs
remain a public-distribution blocker. Desktop originals, keys, local consent
configuration and raw experiment evidence remain excluded from Git.

**11 October Git synchronization:** The founder explicitly authorized review,
staging, committing and pushing this repository's accumulated changes. The current
`feat/census-probe` branch contains all five local branch tips; the earlier feature
branches require no merge. See [GIT_SYNC.md](docs/context/GIT_SYNC.md) for the
reviewed scope and exclusions. Earlier statements below about keeping this work
uncommitted describe the instruction in force at the time. Desktop originals and
ignored local evidence remain local; this authorization does not publish a release,
change repository visibility or publish the separate website.

**11 October launch preparation:** Optional, default-off PostHog metadata reporting,
installation diagnostics and precise CLI/MCP onboarding are implemented locally.
MCP project-code execution now requires explicit trust; installer downloads and
session/scratch files are hardened. A separate minimal download portal lives at
`C:/Users/Shashank/vibeguru-website`. Test timing analytics appear in the dashboard's
Changes view. Read [LAUNCH_PREPARATION.md](docs/context/LAUNCH_PREPARATION.md),
[GETTING_STARTED.md](docs/GETTING_STARTED.md) and
[TEST_TIMING.md](docs/context/TEST_TIMING.md) for evidence, remaining account/release
gates and actual durations. Repository privacy remains with the founder; Git source
synchronization is now authorized as described above. The founder subsequently supplied
the public PostHog token in the ignored `hogpostkey/` folder. Local consent/config
is enabled; a three-cycle clean fixture produced start/completion events accepted
with HTTP 200. The bounded analytics deadline is now five seconds to accommodate
observed cold connections. See the activation section in
[LAUNCH_PREPARATION.md](docs/context/LAUNCH_PREPARATION.md). The connected PostHog
agent subsequently created and queried all eight insights in the unshared
[Vibe Guru Usage dashboard](https://us.posthog.com/project/658479/dashboard/2197466).
Read [POSTHOG_DASHBOARD.md](docs/context/POSTHOG_DASHBOARD.md) for saved IDs,
run-ID delivery coverage and missing audience/feedback data. Existing activity is
founder fixture telemetry; customer usage and native support remain unproven.

This folder is named `vibecheck`; the product and npm package are **Vibe Guru / vibeguru**. It is an Elixir orchestration and analysis engine with a Node/Playwright/Chromium measurement driver, a Node MCP server, and an npm distribution wrapper. The React app in `test-app/` is deliberately broken test infrastructure.

The normal CLI/MCP run measures **memory retention, runtime failures, and live class instances** in one browser session. The investigation loop and focused heap-snapshot probe exist separately; **they are not wired into the normal pipeline**. Analysis uses deterministic heuristics, with no implemented LLM policy.

**9 October implementation:** Flows now support setup, declared outcome assertions
and persisted completion evidence. An experimental fixed-plan campaign runner adds
labelled fault injection, observed candidate comparisons and incident graphs.
Investigation and analyzer claims have been qualified against their actual evidence.
Read [DESKTOP_EVALUATION.md](docs/context/DESKTOP_EVALUATION.md) for current validation
and limitations. All work remains local and uncommitted at the founder's request.

**9 October follow-up:** Flows can now retain structured experiment observations.
Controlled overlapping-response and real WebSocket reconnect experiments are
implemented. An existing gateway refresh race was reproduced, then resolved in a
disposable source candidate under both tested response orders. Read
[NETWORK_EVALUATION.md](docs/context/NETWORK_EVALUATION.md) before the earlier
Desktop evaluation. Original Desktop projects remain unchanged; no work is staged
or committed. Jev planning and autonomous repair remain unimplemented.

**9 October adversarial expansion:** Two new isolated fixture applications exercise
pending navigation, real HTTP failure/retry and server-verified duplicate writes.
The registry now has eleven implemented vectors. Adversarial evidence tests exposed
and fixed false-PASS gaps for undeclared assertions and omitted runtime findings.
Use `npm run lab:adversarial` for the repeatable condition matrix, and read
[ADVERSARIAL_EVALUATION.md](docs/context/ADVERSARIAL_EVALUATION.md) for boundaries.

Read these in order:

**10 October state-resilience follow-up:** Cold editor documents now exercise
persisted JSON/schema corruption, scoped storage exceptions, unsaved-state warnings
and explicit retry. Two isolated clients exercise lost updates and explicit
version-conflict reconciliation. The registry has thirteen implemented vectors;
session expiry and sustained responsiveness remain planned. Completion records
must belong to cycles and cannot claim both success and an execution error. Read
[STATE_RESILIENCE.md](docs/context/STATE_RESILIENCE.md) before the earlier evaluations.

**10 October real-app evaluation:** The hardened engine reran three unchanged-source
Desktop apps without seeded leaks/exceptions: eight cases, 66 attempted cycles,
four PASS, three FAIL and one INCONCLUSIVE. A fourth, previously untested robot
frontend passed six public-UI cycles after a fresh isolated production build;
its backend, login and robot functions remain untested. A separate source-only rate-control
inventory records implementation and gaps without testing enforcement. Read
[REAL_APP_EVALUATION.md](docs/context/REAL_APP_EVALUATION.md) and
[RATE_LIMIT_INVENTORY.md](docs/context/RATE_LIMIT_INVENTORY.md). Vibe Guru is ready
for supervised evaluation, not a finished general application verifier.

**10 October robot-main evaluation:** The specifically requested
`Desktop/robot-programming-main` is distinct from the earlier public-only robot
frontend. Its source was copied without secrets, databases or dependencies; stock
Next production build and pinned Python 3.12 backend installation passed. A real
isolated FastAPI/SQLite backend supports normal UI signup/sign-in and scoped form,
preview, project-list and missing-provider checks. Read
[ROBOT_MAIN_EVALUATION.md](docs/context/ROBOT_MAIN_EVALUATION.md) for actual results,
setup conditions, retained incomplete attempts and untested generation boundaries.
Five completed cases passed 426 functional assertions; raw verdicts retain repeated
DOM/listener growth, including a twelve-cycle repeat and a comparison without PDF
preview. Six saved cases include one earlier INCONCLUSIVE locator mismatch. No
provider or hardware ran; the original 1,598-file source inventory is unchanged.

The local [evidence dashboard](http://127.0.0.1:4545) now exposes current campaigns,
failures, evidence graphs, vector coverage, working-tree changes and suite history.
Start it with `npm run dashboard`. Read [DASHBOARD.md](docs/context/DASHBOARD.md)
for automatic refresh, test recording and the vector-growth workflow. `AGENTS.md`
records the maintenance steps required after future changes. The dashboard does
not execute tests automatically or turn expected app failures into passes.

0. [Latest robot-main evaluation with real authentication/backend](docs/context/ROBOT_MAIN_EVALUATION.md), [earlier real-app evaluation and readiness](docs/context/REAL_APP_EVALUATION.md), [source-only rate-control inventory](docs/context/RATE_LIMIT_INVENTORY.md), then [state-resilience iteration](docs/context/STATE_RESILIENCE.md), [adversarial lab expansion](docs/context/ADVERSARIAL_EVALUATION.md), [network experiments and candidate verification](docs/context/NETWORK_EVALUATION.md) and [Desktop evaluation](docs/context/DESKTOP_EVALUATION.md)

1. [Ambitious product vision: autonomous reliability lab and Jev](docs/context/NORTH_STAR.md) — longer-term plan, 9 October 2026; proposed, not implemented or validated
2. [Developer product entry point, audience and validation gates](docs/context/PRODUCT_THESIS.md)
3. [Earlier service proposal, Jev, test environment and vector decisions](docs/context/NEXT_DECISIONS.md)
4. [Implemented product direction and current verification](docs/context/IMPLEMENTATION.md)
5. [Original service-first proposal, investor review and commercial gates](docs/context/PRODUCT_STRATEGY.md)
6. [Original project understanding and architecture graphs](docs/context/UNDERSTANDING.md)
7. [Original gaps, mismatches, and verification evidence](docs/context/AUDIT.md)
8. [Current repository file index](docs/context/FILE_INDEX.md)
9. [Machine-readable dependency/context graph](docs/context/graph.json)

The original understanding/audit below are the before-state. Implementation on the same date prepares local version **0.2.0**, schema 2 and four verdicts, adds a static landing page and HTML evidence report, hardens packaging and preserves commercial context. It does not publish the release, acquire clients or connect the separate investigation loop.

Baseline inspected: branch `feat/census-probe`, commit `2f6429988a98b7ddc2833f9d312880b6fdd59353`; working tree clean before this context task. The older ignored `HANDOVER.md` contains historical information and stale state claims. Prefer current source and the dated audit when they disagree.

For the next chat, use: **“Read PROJECT_CONTEXT.md and its linked understanding/audit before starting. Check the current git state against the snapshot, then inspect the files relevant to my task.”** These files persist context on disk; a new chat must read them to recover it.

Refresh the static graph/index with `python scripts/context-map.py`. Update the narrative and audit after behavior changes; the script does not infer product intent or re-run verification.
