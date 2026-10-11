# Local launch preparation — 11 October 2026

## Authorized scope and status

At the time of launch preparation, the founder handled repository privacy and
pushing and all application changes remained uncommitted and unstaged. Later on
11 October the founder explicitly authorized source review, commit and push; see
[GIT_SYNC.md](GIT_SYNC.md). Repository visibility and release publication are separate.
The separate minimal website is prepared locally
at `C:/Users/Shashank/vibeguru-website`; no remote repository or deployment was
created. Original Desktop applications are unchanged. This is launch preparation,
not a declaration that the product or native release is finished.

The founder created US PostHog project **658479**:
<https://us.posthog.com/project/658479/home>. The project URL is not an ingestion
credential. The founder later supplied its public Project API key in the ignored
`hogpostkey/hogpostkey.env` file. Local activation is recorded below; the key is not
embedded in source. A personal administrative API key is neither requested nor
embedded. Browser control stopped
because it could not verify the current Windows browser URL; no account changes
were made through it.

## Implemented behavior

- Default-off product analytics through the Node CLI wrapper and MCP. Explicit
  consent, disable/status commands, random installation/run IDs and voluntary
  feedback. Allowlisted counts, enums and timings only; no app content, generated
  output, report bodies, routes, URLs, paths, credentials or error text. Optional
  self-reported audience/use-case/team-size categories help discover the audience.
- Fresh schema-2 reports and actual verdicts drive completion metadata. Old,
  invalid or missing reports cannot become successful analytics. CLI/MCP do not
  duplicate a run. Short bounded transport, no persisted event queue; lost delivery
  remains possible. Tests and package verification suppress live collection.
- `doctor` checks Node, target platform, engine/header/cache, launcher, driver and
  Chromium prerequisites without installing. Local source and future customer
  steps for CLI and MCP are in `docs/GETTING_STARTED.md`.
- The npm file allowlist includes customer runtime and installation/privacy guides;
  internal lab, dashboard, source graph and Python caches are excluded. Fresh
  tarball verification enforces this boundary against actual packed files.
- Local portal: CLI/MCP tabs, platform availability and privacy summary. The
  unpublished release manifest gates downloads and command copying. No website
  tracking, accounts, database or external scripts are needed.
- Test-duration analytics: full-check wall clock plus stage records; per-suite
  median/p95/history and browser timings grouped by application/scenario/cycles.
  Parent and child durations are never summed. Incomplete runs are separate and
  source freshness remains visible. Package smoke now records elapsed time.

## Security changes and evidence

Review retained under `reports/security-review-2026-10-11/SECURITY_REVIEW.md`.

- Downloads: strict HTTPS without URL credentials, bounded bytes, whole-operation
  timeout across redirects, exclusive temporary files and explicit GitHub release
  host allowlist. SHA256SUMS has a smaller cap than binaries.
- MCP: URL mode avoids config execution; config-driven server commands/flows
  require `allow_project_execution:true` before setup/download. A repository is
  not automatically trusted because it is readable.
- Elixir driver: private random scratch directory, exclusive config creation,
  cleanup after success/failure. Authentication session writes are atomic, linked
  session directories are rejected, Unix files/directories use 0600/0700.
- Root and driver npm production audits reported zero known advisories on this
  date. Selected npm package text screening found no secret-pattern matches.
  Hex retirement checks found no retired dependencies; this is not an advisory
  audit of the Erlang/Elixir dependency graph.

No hidden exfiltration endpoint or backdoor was confirmed in reviewed production
paths. This is not zero-day certification. Windows ACL hardening and the Unix-only
permission/symlink tests remain unverified on this Windows host. Explicit CLI
commands and imported flows are full-privilege local code. Reports/sessions can
contain sensitive data. Same-origin release checksums do not independently prove
publisher identity; mutable CI action tags and external runtime CDN remain
supply-chain trust dependencies.

Independent review additionally caught and fixed environment consent overriding
saved opt-out, and coercible non-string UUID values crossing the metadata boundary.
Regressions use mock transports; no app data was sent during the review. One full
check retained a 3-second initial browser-navigation timeout. The scenario passed
alone; the test runner now limits file workers to four rather than one per CPU
core, without changing scenario deadlines. Final rerun evidence is separate from
the retained failure.

## Distribution decision still required

The main repository's current GitHub release URLs become inaccessible to anonymous
users when the repository is private. A private website source repository does
not solve artifact delivery. Keep download gates disabled until stable public
native artifacts, checksums and exact-build smoke evidence exist and the npm
installer/release gate point to the reviewed host. Do not embed a PAT.

Local Windows escript/tarball checks require Erlang and do not establish native
support. Native build/smoke gates for all advertised targets remain required.
The user has retained all Git publication work; no native release or npm package
is published by this task.

## Analytics interpretation and activation

PostHog free Product Analytics currently includes one million events/month and
one-year retention, with no card required. Keep collection small; configure
retention/deletion contact before beta distribution. [Official pricing](https://posthog.com/product-analytics/pricing), checked 11 October 2026.

The integration uses the official ingestion endpoint `POST /i/v0/e/` at
`https://us.i.posthog.com` or its EU equivalent. [Capture API](https://posthog.com/docs/api/capture), checked 11 October 2026.

On 11 October the founder supplied the public token. Consent/config is saved in
the normal per-user configuration outside the repository, shared by local CLI/MCP
launches using that profile. The entire key folder is ignored; the npm package's
allowlist excludes it. Other installations remain default-off.

A real local CLI run against the independent clean React fixture completed three
cycles and six explicit assertions with `PASS`. Production HTTPS transport accepted
both `vibeguru_run_started` and `vibeguru_run_completed` with HTTP 200 and matching
run IDs. Total verification wall time was **13.917 seconds**; event requests took
3.236 and 4.828 seconds. The record is
`reports/posthog-activation-2026-10-11/attempt-3/summary.json`. No app content or
key was printed or included in this record. This is founder fixture activity, not
customer adoption evidence.

The original 800 ms analytics deadline dropped the first validation events; a
three-second attempt accepted completion but timed out at start. Both failed
verification attempts remain recorded in the parent directory and `attempt-2/`.
The transport now has a five-second per-event deadline, no retry or disk queue.
Slow or blocked analytics still cannot alter the app verdict. Opted-in CLI/MCP
calls await lifecycle events and can incur up to ten seconds of additional wait
across two events. The regression check covers a successful connection beyond the
old deadline and bounded failure of a hung connection.

Endpoint acceptance alone does not prove an insight has updated. The capture token
cannot read/administer PostHog. The connected OAuth agent subsequently created the
unshared [Vibe Guru Usage dashboard](https://us.posthog.com/project/658479/dashboard/2197466)
and forced recalculation of all eight saved insight tiles without errors. Two
interpretation cards explain founder fixtures, missing optional categories and
delivery limits. The run-ID table independently retains one orphan completion and
two paired MCP execution errors; those categories cannot identify the error cause.
See [POSTHOG_DASHBOARD.md](POSTHOG_DASHBOARD.md) for live verification and saved IDs,
and [TELEMETRY.md](../TELEMETRY.md) for collection semantics. No customer adoption
or feedback accuracy is established by this data.

An installation ID is not a person or project. FAIL often means Vibe Guru found
an application problem. A feedback confirmation is a run-level judgment, not a
per-finding accuracy label. Opt-in users are a biased audience sample. Generated
content and exact app identities are intentionally not collected; learn use cases
through optional categories and voluntary customer conversations.

## Maintenance

Use `npm run check`, the actual tarball/browser/MCP smoke, portal checks and browser
QA after relevant changes. Read `TEST_TIMING.md` for measured durations and limits.
Update activity/context after implementation and refresh the context graph. Do
not use test duration or a passing control to claim comprehensive security or
general application correctness.
