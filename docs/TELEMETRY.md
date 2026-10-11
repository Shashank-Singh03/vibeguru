# Optional usage reporting

Vibe Guru's usage reporting is **disabled by default**. Normal CLI and MCP runs
work without a PostHog account, a token, a network connection to analytics, or
consent to analytics. Installing the package never opts a user in.

After a person explicitly enables reporting, Vibe Guru sends small, allowlisted
metadata events to PostHog Cloud. It uses the public write-only **project token**;
never enter a personal or administrative API key. The token can be configured at
runtime, so activating a beta project does not require rebuilding the engine.
The founder supplies the beta project's public token and region to participating
users. Users do not need to create their own PostHog accounts.

## Enable, inspect and disable

Replace the placeholder with the founder-provided public project token:

```sh
vibeguru telemetry enable --key phc_YOUR_PUBLIC_PROJECT_TOKEN --host https://us.i.posthog.com
vibeguru telemetry status
vibeguru telemetry disable
```

The EU alternative is `https://eu.i.posthog.com`. Only these exact HTTPS hosts
are accepted. The implementation does not accept custom endpoints, redirects,
self-hosted collectors or insecure HTTP. Enabling persists explicit consent, the
public token, region and a random installation UUID in the user's config folder.
Disabling removes the local token and UUID. Re-enabling creates a new identity;
it does not delete events already held by PostHog.

Optional self-reported categories can be supplied during enable:

```sh
vibeguru telemetry enable --key phc_YOUR_PUBLIC_PROJECT_TOKEN --audience agency --use-case internal_tool --team-size 2_5
```

Allowed values:

| Field | Values |
| --- | --- |
| `--audience` | `solo_developer`, `product_team`, `agency`, `consultant`, `student`, `other` |
| `--use-case` | `dashboard`, `internal_tool`, `ecommerce`, `content`, `other` |
| `--team-size` | `solo`, `2_5`, `6_20`, `21_plus` |

All three are optional. There is no free-text collection field.

Config locations:

- Windows: `%APPDATA%/vibeguru/telemetry.json`.
- macOS/Linux: `$XDG_CONFIG_HOME/vibeguru/telemetry.json`, or
  `~/.config/vibeguru/telemetry.json` when XDG is unset.
- `VIBEGURU_CONFIG_DIR` overrides the config directory for isolated installations.

For ephemeral environments, explicitly set `VIBEGURU_TELEMETRY=1`,
`VIBEGURU_POSTHOG_KEY` and optionally `VIBEGURU_POSTHOG_HOST`. A key alone never
enables reporting. Environment-only installations without a saved UUID use a
per-process random ID; do not interpret their returning-installation counts as
people or stable CI identities.

An explicit `telemetry disable` also overrides `VIBEGURU_TELEMETRY=1` inherited
from a shell or CI environment. Only a deliberate `telemetry enable` clears that
saved opt-out. `DO_NOT_TRACK=1` and `VIBEGURU_TELEMETRY=0` override consent and disable collection.
Node's test context also disables collection. Repository tests inject mock
transports and send no real analytics.

## Data sent

| Event | Purpose and properties |
| --- | --- |
| `vibeguru_run_started` | Random run UUID, CLI/MCP channel, supported command enum |
| `vibeguru_run_completed` | Same run UUID; independently reassessed verdict; schema; measured mode/framework enums; cycles; route counts; finding/blocking counts; evidence count; assertion counts; validity-status counts; durations |
| `vibeguru_run_error` | Same run UUID; bounded error-category enum; duration; `ERROR` verdict. No error message or stack |
| `vibeguru_feedback` | Run UUID and `confirmed`, `dismissed`, `helpful` or `not_helpful` enum |

Each event also has tool version, operating system/architecture enum, Node major
version, an explicit CI boolean and optional audience categories. Counts are
bounded at one million, durations at 24 hours and rounded to 100 ms. This keeps
payloads small and rejects arbitrary data even if a report has unknown fields.

Vibe Guru **does not upload** source code, generated content, report bodies,
URLs, route names, filesystem paths, project names, account identifiers,
credentials, tokens from the tested app, runtime messages, stacks, screenshots,
DOM content or heap snapshots. It does not inspect what the tested app generates.
There is no browser autocapture, session replay, cookie or location tracking.
PostHog person profiles and GeoIP enrichment are explicitly disabled in event
properties. As with any HTTPS service, PostHog still receives the connection's
network address; do not describe this as fully anonymous or IP-free.

An installation UUID identifies a consenting installation, **not a person**.
No stable project identifier is currently collected. Do not interpret repeated
runs as repeated distinct customers, projects, confirmed bugs or money saved.

## How timings and conclusions work

`duration_ms` measures the CLI wrapper's analysis invocation, including setup
and automatic app startup when applicable, or the MCP analysis call. It excludes
the initial analytics request and terminal event delivery. When present,
`engine_duration_ms` is the engine's actual `run.durationMs` from the report.
Neither is a benchmark guarantee: app, cycles, routes and environment affect time.

The completion event uses the real schema-2 report and the existing report
assessor. CLI reporting requires a freshly changed report matching the exit code;
an old report is never submitted as a new successful run. A malformed, absent,
oversized (over 16 MiB), or exit-mismatched report yields an analytics error event.
That telemetry classification never changes the analysis result or CLI exit.
Directly invoking an Elixir escript/native binary bypasses the Node telemetry
wrapper; instrumented entry points are `vibeguru run`, `vibeguru memory:client`
and MCP `verify_runtime`.

Started runs without a terminal event are **potentially interrupted or missing
delivery**, not confirmed execution failures. Forced termination can prevent any
terminal event. Events are best effort, have an 800 ms transport deadline,
use a bounded in-memory queue, and are not retried or saved to disk. A blocked
endpoint, offline session or quota problem can cause missing data. MCP writes
protocol frames only to stdout; analytics writes nothing there. The CLI and MCP
paths do not double-count the same engine run.

## Feedback and useful founder charts

An enabled completed run shows a random run ID. To report a judgment:

```sh
vibeguru telemetry feedback --run RUN_UUID --kind helpful
vibeguru telemetry feedback --run RUN_UUID --kind confirmed
```

Feedback is voluntary and run-level. A `confirmed` response does not establish
that every finding was correct. A successful HTTP ingestion response means the
endpoint accepted the request, not that a PostHog chart has already updated.

In the founder's PostHog project, create:

1. A trend of distinct installation IDs with completed runs, grouped by channel,
   audience and framework. Label it **active installations**.
2. A started → completed funnel, segmented by tool version and operating system.
   Investigate error-category trends separately; account for missing delivery.
3. A distribution of analysis duration with median and 95th percentile, segmented
   by mode and cycle count. Keep engine duration separate from wrapper duration.
4. A verdict breakdown and incomplete-check trend. FAIL means problems found in
   the tested application; it is not automatically a failure of Vibe Guru.
5. A count of each feedback kind and returning installations. Do not report
   detection accuracy without confirmed per-finding ground truth.

No founder PostHog charts are provisioned by this local code change. Connecting
the real public token and checking a deliberately opted-in smoke event are
separate activation steps. For a production beta, provide a public privacy notice
with the operator, purposes, retention/deletion contact and third-party processing
details; the local config cannot delete historical server-side events.

Implementation uses the currently documented single-event endpoint and payload:
[PostHog Capture API](https://posthog.com/docs/api/capture), checked 11 October
2026. The endpoint is `POST /i/v0/e/`, with `api_key`, `distinct_id`, `event`,
optional properties and timestamp. The public token is intended for ingestion;
it cannot authorize reading analytics or administering the project.
