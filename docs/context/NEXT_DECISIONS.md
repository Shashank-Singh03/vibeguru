# What to sell, what to freeze, and what to test next

**Audience and ambition update, 9 October 2026:** the founder rejected the small audience implied by a diagnosis service. Read [PRODUCT_THESIS.md](PRODUCT_THESIS.md) first for the broader developer/team runtime regression product hypothesis. The service below is now an optional learning/onboarding route, not the recommended long-term business identity. Technical cautions, test-environment guidance and current capability limits remain applicable.

Decision review: **8 October 2026, Asia/Calcutta**. Written after the founder clarified that the priority is product direction, buyer selection, architecture restraint, test environments and vector choices. This supersedes the previous default agency health-check recommendation. This turn changes strategy/context documents only; the earlier UI is not the next investment priority.

The recommendation below is judgment to test. Repository observations are established by source inspection; competitor capabilities by the linked primary sources. There is still no evidence of paying demand, a confirmed external defect/fix, or repeat purchases.

## 1. The starting business

**Sell a bounded investigation of a React application that becomes worse with repeated use. Start with a small B2B product team already experiencing the problem.** Vibe Guru supplies measurements; the founder supplies reproduction, interpretation and a reusable regression check.

The initial paid outcome is: “Your reported slowdown has a repeatable test, reviewed evidence, a prioritized debugging path, and a comparable check after your developer changes the app.” A guaranteed root cause or fix is beyond current demonstrated capability.

The earlier agency-first choice favored easy prospect discovery. That does not establish a buying trigger. An active user complaint is a stronger proposed trigger. Agencies remain a secondary channel when they have the same concrete problem in a client app.

| Priority | Prospect | Buyer | Purchase trigger |
|---|---|---|---|
| First | Small B2B SaaS team with a React dashboard, CRM, reporting tool, admin app or editor | Technical founder, CTO or engineering lead | Paying users report a tab that slows, freezes, grows in memory or crashes after a specific sequence or sustained session |
| Second | React application agency with a client escalation | Agency technical lead or owner | A delivered application degrades in use and the team has not isolated the problem |
| Product testers | Developers with a suitable application and existing tests | Engineer adopting the CLI/MCP | Evaluate usefulness and repeatability; adoption is not proof they will pay |

Qualify by symptoms and access rather than company size alone. The prospect should have an actual recent incident, a reproducible workflow or willing collaborator, representative data, an accessible test environment, and a developer who can act on findings. Brochure sites, vague “make it scale” requests and demands for complete autonomous QA are poor initial fits. Avoid incident-response commitments incompatible with part-time availability.

## 2. The paid deliverable and acquisition

Offer name: **React Repeated-Use Bug Investigation**.

- One application, one identified problematic workflow, one agreed build/data set.
- A Playwright reproduction with explicit expected outcomes.
- Human-reviewed runtime and retention evidence; ordinary DevTools/network traces where necessary to investigate slowdown.
- Confirmed observations, probable causes with supporting evidence, alternatives and unresolved questions.
- Prioritized next actions and one comparable rerun after the customer's change, within the agreed effort cap.
- Full remediation, inaccessible environments and extended investigation are separately scoped.

Start with the previously proposed **$300 / six total delivery hours** only as a founding-price experiment. First qualify access and reproduction; do not sell an unrestricted debugging promise. At six delivery hours this is $50/hour before acquisition and business overhead. It is a learning price, not demonstrated sustainable economics.

A website does not find this buyer. Start conversations around actual problems: support escalations shared by technical founders, engineering-community discussions, introductions from React freelancers/agencies, and public issue threads in commercially used React applications. Public issue posts indicate a symptom, not budget or consent to inspect a private application. Contact the relevant technical owner through their normal channel; no messages are sent by this document.

Use a short offer: “I investigate React screens that slow down after repeated use and leave the team a reproducible regression check. Is this still affecting your users, and have you isolated it?” Refer to an actual reported problem when contacting someone; do not invent one.

Each conversation should establish: last concrete incident, consequence, debugging already attempted, current workaround, person approving expenditure, safe test access, and a specific next step. A useful free result can still fail to validate demand. Allow at most two free investigations to obtain independent proof, then test payment.

The first case study should show the complaint, reproduction, evidence, confirmed change and comparable rerun. An injected defect is a benchmark and must be labelled; it is not a naturally discovered customer defect. If the investigation remains unresolved, record that outcome rather than manufacturing a cause.

The product path is **customer-owned repeated-use regression checks**: a saved workflow, comparable baseline, reliable CI result and actionable artifacts. Charge for recurring release checks only after teams actually request and pay to repeat this workflow. If purchases remain occasional, retain a diagnosis service with workable economics. A dashboard and subscription do not create repeat demand.

Current alternatives already supply substantial parts of this workflow: [Playwright traces](https://playwright.dev/docs/trace-viewer) include action/DOM/network inspection, and [MemLab](https://github.com/facebook/memlab) supports leak scenarios, retainer traces and heap analysis. The proposed advantage is less setup and interpretation work for this repeated-use problem. That advantage remains unmeasured. A token-efficient MCP interface alone is insufficient differentiation.

## 3. Jev and the architecture decision

**Building Jev now would be overengineering.** Keep the Evidence → Analyzer → Finding separation and the existing engine. Freeze automatic investigation integration, model policy, policy replay, a new general agent framework, additional UI and hosted execution. No rewrite of Elixir/Node is justified merely by the current buyer uncertainty; standardize service delivery on one known environment rather than expanding packaging support now.

Observed state:

- `Policy.Jev` is described in `docs/ARCHITECTURE-investigation.md` and `lib/vibe_guru/investigation/policy.ex`; there is no implemented Jev module.
- State, the budgeted loop, Rules, catalog and a focused snapshot runner exist separately from the normal pipeline.
- The catalog includes survey census and focused heap snapshots; allocation sampling and focused listener census remain unavailable.
- Snapshot summaries count constructors and shallow bytes. They are not implemented retainer paths or exact source-line attribution.

Specific reasons to keep the investigation path experimental:

1. `Snapshot.interpret` treats absent `heap_census` as empty growth, which can eliminate hypotheses without a valid measurement.
2. Focused snapshot capture does not establish valid route visits and successful GC before interpretation.
3. Finding a hinted Chart and growing Maps does not prove that every Map belongs to the Chart; the current interpreter can eliminate a separate cache hypothesis on that assumption.
4. Rules groups same-route siblings as explained, even though independent bugs can coexist on one route. Cleanup suggestions can derive from detected library hints.

These are measurement and causal-evidence gaps. A decision model cannot solve them by choosing the next probe. One failed probe must remain unknown. One growing constructor does not identify the retaining reference or source line.

For early cases, select probes manually and use DevTools/MemLab for deeper retaining-path analysis. Reconsider Jev only when repeated real investigations produce meaningful branching choices, manual probe selection is a measured cost, reliable probes exist, and a model improves useful outcomes against rules/manual choices on held-out cases within the same budget. A pinned model name does not itself establish repeatable decisions or calibrated confidence.

## 4. Where to test

There are two separate questions: what applications establish usefulness, and where execution should live.

| Test purpose | Application / location | What it establishes |
|---|---|---|
| Engine correctness | Existing clean/defect fixtures and source suites in local development/CI | Protocol behavior, expected signatures and incomplete-measurement handling |
| Independent app behavior | Local, version-pinned open-source applications with controlled data and authored journeys | Setup burden, legitimate retention, false alarms and framework/navigation gaps |
| Commercial usefulness | An authorized customer staging deployment or local production build with its real reported workflow | Whether the evidence advances debugging and the fix can be checked |
| Repeat regression | Customer's private CI or runner, initially scheduled/pre-release | Whether a focused test gives repeat value without bespoke founder effort |

Start external benchmarks with the community **react-admin e-commerce demo**: lists, filters, detail/edit views and chart widgets exercise a realistic admin workflow. Its source is linked by the [maintainers' demo documentation](https://github.com/marmelab/react-admin/blob/master/docs/Demos.md). Run a local copy; do not stress their hosted demo.

Then use a local **Excalidraw** editor workload: repeated create/delete/undo/redo operations, with a fresh controlled document. This is a distinct canvas/editor workload and needs an authored flow rather than automatic route assumptions. The [official repository](https://github.com/excalidraw/excalidraw) documents the editor, operations and MIT license. Neither application is claimed to have a defect; their purpose is independent evaluation.

For each application, record a normal warmed run, realistic repeated-use run and local deliberately defective/fixed variant where suitable. Legitimate caches can warm up and plateau. Judge signals against the observed behavior and source evidence. Measure confirmed findings, rejected findings, setup effort and debugging usefulness; compare equivalent work with ordinary Playwright/DevTools and MemLab as appropriate.

Use a production build for representative behavior; development/HMR remains useful for debugging. React Strict Mode intentionally adds development-only effect/render checks, which can change counts. [React documentation](https://react.dev/reference/react/StrictMode).

Run from the founder's machine where access permits, otherwise from the customer's machine/private CI. Keep sessions and full heap artifacts in the agreed environment. No hosted multi-tenant browser service is necessary to deliver this first offer. Playwright documents [customer-run GitHub Actions execution and artifacts](https://playwright.dev/docs/ci-intro).

Hold build, browser version, host, test account, data and workflow constant; use one browser worker for performance comparisons. Match the duration to the symptom: a roughly two-minute fixture survey does not evaluate a complaint appearing after an hour. Use fresh contexts for independent repetitions and compare candidate/baseline under the same conditions.

**Separate responsiveness from retention measurement.** Forced GC changes execution timing. Keep forced collections outside realistic action-latency windows and describe the two passes explicitly. Memory leaks, memory bloat and frequent GC are different performance problems. [Chrome guidance](https://developer.chrome.com/docs/devtools/memory-problems).

Journey checks need explicit user-visible assertions. Automatic navigation does not establish that a save, permission check or export succeeded. [Playwright guidance](https://playwright.dev/docs/best-practices). Initial performance tests should collect evidence before becoming merge-blocking thresholds; calibrate against repeated runs and adjudicated regressions first.

## 5. Adjacent vectors, in investment order

These are proposed additions, not already implemented capabilities or proven demand. Add one only when a real case reveals the gap.

| Priority | Addition | Measured outcome / purchase relevance | Cost / interpretation risk |
|---|---|---|---|
| First new stream | `performance.client`: workflow latency and main-thread/long-task evidence across repeated use | Connects the tool to “this screen gets slow” and helps distinguish CPU work from retained memory | Medium; workload/host/backend changes can dominate timing. Use comparable runs, realistic timing windows and traces. |
| Second | `network.client`: request duration, volume per action, repeated retries and polling after leaving a view | Explains duplicate requests, backend-wait symptoms and retry storms | Low–medium; intentional polling/prefetch/retries must be distinguished. Browser observations do not prove database N+1 queries. |
| Within existing retention checks | Focused lifecycle attribution: listeners by target/type, relevant timer/socket/subscription behavior | Makes cleanup leads more actionable | Medium–high; instrumentation can change behavior and shared resources may be legitimate. Confirm an actual delivery need before building. |
| Diagnosis capability | Retainer paths / allocation attribution | Helps answer what holds an object and where to investigate | High; initially reuse DevTools/MemLab. Constructor counts alone cannot supply this answer. |
| Later, separate scope | `memory.server` / API load behavior | Useful when a reproduced complaint points to server RSS, heap, connections or endpoint load | High; requires backend access, representative workloads and different instrumentation. Defer until customer evidence calls for it. |

Explicit Playwright outcome assertions are a prerequisite for meaningful workflows, rather than a reason to invent another test framework. Reuse them now.

Keep broad database/Docker/security/load-balancing, generic visual QA and generic accessibility expansion off the initial roadmap. They introduce separate buyers, expectations and evidence requirements. Loading scores alone also poorly distinguish this offer; [k6](https://grafana.com/docs/k6/latest/using-k6-browser/metrics/) already collects browser Web Vitals and [Chrome](https://developer.chrome.com/docs/devtools/performance/reference) provides runtime performance traces. New vector names are not commercial outcomes.

## 6. The next four weeks, assuming about eight hours/week

| Period | Technical work | Commercial work | Evidence needed |
|---|---|---|---|
| Week 1 | Get one independent admin-app workflow running; establish a warmed control and record setup/false alarms | Seek five short conversations with technical owners describing an actual relevant problem | A runnable independent workflow and concrete incident descriptions |
| Week 2 | Reproduce one external symptom with existing tools; extend timing collection only if the case needs it | Qualify a collaborator or founding client with test access and an acting developer | Reviewed evidence that advances a real debugging task |
| Week 3 | Help isolate/verify a change and preserve the regression script | Offer the bounded paid pilot; at most one concurrent delivery | A paid decision or a specific rejection, plus recorded total effort |
| Week 4 | Reuse the same workflow and compare delivery cost; choose at most one justified measurement addition | Ask for a repeat engagement or introduction and evaluate the pipeline | Evidence of action, payment, repeat need and reusable work |

These are targets, not promises of access or completed sales. Interviewing and external evaluation should proceed together. Ten to fifteen qualified conversations without paid interest means revise the segment/offer before adding more architecture. A six-hour cap repeatedly exceeded means narrow or reprice the investigation. A confirmed defect with no buyer interest establishes technical usefulness, not a business.

**Next engineering task:** one realistic external repeated-use benchmark and a symptom-to-evidence workflow. **Next commercial task:** conversations with technical owners of applications already showing the problem. **Freeze:** Jev, automatic causal conclusions, additional UI and hosted execution.
