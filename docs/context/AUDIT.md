# Context audit: evidence, gaps, and uncertainty

Snapshot: **8 October 2026, Asia/Calcutta**. Source baseline: `feat/census-probe`, commit `2f6429988a98b7ddc2833f9d312880b6fdd59353`.

**Subsequent implementation, same date:** preserve the findings below as the before-state. [IMPLEMENTATION.md](IMPLEMENTATION.md) records the corrected configuration propagation, validity/evidence/attribution/reporting behavior, new UI/commercial artifacts and current checks. The current suites have 175 Elixir tests + one doctest and 85 Node tests. Fresh packaged escript checks pass; native release CI and customer validation remain pending. The historical gaps below are not all current defects.

This audit records actual behavior and specific source gaps to inform the next task. It does not change product logic or prescribe which feature the user must build next. Local source/tests outrank stale narrative documents; remote publication state remains unknown.

## 1. Verification performed in this task

| Check | Result | What it establishes |
|---|---|---|
| Initial git status | Clean | No pre-existing tracked changes |
| Source/manifests/CI/fixture/doc inspection | Completed across repository-owned subsystems | Static architecture and wiring |
| `mix test` | **165 tests + 1 doctest, 0 failures** | Engine interpretation, contracts, investigation unit behavior |
| `npm test` | **64 tests, 0 failures, 5 files** | Crawl/sampler/parser/renderer logic and real MCP stdio protocol |
| `mix format --check-formatted` | Exit 0 | Existing Elixir formatting |
| `mix compile --warnings-as-errors` | Exit 0 | Local engine compiles without warnings |
| `mix escript.build` | Succeeded | Fresh local development executable |
| Fresh fixture run | Exit **1**, 13 findings, 115 evidence records | Real browser survey, autostart and expected defect detection |
| Shared fixture verifier on fresh report | Passed | Eight required signature categories, clean control, ordering, coverage, auth wall |
| Listen-port check after run | No listener on 5173 | Autostarted server was torn down |
| Zero-byte repository-owned source scan | None found | Historical file-truncation incident is not present in inspected source |

Fresh browser command:

```powershell
escript vibeguru run --root test-app --out reports/context-audit-2026-10-08 --cycles 4 --routes 14 --quiet
node scripts/verify-fixtures.mjs reports/context-audit-2026-10-08/vibeguru-findings.json
```

The report was generated at `2026-10-08T13:33:31.725000Z` (**19:03:31 IST**). Findings were 2 critical and 11 high. Coverage was 12/13 (92.3%), with `/protected` auth_required and `/clean` finding-free. Generated evidence lives in the ignored `reports/context-audit-2026-10-08/`; this context pack is designed to survive without that directory.

| Route | Findings observed in this fresh run |
|---|---|
| `/crash` | uncaught_exception |
| `/render-loop` | render_loop |
| `/detached` | detached_dom_leak |
| `/charts` | listener_leak, route_heap_growth, retained_instances (MutationObserver) |
| `/listeners` | listener_leak |
| `/grow` | route_heap_growth |
| `/bad-fetch` | failed_request |
| `/log-error` | console_error |
| `/observers` | retained_instances (ResizeObserver, WebSocket) |
| `/protected` | console_error attributed to this route; source was the earlier Observers WebSocket |
| `/clean` | none |

The delayed WebSocket console error is an actual attribution limit: its frame points to `src/pages/Observers.jsx:27:0`, but aggregated routes are `/protected, /observers` and its primary location is `/protected`. It is not evidence that the protected component ran or threw. The observer's request-origin tracking handles ordinary fetch/XHR failures; this console event still lands on the current route. Existing fixture assertions permit this result.

Not performed: Burrito cross-build, packaged binary smoke tests, authenticated/headed login, focused snapshot browser execution, actual Pipeline-to-Investigation integration (absent), third-party framework apps, remote GitHub/registry checks, dependency security audit. Passing local tests does not establish those behaviors.

## 2. Confirmed implementation/documentation mismatches

| Item | Evidence and implication |
|---|---|
| Investigation is not part of the normal run | `lib/vibe_guru/pipeline.ex` stops at survey analyzers/reporters. No production call to `Investigation.run`, `Probes.available`, or `Probes.runner` was found. CLI/MCP return findings, not consolidated causes. |
| `routeParams` in saved config is ignored | README/Coverage recommend it, but `Config.from_map` only loads seven fields and `CLI.Run.pipeline_opts` forwards no route params. Direct `Pipeline.memory_client(..., route_params: ...)` or driver config supports the feature; normal config-driven CLI/MCP does not. |
| Custom census targets are not loaded from saved config | Pipeline supports `:census_targets`, but Config and CLI do not expose it. Library/universal targets still run. |
| Threshold tuning is narrower than docs imply | Individual analyzers accept `config.thresholds`; saved Config and Pipeline do not propagate a thresholds option. Direct analyzer calls can tune values. |
| CLI defaults differ from old docs | Normal/direct CLI use `%Config{}`: 12 cycles, 400 ms settle. Pipeline/Node defaults are 20/500. MCP defaults are 4 cycles, 12 routes. |
| Four layers are not four behaviours | Probe/Analyzer/Reporter are behaviours; Detector is a concrete module. |
| Investigation architecture draft is stale | It says nothing is built and heap.snapshot is planned; rules, loop, state, catalog and snapshot implementation/tests now exist. Model policy and source-line attribution remain planned. |
| Existing handover is historical | Its initial main/commit/vector counts, later branch/publish claims and old test counts do not describe this checkout. It ends before the newer census/investigation/snapshot commits. |
| Survey runner comments contradict code | `run.js` header and an earlier cycle comment say no GC during cycling; actual route/flow branches call `gc.collect()` before tagged samples. Preserve executable behavior. |
| Some struct module docs describe future output | Evidence docs mention allocation profiles/snapshots, Finding docs mention source maps; the standard survey does not produce those capabilities. |
| MCP “leaves no trace” claim is incomplete | Reports are temporary by default, but missing config triggers `init` which writes `vibeguru.json` into the project. |
| Node requirement message is stale | package engines/README/CI say Node ≥20; Presenter node-not-found hint says 18+. |
| Nuxt route extractor is not selected automatically | `Detector.Routes` handles explicit `:nuxt`, but `Detector.Frontend.router_from` never returns `:nuxt`. |
| Local and packaged Playwright differ | Root lockfile pins 1.63.0; driver's nested lockfile pins 1.60.0. Both installed versions match. Source driver resolves the nested copy; npm package supplies root dependencies. |
| Release status cannot be recovered from old notes | Local version is 0.1.2 and workflows exist; this audit did not establish live npm version, release assets or current CI outcomes. |

## 3. Measurement and result limitations

These are grounded in source or the fresh run. Some are design tradeoffs; others are likely follow-up defects. They were not silently fixed during a context-only task.

### Coverage and verdict consistency

- Coverage uses paths known to the detector/crawler. Unknown routes can be absent from the denominator, so 100% known-route coverage does not prove full app coverage.
- Reachability is recorded only on the first cycle. Landing is verified primarily by pathname, not rendered component content or successful feature operation.
- `Coverage.low?` flags known==0 and ratios below 0.7. With nil coverage it returns false. CLI exits based on finding severity, so a clean low-coverage run can still exit 0. MCP only changes a zero-finding verdict to INCONCLUSIVE when coverage.low is true.
- Markdown's empty findings text still says “No action needed” / “Every route returned memory to baseline” before its separate low-coverage block. MCP/CLI wording is more qualified for low coverage, but absence of findings does not imply exact baseline recovery: thresholds tolerate growth.
- Flow mode always emits a coverage record with no planned/visited routes; Coverage interprets known==0 as low. This conflicts with the Node renderer test comment that flow runs have no coverage.
- `renderReport({})` or a report with missing/null findings renders PASS in the absence of low coverage. A test currently codifies no-throw behavior; it does not protect against a misleading clean verdict on malformed payloads.

### Navigation and runtime attribution

- Real anchor clicks can reload on non-SPA links even though crawler tests assert no direct `page.goto` calls. React Router fixtures support client navigation; other routers need actual framework fixtures.
- Fallback `history.pushState` + synthetic popstate is not proven to render the right view on Next app-router, hash routers, or every framework. Path match alone is a weak check.
- `returnHome` falls back only if `goBack` throws; a successful back call landing on the wrong state/URL is not checked. This can affect attribution after guards/replaced history.
- Declarative route regexes do not resolve constants, nested relative route composition, generated routes, or arbitrary JavaScript. Dynamic resolver handles `[id]`, `[...slug]`, `:id`, `_id`; optional/wildcard syntax flagged by detector is not fully resolved/skipped by the planner.
- Flow mode does not set `observer.route`, add per-mark mutation-window fields, or collect per-mark census. Runtime blame generally stays at `/`; render-loop/census signal is weaker/absent even if memory marks work.
- Flow exceptions emit a warning and continue; failure to execute a requested interaction is not a structured run failure. If `mark` is called before an error, the final sample may not represent the unfinished flow.
- WebSocket console-event attribution is wrong in the fresh fixture run (section 1). Primary-route filtering also omits findings whose requested route appears only in the aggregated routes metric.
- Runtime normalization masks URLs and numbers; distinct errors may collapse. Aggregation reports the first frame/URL plus occurrence count, not each individual event.
- DOM mutation rate is a heuristic for render loops; legitimate animated/high-churn views can be noisy. The fixture establishes this signature on one intentional React loop, not universal correctness.

### GC, metrics and protocol completeness

- Survey tracks GC failures, emits a warning, and places `gcFailures` in the driver's final result. Memory.Client discards that result; JSON/Markdown/MCP have no structured measurement-validity flag. `--quiet` also suppresses the warning callback. Clean results can therefore hide failed collections.
- Snapshot-run ignores the boolean GC results and ignores `visitRoute` reachability results, so a redirect/failure may be interpreted as the requested route's retained/absent objects.
- Counter/page-evaluation failures become null measurements; analyzers skip these and may return no findings. Missing measurement validity is not currently promoted to INCONCLUSIVE.
- Sampler's WebGL count uses `getContext`, which can create a compatible context on a canvas rather than purely observe it. It sees attached canvases, not all retained detached canvases.
- Driver's receive timeout restarts after each message: it behaves as an inactivity guard, not a strict total wall-clock budget. Normal Node run does not apply a separate timeoutMs deadline. Reporter completion does not prove a strict run time cap was enforced.
- Driver accepts successful process exit even without a final result or complete evidence. Noise/non-JSON output is ignored. Missing baseline/cycle evidence leads memory analyzer to an empty findings list.
- Pipeline collects reporter return values into outputs without failing on reporter `{:error, ...}`. CLI can claim reports written even when a reporter returned an error; MCP then fails if its required JSON file is absent.

### Identifiers and retained evidence

- Evidence's default id is derived from probe/kind/phase/cycle, without route/event uniqueness. Multiple route samples or events in the same cycle share ids. `Finding.evidence_refs` is generally left empty by current builders.
- Runtime finding id derives from signature and primary route, not the distinct message; two different errors on one route/signature can share an id. Route/class slug normalization can also collide.
- Reports save findings and evidence_count only. The architectural ability to reanalyze Evidence is real in memory, but a persisted evidence cache/history/replay interface does not exist.

## 4. Investigation: important gaps before integration

| Gap | Consequence |
|---|---|
| Snapshot updates only library/cache candidates | Seed may support `unreleased_subscription` on `/charts`; snapshot can support library retention without eliminating subscription, leaving two live candidates. The loop will not conclude. Unit runners inject additional subscription elimination that the real heap interpreter does not produce. |
| No-op free evidence can trigger stall | Rules considers the last history entry's changed flag. Seed records free steps too; an unchanged seed entry can stop the loop before a potentially useful focused snapshot. |
| Null census can be read as negative evidence | Survey analyzer skips null correctly; investigation census seed filters numbers and treats no positive growth as subscription elimination, including classes it could not meaningfully count. |
| Seed compares same-route samples across whole cycles | Other route effects can occur between samples; seed's node/count trends are weaker than survey's consecutive route attribution. It includes warm-up. |
| `explains` includes every sibling on the route | A retained chart cause can claim an unrelated runtime exception on the same route. This is a heuristic, not a demonstrated causal relationship. |
| Hinted class becomes cause wording | If a different class actually supports the library hypothesis, Rules still derives specific wording/fix from chart_libs. A detected library is a hint, not proof of the retained object's identity. |
| Snapshot is a bounded summary | Top-40 truncation is applied separately before/after; non-target classes crossing the ranking boundary can look newly present. Bytes are shallow self-size changes, not total retained size. |
| Missing heap evidence is interpreted as no growth | `Snapshot.interpret` defaults to an empty map, eliminating candidates even if the driver supplied no heap_census. A test checks it doesn't crash, not that absence is treated as unknown. |
| Budget relies on reported costs | Failures consume a probe/depth but record 0 ms. Typical cost doesn't prevent dispatch over remaining time. Depth is shared across symptoms in the current loop. |
| Symptoms beyond top N are omitted | Only selected symptoms are processed; findings outside max_symptoms are not all recorded unresolved. Original findings must remain available in a future synthesis/report design. |
| Model/decision replay claims are design intent | Decision trail exists, but no model policy, state hashes, persisted policy version/replay runner, or calibrated confidence is implemented. |

The current subsystem is valuable groundwork. Integration needs real-run tests and explicit unresolved behavior; synthetic cause-consolidation tests alone do not establish that the real snapshot settles the chart case.

## 5. Packaging and verification limits

- CI e2e tests the local escript, not the Burrito assets end users execute. Release workflow builds/assets are defined but packaged-runtime smoke checks are absent from this checkout's workflows.
- `VIBEGURU_BINARY` is supported by MCP engine resolution, not ordinary wrapper resolution. A Windows escript is not directly executable through its spawn path.
- Wrapper `BROWSER_COMMANDS` contains init/run/memory:client but omits auth. Postinstall normally installs Chromium; lazy first-command auth after skipped/failed postinstall can miss that retry.
- Downloads follow redirects and rename a temp file, but do not verify signed checksums and do not implement comprehensive stream-abort/timeouts/concurrent cache coordination.
- `read_findings(root)` JSON-read errors occur outside a tool-specific try/catch. Temp MCP output directories are not cleaned by the runner.
- Root version agreement is gated in CI. Release asset names/version tags/npm publication still need to remain aligned; current availability cannot be assumed from source version alone.
- GitHub shared fixture assertions are useful but only require signature presence and selected invariants, not exact attribution for every finding. They currently allow the observed WebSocket blame error.
- Jenkins definition assumes Unix and has no evidence of a real Jenkins run in this audit. Its gate handles selected error codes, not all possible process failures.
- No direct unit suite targets observer/census/auth/survey runner/CDP snapshot capture. Tests use simplified fake page execution for crawl/sampler; this does not replace real router/browser testing.

## 6. Historical documentation handling

`HANDOVER.md` was read as historical notes and retained. It contains successive sessions with contradictory old status and publication statements. No rename, publish, push, merge, dependency upgrade, or product fix was done based on those notes. The prior architecture docs were also retained without rewriting their history.

If remote publication state matters to the next task, inspect the actual registry/release/CI then. If a router or framework claim matters, reproduce it against that framework. If a suggested fix matters, confirm its source cause. These are unresolved facts, not assumptions to carry forward as proven.

## 7. Context artifacts and refresh contract

Created for this task:

- `PROJECT_CONTEXT.md`: short entry point for a fresh chat.
- `docs/context/UNDERSTANDING.md`: product scope, subsystem map, four Mermaid diagrams, contracts, lifecycle, defaults, tests and development commands.
- `docs/context/AUDIT.md`: dated verification plus implementation gaps and uncertainty.
- `docs/context/FILE_INDEX.md`: generated per-file module/export/size/test inventory.
- `docs/context/graph.json`: generated typed graph with file hashes and source metadata.
- `scripts/context-map.py`: standard-library-only graph/index refresher.

The graph describes tracked source plus these new context files. Dependency trees, auth sessions, generated binary/reports, and unrelated personal files are excluded. Static references may occur in docs/types/tests and are labeled accordingly. The graph/index exclude themselves from file hashes to avoid recursion.

Refresh command: `python scripts/context-map.py`. It discovers tracked files plus the explicitly included context pack; new untracked product files enter the index after being added to git. Narrative/audit updates remain a human/agent task. Read current git status and re-check affected source before using this snapshot for implementation.
