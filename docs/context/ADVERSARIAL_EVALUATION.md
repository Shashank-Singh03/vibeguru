# Adversarial lab expansion

Follow-up: [STATE_RESILIENCE.md](STATE_RESILIENCE.md) records the 10 October
storage/conflict expansion, thirty-six-case matrix and thirty-three-case corpus.
Counts below describe this earlier iteration.

Date: **9 October 2026, Asia/Calcutta**. Continues the founder-authorized work to
break, investigate and refine Vibe Guru. All changes remain local and uncommitted.
Original Desktop projects remain unchanged. New benchmark apps are purpose-built
fixtures; execution uses ignored copies under `reports/`.

## Implemented scope

The vector registry grew from eight to **eleven implemented vectors**:

| New vector | Actual experiment | Oracle and boundary |
|---|---|---|
| Pending navigation | Hold an actual Details request, navigate Home, then release it; compare vulnerable and generation-guarded modes. | Home heading and status remain unchanged throughout a 300ms post-response trace. Neighboring control completes the request before leaving. No cancellation or subscription ownership claim. |
| HTTP recovery | Real local server sends a 503, disconnects after partial response-body delivery, or returns malformed JSON; the user retries when the UI permits it. | Required condition is proven in the server ledger; usable result and enabled action must return within the 600ms observation deadline. Broken button state is explicitly reset between independent cycles. |
| Write integrity | Real rapid double-click and acknowledged retry of one logical order intent against vulnerable and idempotent endpoints. | Physical attempts, independent server order ledger, payload/price and visible count must agree; exactly one order must persist. One isolated in-memory process, no durable database or distributed transaction claim. |

The two new apps are `test-app/async-workbench` and `test-app/write-integrity`.
No new dependency installation or frontend build is required for either fixture.
Selectors and business expectations stay in adapters under `benchmarks/lab/`,
rather than in the measurement engine. Corrected modes are manually authored in
the same fixture source, not autonomous repairs or new customer defect discoveries.

The initial async calibration completed **14 cases / 84 cycles**, with all twelve
declared outcomes matched, two deliberate interruptions INCONCLUSIVE and no
execution/report errors. Write calibration covered six cases with three cycles
each, independently checking actual request overlap, persistence and empty cleanup.
These are calibration runs and must not be added to an independent accuracy score.

## Final combined campaign

`campaign-1791563501809-4f117771` completed **20 cases / 120 cycles**:
**18/18 declared experiment outcomes matched**, two deliberately interrupted cases
stayed INCONCLUSIVE, and there were **zero execution/report errors**. App verdicts
were ten PASS, eight FAIL and two INCONCLUSIVE. The suite retained **420 passed
assertions and 36 expected failed assertions**; the eight app FAILs include two
corrected HTTP cases whose recovery assertions passed but whose injected runtime
faults remain visible.

| Condition | Vulnerable mode | Corrected mode |
|---|---|---|
| Request completes before navigation | PASS, 18/18 assertions | PASS, 18/18 assertions |
| Navigate while request is held | FAIL, 6/6 isolation assertions fail | PASS, 18/18 assertions |
| Deliberately interrupted pending request | INCONCLUSIVE, final assertion absent | INCONCLUSIVE, final assertion absent |
| Normal HTTP response | PASS, 18/18 assertions | PASS, 18/18 assertions |
| HTTP 503 followed by retry opportunity | FAIL, 6/6 usable-recovery assertions fail | Recovery 18/18 assertions pass; runtime FAIL remains |
| Partial-body disconnect followed by retry opportunity | FAIL, 6/6 usable-recovery assertions fail | Recovery 18/18 assertions pass; runtime FAIL remains |
| Malformed JSON followed by retry opportunity | FAIL, 6/6 usable-recovery assertions fail | PASS, 18/18 assertions |
| Single order submit | PASS, 36/36 assertions | PASS, 36/36 assertions |
| Rapid double submit of one intent | FAIL, two persisted orders in 6/6 cycles | PASS, two attempts but one persisted order in 6/6 cycles |
| Retry after acknowledged order | FAIL, two persisted orders in 6/6 cycles | PASS, two attempts but one persisted order in 6/6 cycles |

Both double-submit modes observed actual request overlap in every cycle. All
36 write cycles proved empty server namespaces after cleanup. Every case retained
stable execution identities. Capsule graphs have unique identifiers and resolving
edges: **1,338 nodes, 1,456 edges and 324 structured experiment observations** summed
across twenty separate graphs. These relationships are evidence links, not causal
proof. Source inventories confirmed unchanged fixtures and all previously copied
Desktop originals.

Private final [manifest](../../reports/adversarial-evaluation-1791563501741/manifest.json),
[summary](../../reports/adversarial-evaluation-1791563501741/campaign-1791563501809-4f117771/summary.json)
and [results](../../reports/adversarial-evaluation-1791563501741/campaign-1791563501809-4f117771/results.json)
support the portable [aggregate](adversarial-evaluation-results.json).

This is **not a 100% general success rate**. The expectations and intentional
defects were supplied for two authored fixtures. Cases repeat controlled conditions
and include neighboring controls. External-app sensitivity, false alarms and
autonomous defect discovery remain unmeasured.

## Two Vibe Guru defects exposed and fixed

1. **Undeclared/malformed assertion records could preserve PASS.** The Elixir
   result assessor and JavaScript report reader now require every observed
   assertion to belong to the declared contract and have a valid phase, cycle and
   status. The driver rejects undeclared check IDs during flow execution. Known
   failed assertions remain FAIL when other checks are incomplete.
2. **Raw runtime failures could be hidden by omitted analyzed findings.** The
   report reader now preserves directly observed uncaught exceptions, logged
   application errors and failed requests even if an optimistic report loses the
   corresponding finding. Narrow network/render-loop console-echo rules match the
   analyzer; a nonblocking 404 plus its Chrome console echo is not escalated.

A repeatable **30-case evidence-corruption corpus** starts from an actual clean
browser report, then removes/corrupts metrics, collections, completion, identities,
census data, assertion contracts and finding references. Its first run passed
26/30: four omitted-runtime-finding cases incorrectly remained PASS. After the
reader fix, all 30 expected assessments passed. Original seed bytes are preserved
and hashed. This is a report-integrity benchmark, not 30 app-defect detections.

Private before/after corpus records and logs are under `reports/adversarial-evidence`
and `reports/test-history`; the dashboard retains both failed and passing suites.
The earlier Node suite also records the failed assertions and initial transport
harness mistake rather than deleting that history.

Before/after evidence:
[26/30 corpus before the fix](../../reports/adversarial-evidence/1791563211142-27d36dd8.json),
[30/30 corpus against the final recorded control](../../reports/adversarial-evidence/1791563706284-93056e9d.json).

## Harness corrections and evidence validity

- A bare dropped GET was silently retried by Chromium, so it did not reliably
  expose failure to the app. The server now delivers headers and an incomplete
  body before disconnecting. Server delivery and the UI's explicit retry are
  checked separately; silently changing the intervention cannot count as success.
- Request-response completion and restoration errors remain execution failures.
  Cleanup failure combined with an already-failed assertion uses `AggregateError`;
  it cannot satisfy the expected-negative scorer.
- The campaign hashes execution code and the escript before and after every case.
  Source changes invalidate an apparent clean result and reject experiment success;
  already-observed app failures remain visible. This is a conservative local file
  identity check, not cryptographic proof of every runtime dependency or loaded byte.
- Capsules include fixture source/artifact identities, URL/mode, driver/workflow
  hashes, conditions, observations and graph relationships. Identity comparison
  distinguishes clean controls, vulnerable modes and incomplete execution.
- HTTP fault injection remains visible as runtime findings even when the corrected
  UI recovers. A matched recovery expectation does not turn an observed 503 or
  transport failure into an application PASS.

## Repeatable commands

From the source checkout:

```powershell
mix escript.build
npm run lab:adversarial
# Optional bounded workload / local starting port:
npm run lab:adversarial -- --cycles 3 --port 65324
```

The command creates a fresh ignored workspace, copies both fixture source trees,
records source inventories and executes twenty cases. It does not install
dependencies, modify the originals or commit anything. The browser driver and
Chromium must already be installed. Fixtures bind to loopback; the command owns
and stops its test servers. An existing service on the selected port causes a
visible readiness failure rather than being killed.

Run the evidence corpus against a complete clean saved report:

```powershell
node scripts/adversarial-reports.mjs <path-to-clean-vibeguru-findings.json>
npm run check
python scripts/context-map.py
```

The dashboard discovers campaigns and corpus/test suite records automatically.
The registry has declarative matches for each new vector. Planned next vectors
are sustained responsiveness, storage resilience, session expiry and conflicting
multi-client writes; they have no exercised coverage claim.

## Next experiments

Final source verification: `npm run check` passed formatting, compilation with
warnings treated as errors, **195 Elixir tests plus one doctest**, and **138 Node
tests**. The first combined check also caught a synthetic test fixture missing the
cycle phase now required by the hardened contract; the fixture now matches actual
driver evidence, and the final rerun passes. Failed test history remains retained.

The dashboard distinguishes a matched negative assertion from matched recovery
behavior with zero failed assertions and remaining runtime findings. Neither case
is relabelled as a clean application. The registry, activity notes, context graph
and source freshness indicators reflect this iteration.

Real Chromium dashboard QA passed against **129 saved cases**, including the
latest twenty-case campaign, all three new vector matrix drilldowns, fifteen
artifact links, an observed SSE refresh, filter combinations and change-group
state across refresh. All four panels and the case drawer fit a 390px viewport.
A hidden table accessibility label had escaped its scroll container and widened
the mobile page; positioning that container fixes the overflow while preserving
horizontal table scrolling. The QA record and screenshots remain under ignored
`reports/dashboard-browser-qa.json` and `reports/dashboard-*.png`.

Prioritize storage corruption/quota and delayed cancellation on the new fixture,
then a two-client version-conflict backend with a declared reconciliation policy.
Measure responsiveness in a separate browser pass without forced-GC marks. Bring
these adapters to an additional independently maintained app before claiming broad
product accuracy or autonomous discovery. Recovery from an ambiguous lost write
response, durable persistence, session expiry and long outages remain untested.

The final campaign and validation aggregates are retained beside this narrative in
`adversarial-evaluation-results.json`; raw source, server logs and detailed reports
remain private under ignored `reports/`.
