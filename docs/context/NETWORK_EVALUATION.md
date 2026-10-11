# Response races, reconnect recovery and source-candidate verification

Date: **9 October 2026, Asia/Calcutta**. This continues the authorized local product
improvement and Desktop evaluation. **Nothing is staged, committed or pushed.**
Original Desktop projects remain unchanged; dependencies, builds, experiments and
the gateway source candidate live in ignored disposable copies under `reports/`.
Read [DESKTOP_EVALUATION.md](DESKTOP_EVALUATION.md) for the earlier three-project
resource/runtime campaign and its limitations.

## What now exists

- Flow `ctx.observe(id, data)` retains structured experiment observations alongside
  assertions and cycle results. It snapshots JSON-safe data and enforces unique
  per-cycle IDs, depth and size limits. Observations do not generate findings.
- Failed journey findings retain observations from the same cycle and route.
  The JSON and standalone HTML evidence report expose response schedules, visible
  state and reconnect snapshots supporting the assertion. These references do not
  establish a cause by themselves.
- A response gate observes two actual requests before releasing their controlled
  responses. Ordered and reordered cases overlap both requests; completion order
  is the intended difference. Missing requests and delivery failures stay visible.
- A real WebSocket disconnect/rejoin experiment checks server state, identities,
  away state and visible roster convergence across isolated browser clients.
- Campaign manifests support per-app variant matrices, declared expected assertion
  failures, and comparisons between separately built source candidates. Capsules
  distinguish original source inventory, actual copied source, built artifacts and
  dependency locks, and hash the external driver and experiment code.
- Expected-negative scoring requires every declared prerequisite and outcome in
  every cycle. Infrastructure exceptions, missing reports and failed restoration
  cannot count as successful negative experiments. An already-recorded failed
  app assertion remains FAIL if restoration also fails.

The normal engine still uses deterministic analyzers. Workflows, interventions,
expected outcomes and the source patch were manually authored. Jev, autonomous
discovery, automatic minimization, source repair and durable incident retrieval are
not implemented. No new marketing UI was built in this iteration.

## Existing gateway refresh race and candidate patch

The unchanged copied gateway's Logs screen allows another Refresh while a previous
request is pending. Its `loadLogs` function applies every arriving response to
state without checking whether a newer request has started.

The experiment loads the screen, holds two actual manual refresh requests, then
releases the same controlled responses in these orders:

```mermaid
sequenceDiagram
    participant UI as Logs screen
    participant Gate as Controlled HTTP gate
    UI->>Gate: Older refresh request (held)
    UI->>Gate: Newer refresh request (held)
    Gate-->>UI: Newer response
    Note over UI: Newer results visibly render
    Gate-->>UI: Older response
    Note over UI: Original overwrites newer results; candidate keeps them
```

The declared contract is **the latest initiated refresh controls displayed
results**. After observing the newer result and finishing both response bodies,
the flow saves repeated visible-state samples over a **400ms** window.

The original overwrote newer results in **6/6 reordered cycles**. Its ordered
control passed **6/6**. This is an existing source behavior reproduced under
controlled response ordering, not a seeded replacement of the state-update code
and not an autonomously discovered customer incident.

A second disposable copy changes only `src/pages/LogsPage.tsx`: a request sequence
ref allows only the latest request to update logs/error/loading state; effect
cleanup invalidates pending requests. Dependency locks match the original copy.
This manually authored candidate passes both response orders, **12/12 cycles**,
with the final assertion still enabled. It establishes the bounded fix comparison,
not correctness for all gateway workflows or arbitrary future timings.

Private candidate patch:
[gateway-log-race.patch](../../reports/network-evaluation-20261009/gateway-log-race.patch).
The original Desktop source was not patched.

**Conditions:** HTTP responses are fixtures; the actual gateway backend is not
running. Every interval with delay exactly **10000ms** is disabled, including the
Logs poll. This is a broader timer intervention, not proof of full background-poll
behavior. There are no authenticated or write-side effects in this experiment.
Both copies use transpile-only Vite artifacts: the original normal TypeScript build
still fails its previously documented three errors. This change does not fix or
conceal that build result. Stability beyond the recorded window is unverified.

## Reconnect and convergence

The multiplayer copy runs its actual local Node/WebSocket server. Two isolated
contexts start with distinct identities and agreeing rosters. The experiment
disconnects the primary socket, observes the peer marking it away, changes the
peer name, and observes the server acknowledging that change. It then reconnects
the primary and verifies:

1. A new connection receives a real server welcome.
2. The server rejoin snapshot contains the changed peer name.
3. The primary identity survives this bounded grace-window reconnect.
4. Both visible rosters agree on room, unique identities, names and away state
   within **2000ms** of the observed rejoin.

Normal reconnects pass **6/6 cycles**, with **42/42 assertions**. In the labelled
negative control, the browser transport suppresses welcome delivery to the app
while retaining the real server response as evidence. Both sockets open and the
server snapshot is current, but the primary UI retains the old peer name:
**6/6 explicit convergence failures**, with the other **36/36 assertions passing**.
All six restoration operations succeed before subsequent cycles. Restoring normal
transport (`fixed`) again passes **42/42 assertions**.

This proves the supplied check distinguishes socket connectivity from usable
state. It is **not a naturally occurring multiplayer bug**, a source patch or proof
of general eventual consistency. The bounded test covers one rename and two local
clients; message loss, duplicate writes, long outages, persistence, network load and
larger rooms remain untested. Only the primary client has resource instrumentation.

## Campaign results and interpretation

Final campaign: **`campaign-1791549232823-8a1b148c`**. Raw
[summary](../../reports/network-evaluation-20261009/campaign-1791549232823-8a1b148c/summary.json)
and [case results](../../reports/network-evaluation-20261009/campaign-1791549232823-8a1b148c/results.json).
The compact, portable [network-evaluation-results.json](network-evaluation-results.json)
retains aggregate results and build identities without copying application source.
The private [prepared manifest](../../reports/network-evaluation-manifest.json)
retains the copied-build locations and per-app expectation matrix. To rerun those
existing copies from the repository root:

```powershell
mix escript.build
node scripts/lab.mjs reports/network-evaluation-manifest.json
```

| Build / condition | Verdict | Passed / failed assertions |
|---|---|---|
| Gateway original, overlapping requests released older then newer | PASS | 12 / 0 |
| Gateway original, overlapping requests released newer then older | FAIL | 6 / 6 |
| Gateway original, deliberately interrupted | INCONCLUSIVE | 6 / 0; final check missing |
| Gateway candidate, older then newer | PASS | 12 / 0 |
| Gateway candidate, newer then older | PASS | 12 / 0 |
| Gateway candidate, deliberately interrupted | INCONCLUSIVE | 6 / 0; final check missing |
| Multiplayer normal reconnect | PASS | 42 / 0 |
| Multiplayer welcome suppressed | FAIL | 36 / 6 |
| Multiplayer normal transport restored | PASS | 42 / 0 |

Nine cases exercise **54 cycles**. All **7 declared experiment outcomes match**;
the other two cases are deliberately incomplete and remain INCONCLUSIVE. There are
**0 execution/report errors**, **174 passed assertions** and **12 expected failed
assertions**. Five cases PASS, two FAIL and two are INCONCLUSIVE.
Matching an expected defect is a successful experiment, not a clean application.

This is not a population success rate, real-world precision estimate or evidence
that Vibe Guru autonomously finds these classes of defect. The earlier **24/24
synthetic signal detections** remain a separate benchmark. The network cases do
not enter that synthetic detector score. The real existing race, injected welcome
loss, positive controls and interrupted execution are reported separately.

Two earlier nine-case calibration campaigns produced the same case outcomes:
`campaign-1791548683704-a35ccf2a` and `campaign-1791548822652-0a26fb66`.
Review then identified a cleanup edge case: preserving a primary assertion error
could let a final-cycle restoration failure satisfy the expected-negative scorer.
The adapter now reports both failures through `AggregateError`; regression tests
confirm the app assertion stays FAIL and the experiment expectation is rejected.
The final fresh campaign uses this hardened adapter. Actual restorations in all
three campaigns succeeded; the edge case was established with a mutated report
and helper-level regression tests, not a claimed observed app failure.

## Validation and saved context

- **192 Elixir tests and one doctest**, **114 Node tests**, formatting and
  compilation with warnings as errors pass.
- A fresh Windows x64 npm tarball passes CLI/browser/MCP smoke tests using the local
  escript. Native Burrito builds and other platforms remain unverified here.
- Capsules have unique node IDs and resolving graph edges. Each failed assertion
  links to its same-cycle/route observations. Raw traces confirm both requests were
  held before release, the tested response order and the full observation window.
  The nine capsules retain **192 structured experiment observations** and **678
  graph edges** across **623 nodes** (counts summed across separate case graphs).
- Current source hashes confirm the candidate differs in exactly one inventoried
  source file and shares the original dependency locks. Inventories confirm the
  **124 non-excluded source files across the three original Desktop projects** are
  unchanged. Inventories exclude dependency/build trees, environment/key files and
  symlinks; this is not a full filesystem backup.
- HEAD remains `2f6429988a98b7ddc2833f9d312880b6fdd59353`; no staging, commit or push.
  Test-owned servers are stopped after execution. Raw apps, logs, screenshots and
  patches remain under ignored `reports/`; narrative context and aggregate results
  live in `docs/context/`.

## What this changes about the product direction

The stronger demonstrated outcome is now **reproduce a timing-dependent failure,
retain the experiment, then check a candidate against the failing condition and a
neighboring control**. Memory counters can supplement that loop. The result is
more actionable than a generic clean/unclean report, but buyer demand and willingness
to pay remain untested. Local founder projects are engineering validation, not
independent customer validation.

The next investment should reduce per-app harness work: import an existing
Playwright journey and an explicit expected outcome, then apply reusable condition
matrices. Prioritize rapid actions, navigation during pending work, HTTP failure
and recovery, and multi-client state assertions with controlled data. Retain normal
controls and execution validity for every condition. Test on a new app without
hard-coding its selectors into the engine, and measure setup effort and debugging
usefulness.

Jev can later choose among these supported experiments, with observable predictions
and an execution budget. Building a general simulator, graph database, hosted fleet
or another website now would not remove the measured integration bottleneck.
Retain the current architecture while recording its actual installation and
maintenance costs. Use these saved reproductions as the starting corpus for future
incident replay and investigation planning.
