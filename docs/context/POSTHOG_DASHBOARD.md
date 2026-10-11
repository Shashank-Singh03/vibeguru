# Vibe Guru usage dashboard — 11 October 2026

The connected PostHog OAuth tools verified US project **658479**, named **Default
project**, in organization **shashank singh** (`01a12b24-e670-0000-106e-2dfc78806cf1`).
The project uses UTC. The founder authorized dashboard and insight creation; no
public sharing, flags, billing or account permissions changed.

**[Open Vibe Guru Usage](https://us.posthog.com/project/658479/dashboard/2197466)**
— dashboard ID **2197466**, unshared, with a last-30-days default.

The dashboard contains eight verified insights and two interpretation cards.
Seven native Trends queries cover active installations, completed CLI/MCP activity,
verdicts, check completeness, execution-error categories, wrapper/engine duration
p50/p95 by mode and cycles, and active installations by framework. A SQL table
deduplicates and pairs lifecycle events by `run_id`, retaining orphan terminals.
It has an explicit rolling 30-day cap; dashboard filters can narrow that window.
It is receipt coverage, not a person-based funnel or confirmed failure rate.

| Insight | Numeric ID | Short ID |
| --- | --- | --- |
| Active installations — completed runs | 12750831 | BuJPb3fj |
| CLI vs MCP completed activity | 12750836 | eo4A6ii4 |
| Runtime verdicts | 12750837 | huDCs9Ty |
| Check completeness over time | 12750838 | LA5TeXb6 |
| Execution errors by category | 12750839 | NfyLuzNm |
| Duration p50/p95 — wrapper and engine | 12750840 | moNMx182 |
| Active installations by framework | 12750841 | cN6BHWwh |
| Run lifecycle coverage — last 30 days | 12750842 | VK0tAzYc |

## Verified receipt, not adoption

At **16:11 UTC on 11 October**, live data contained **seven Vibe Guru events** from
**one installation ID**: three starts, two CLI completions with PASS, and two MCP
execution errors. All observed activity is founder-controlled fixtures and
attempts. The error category is `execution`; privacy-limited events have no text
or stack, so they do not identify the cause.

Four run IDs were observed. One received start pairs with a completion, two starts
pair with execution errors, and one completion has no received start. No received
start lacks a terminal event in this sample. There are no duplicate or conflicting
lifecycle records. These statements concern delivery within the selected window;
missing delivery and interruption remain possible.

Both completions report React, flow mode, three cycles and tool version 0.2.0 on
Windows. Their reports contribute eight complete checks, zero partial and zero
unavailable checks. Wrapper durations are 5,300 and 5,400 ms: p50 **5,350 ms**, p95
**5,395 ms**. Both engine durations are **3,200 ms**. Wrapper time excludes initial
and terminal analytics delivery. Two founder fixture runs are not a benchmark.

No `vibeguru_feedback` event or optional audience, use-case or team-size property
was present in the live taxonomy. The dashboard records this dated absence and
labels categories **not provided**. It does not claim those charts were verified,
and no synthetic events were sent to fill them. Add their insights only after
real events/properties can be discovered and validated.

Installation IDs identify consenting installations, not people, customers or
projects. Opt-in collection creates sampling bias; re-enabling consent creates a
new ID. FAIL means detected tested-app problems, not automatically Vibe Guru
failure. Voluntary run-level feedback is not per-finding accuracy. The dashboard
includes these interpretation limits. The governed catalog was empty through
the permitted `system.information_schema.metrics` query; derived metrics are
explicitly noncanonical. The dedicated catalog tools lack `data_catalog:read` and
no catalog write or approval is claimed.

## Verification and maintenance

Each query was validated before saving; every saved insight was queried again.
`dashboard-insights-run` then forced recalculation of all eight saved insight
tiles with no errors and null warnings. A final dashboard read confirmed all ten
tiles, the saved date filter, no overlapping grid boxes, and `is_shared: false`.
This was connector-level data and metadata verification, not browser screenshot QA.

The token-free record is
`reports/posthog-dashboard-2026-10-11/verification.json`. It retains actual saved
IDs, query outputs, counts and limitations without OAuth tokens, project tokens,
account email addresses or raw application content. Original event records and
unrelated generated web-analytics insights remain intact. No application source
behavior changed in this dashboard task. Repository checks remain separate from
live PostHog verification and must not be inferred from dashboard freshness.

Use the existing dashboard and insight IDs for updates to avoid duplicates. Query
live events and schema again before extending optional breakdowns. PostHog's
[Trends documentation](https://posthog.com/docs/product-analytics/trends/overview),
[dashboard filters](https://posthog.com/docs/product-analytics/dashboards#dates-and-filters)
and [SQL filter placeholders](https://posthog.com/docs/data-warehouse/sql/variables#applying-dashboard-filters)
were consulted through the app's documentation tool.
