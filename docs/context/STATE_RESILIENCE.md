# Storage resilience, two-client conflicts and evidence integrity

Implementation date: **10 October 2026, Asia/Calcutta**. This extends
[ADVERSARIAL_EVALUATION.md](ADVERSARIAL_EVALUATION.md). All work is local and
uncommitted. Original Desktop projects remain unchanged.

## Implemented behavior

Two additional dependency-free fixture apps bring the bundled matrix to four
apps, thirty-six cases and thirteen implemented vectors. These are authored
vulnerable/corrected implementations with supplied expectations. No new naturally
occurring customer defect, autonomous discovery or automatic source repair is claimed.

### Storage resilience

`test-app/storage-workbench/` hosts an editor in a same-origin iframe. Each cycle
seeds a fresh draft namespace in real localStorage, cold-loads the editor, exercises
an explicit edit/save, retries after controlled exception removal, then cold-loads
again to read the persisted draft. The host document never reloads.

Five scenarios run in both vulnerable and defensive modes:

| Condition | Required behavior |
|---|---|
| Valid stored draft | Preserve initial content, save an edit and retain it across a cold load |
| Truncated JSON | Usable empty editor, visible recovery notice, original bytes preserved until explicit save |
| Wrong schema | Same explicit recovery policy; parsing JSON alone is insufficient |
| Denied access | Catch read/write exceptions, retain input, show unsaved warning and allow an explicit successful retry |
| Quota exception | Never claim a failed write was saved; retain input and verify retry by independent readback and a cold load |

Corruption uses actual persisted bytes. SecurityError and QuotaExceededError are
key-scoped injected DOMExceptions, **not actual browser quota exhaustion or an
operating-system permission change**. A separate canary key proves other storage
remains usable. A final `storage-recovery-contract` assertion follows seed,
cold-start and condition-delivery prerequisites. Missing editor JavaScript remains
an infrastructure error; it cannot satisfy an expected app failure.

Independent host readbacks immediately after the first save must still contain the
old target bytes when a write was blocked. The canary must survive the failed save,
retry and cold load. Destructive-handler regression controls prove that an eventual
successful retry cannot hide deleted original bytes or unrelated storage. The
startup, write and retry sub-outcomes remain visible; the combined final assertion
does not identify a single root cause.

Cleanup removes only the cycle's draft/canary keys and iframe, proves their absence,
allows two animation frames plus 100ms idle, and verifies a single remaining
frame before sampling. Failed cleanup aggregates with an existing assertion error
and retains the specific cause in `storage-cleanup-error` evidence. Diagnostic-sink
failures also remain execution failures.

Initial real-engine calibration sampled one detached editor document before its
renderer teardown finished, producing a heap-growth finding on a corrected case.
The earlier result is retained under `reports/storage-calibration-1791570883407`.
After the explicit idle barrier, the repeated three-case calibration at
`reports/storage-calibration-1791570963623` produced normal PASS, corrupt-draft
FAIL and corrected denied-access PASS, all with `retentionInvalid=false`.
No analyzer threshold or finding was suppressed.

### Multi-client write conflicts

`test-app/conflict-workbench/` uses real local HTTP, a versioned in-memory document,
committed history and an attempted-write ledger. Client A edits the title; B edits
the note. Both start at version 1 in separate browser contexts.

- The serialized control reloads the latest version before the second edit.
- The stale condition acknowledges A's save, then submits B's old full snapshot.
- The reversed condition acknowledges B first, then submits A's old snapshot.

The vulnerable backend accepts stale full-document writes and silently loses the
first client's field. The versioned backend atomically rejects a stale base with
HTTP409. Its UI preserves the pending local field and exposes explicit Reconcile:
reload latest, merge only that dirty field, then make a new version-checked save.
Both visible clients must converge to the independent final server document,
which must preserve both edits. `both-edits-preserved` is the final invariant,
after six protocol, draft, history and convergence prerequisites.

These are acknowledged stale-write schedules, not a claim that every browser
request overlaps. Unit tests separately exercise concurrent server version checks.
The merge policy covers distinct fields; same-field automatic resolution,
distributed databases, durable transactions and lost acknowledgements remain out
of scope. The engine observes the primary page. The adapter retains runtime events
from both clients and rejects unexpected errors rather than hiding them.

The first adapter design reloaded the primary document and would invalidate
retention. It now uses the fixture's native Open document action at a stable URL.
Cleanup closes B, proves an empty namespace, resets A and waits a bounded idle
period. Negative failures use the driver's normal post-cleanup sample.

## Three additional false-PASS cases fixed

The corruption corpus now has thirty-three cases. On a saved complete flow report,
two newly added corruptions incorrectly remained PASS:

1. A journey completion was labelled as baseline evidence.
2. A journey completion claimed `completed=true` while carrying an execution error.
3. All journey completions and both copies of their protocol flag were removed.

The failing **30/32** before-state is retained in
`reports/adversarial-evidence/1791570625381-2ac76c85.json`; the first corrected
**32/32** rerun is `reports/adversarial-evidence/1791570682761-fa8bf526.json`.
The engine and persisted-report reader now require cycle-phase completion and
consistent success/error metadata. The campaign scorer also rejects misplaced
assertions and completions. Known failed assertions remain FAIL even when other
evidence is incomplete; invalid completion cannot establish clean execution.

Independent review exposed the third bypass after the first thirty-six-case run.
Its **32/33** before-state is
`reports/adversarial-evidence/1791571528458-d8313a37.json`; the corrected **33/33**
rerun is `reports/adversarial-evidence/1791571627484-f91d2152.json`. Every schema-2
flow now requires the supported protocol and observed completion records. Removing
the flag no longer makes an incomplete flow look like legacy-compatible success.
Auto-crawl runs do not require flow completions. Test fixtures now emit the actual
current flow protocol; tests can explicitly omit it to verify conservative results.

## Owned test servers

The runner now checks exclusive loopback port availability before spawning a
server. An occupied port fails visibly and leaves the existing process running.
Bundled Node fixtures also emit a per-run instance and port from their own listen
callback; that handshake must arrive before HTTP readiness can succeed. The child
must still be running after the successful HTTP request. Capsules retain these
startup conditions and server logs retain the handshake. Non-fixture Desktop
runtimes receive the port preflight and HTTP/child check, without claiming the new
fixture handshake. A real occupied-listener regression exercises the runner.

## Dashboard and repeatable workflow

The registry marks storage resilience and conflicting writes implemented.
Sustained responsiveness and session expiry remain planned. The overview displays
every exercised vector, including new entries beyond the previous eight-row cap.

Vector cards now graph only their mapped target assertions, separately from
whole-app verdicts and all assertions in associated cases. Each declared cycle
must have exactly one correctly placed passing/failing record; missing, duplicated
or misplaced records appear unverified. These are supplied-check counts, not
independent defect-discovery accuracy or a percentage of business rules verified.

```powershell
mix escript.build
npm run lab:adversarial
npm run lab:adversarial -- --suite state --cycles 6
npm run check
python scripts/context-map.py
```

The full matrix runs thirty-six cases; `--suite state` selects sixteen. Every run
creates new ignored source copies and updates the local dashboard as cases finish.
The default four ports are 65324–65327. No original app is edited and no existing
listener is killed to claim successful startup.

## Final campaign evidence

Final campaign: `campaign-1791571664078-9ed62316`, in the ignored workspace
`reports/adversarial-evaluation-1791571663998`. The earlier full calibration is
retained separately at `reports/adversarial-evaluation-1791571137693`.

| Scope | Cases | App PASS | App FAIL | INCONCLUSIVE |
|---|---:|---:|---:|---:|
| Earlier navigation, HTTP recovery and duplicate-write matrix | 20 | 10 | 8 | 2 |
| Storage resilience | 10 | 6 | 4 | 0 |
| Two-client edit conflicts | 6 | 4 | 2 | 0 |
| Full matrix | 36 | 20 | 14 | 2 |

All **34/34 declared outcomes matched** across **216 attempted cycles**, with zero
execution/report errors. Two deliberate interruptions remained INCONCLUSIVE.
The campaign recorded **876 passing and 72 expected failing assertions**. All
corrected storage and conflict cases were App PASS. The two corrected HTTP cases
still retain their deliberately induced runtime faults and remain App FAIL despite
passing recovery assertions; expectation match is not app correctness.

Every case had stable execution-source hashes and `retentionInvalid=false`.
Independent readbacks verified **60 storage namespace/frame cleanups** and **36
conflict namespace/client cleanups**. All **36 owned-server startup proofs** were
present. The separate case graphs contain **2,661 nodes and 2,937 resolving edges**,
including **708 structured experiment observations**; identifiers were unique
within each graph. These totals are recorded observations, not independent apps
or customer samples. Source inventory verification passed for the copied fixtures
and both earlier Desktop manifests.

The portable case table, state sub-outcomes and limitations are retained in
[state-resilience-results.json](state-resilience-results.json). Raw reports,
capsules, logs and copied sources remain under ignored `reports/`.

## Final verification

`npm run check` passed formatting, compilation with warnings treated as errors,
**197 Elixir tests plus one doctest**, and **160 Node tests**. A fresh corruption
run against the final campaign passed **33/33** cases; its retained record is
`reports/adversarial-evidence/1791571998382-7205533f.json`.

Real-browser dashboard QA passed against **209 saved cases**. It exercised all
five current experiment-matrix drilldowns and target-assertion charts, inspected
seven cases, opened thirty-five artifact links, observed a live SSE refresh, and
verified filters and preserved change groups. All four panels and the case drawer
fit a 390px viewport, with wide tables scrolling inside their containers. No
browser errors were recorded. The QA record and inspected screenshots remain in
ignored `reports/dashboard-browser-qa.json` and `reports/dashboard-*.png`.

## Next experiments

Add session expiry with authorization and side-effect invariants, then measure
sustained responsiveness in a separate browser pass without forced GC. Extend an
existing independently maintained app with the new checks before claiming broad
coverage. Real quota exhaustion, session refresh, multi-tab storage events,
same-field reconciliation, durable persistence and repeated conflicts remain
unverified. Jev planning, adaptive scenario selection and automatic repair remain
proposed; adding fixtures does not implement those capabilities.
