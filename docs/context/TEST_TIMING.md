# Measured test timing — 11 October 2026

Final source revision: `e115945177fa2dd8b325325e01d0801a90ffba7453d5e76249052f40998de9cb`. Full check and package smoke match this
revision; no main-repository files were staged, committed or pushed.

## Final full repository check

`npm run check` passed in **28.43 seconds** on Windows x64,
Node v24.0.0. This is wall-clock duration including stage/recording overhead.

| Stage | Wall time | Result |
| --- | ---: | --- |
| Formatting | 0.99 s | PASS |
| Compile | 1.86 s | PASS |
| Elixir command | 11.60 s | PASS |
| Node command | 13.86 s | PASS |

Elixir: **203 tests plus one doctest**, zero failures, four explicitly skipped
Unix permission/symlink checks. The recorder includes the doctest in 204 total
records: 200 passed and four skipped. Node: **188 tests, 188 passed**.
Nested ExUnit and Node recorder durations are not added to parent command times.

## Fresh package, CLI, browser and MCP

The actual npm tarball was installed in a separate temporary directory and passed
12 named checks in **192.68 seconds**
(3.21 minutes), before final scratch cleanup.
It contains **30 files**, 58.4 KiB compressed, excluding dependencies,
native engine and Chromium. Internal lab/dashboard/context scripts and caches are
excluded. Actual installation/CLI command timings are retained in the JSON proof.

This is a Windows **escript** test using locally installed Erlang and a freshly
built engine. npm install scripts were intentionally skipped; the reviewed engine
was supplied explicitly. Browser and npm download caches may be warm. It does not
prove native packaging, anonymous release downloads, cold network installation or
other operating systems. Optional telemetry was explicitly disabled throughout.

The smoke checks include doctor, init, defective fixture FAIL, clean flow PASS,
failed-flow INCONCLUSIVE, execution ERROR, usage64, real stdio MCP handshake and
verification, filtered-verdict preservation and the production-package boundary.

## Retained failures and historical analytics

An earlier complete check retained one initial-page navigation timeout at a
three-second fixture deadline. The same scenario passed alone. The Node runner
now limits file workers to four, rather than one per CPU core. Scenario
observation/assertion deadlines were unchanged. The final full run passed. The
earlier failed record remains visible; a rerun does not erase it.

Dashboard timing currently includes **101 browser case samples in
43 comparable groups**, separated by app, scenario and cycle count.
**123 cases** have incomplete or unknown assessed scope and are excluded
from completed-scope duration samples. A FAIL can still contain incomplete work.
This task did not rerun every historical Desktop campaign.

Full-check records are measured directly, so nested suite logs are never double
counted. Elixir runs without explicit repository scope are grouped by test count
and labelled unknown; focused subsets are not treated as full-suite benchmarks.
Historical local measurements vary with source, cache and machine load. p95 uses
nearest rank and often equals the maximum with fewer than twenty samples.

## Where to inspect

- [Live timing dashboard](http://127.0.0.1:4545/#changes).
- [Complete verification JSON](launch-preparation-verification.json).
- Local suite records/logs: `reports/test-history/`.
- Actual package proof: `reports/package-smoke-win32-x64.json`.
- Package console log: `reports/security-review-2026-10-11/package-final.log`.
- Local website QA: `C:/Users/Shashank/vibeguru-website/reports/qa.json`.

Product usage reporting is separate: default-off PostHog metadata, awaiting the
public project token and an explicitly opted-in live smoke. No user/customer
analytics are claimed collected. See [../TELEMETRY.md](../TELEMETRY.md).
