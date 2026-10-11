# Vibe Guru: product and commercial decision

**Current direction update:** read [NEXT_DECISIONS.md](NEXT_DECISIONS.md) first. After the founder clarified the required strategic decisions, the review prioritizes a bounded investigation for a React product team with an active repeated-use complaint. Agency handover remains secondary. Jev, automatic investigation integration, additional UI and hosted execution are frozen as next investments. The document below preserves the initial agency-first proposal and its research; it is not the current default buyer decision. No paying demand is established for either offer.

Decision and primary-source research date: **8 October 2026, Asia/Calcutta**. This is commercial context for future work, not a replacement for [UNDERSTANDING.md](UNDERSTANDING.md) or [AUDIT.md](AUDIT.md). Recheck dated market claims before using them in public copy. Implemented behavior always comes from current source and verification.

## Decision

Start with a **fixed-scope frontend runtime and repeated-use health check for agencies and small teams delivering React web applications**. Prefer dashboards, admin tools, and sustained-session applications with charts, grids, observers, or sockets. Use the local engine as delivery infrastructure, combine it with explicit Playwright journey assertions and human review, and sell a useful measured result before building a customer dashboard.

The founder is solo, part-time, and has no existing buyer network. The narrow service is chosen because agencies are identifiable, delivery dates create a possible buying trigger, and the work can be bounded. These are hypotheses to validate, not evidence of customer demand. There are no established paying customers, repeat engagements, validated acquisition channel, or demonstrated market price in this repository.

The public product claim should be: **“We check agreed routes and journeys for runtime failures and suspicious resource growth, review the evidence, and rerun the same checks after your changes.”** Avoid claims of complete correctness, effortless scaling, supporting a million users, guaranteed leak diagnosis, or comprehensive release certification.

## What is commercially useful

The core asset is repeated browser exercise with post-GC measurements, passive runtime observation, retained-instance signals, and concise actionable findings. Multiple analyzers reuse one browser session. This potentially reduces specialist setup and interpretation effort. The explicit fixture, clean control, separation of measurements and interpretation, and lifecycle discipline are credible engineering foundations.

The valuable buyer outcome is a reproducible defect, a practical next action, and a comparable confirmation run. A list of unreviewed console errors or a graph with no actionable outcome is not enough. Counts and trends are evidence to investigate; they are not by themselves proof that a particular source line, library, or cleanup call caused the issue.

The existing context audit establishes behavior on the bundled intentionally broken React fixture, not on a representative population of customer apps. Investigation and focused snapshots remain separate from the normal run until explicitly wired and validated. The local/public version gap and distribution signals discussed during this review require fresh primary API checks before public use; downloads must never be described as users or customers.

## Market alternatives and implications

| Primary source checked on 8 Oct 2026 | Observed capability | Implication for Vibe Guru |
|---|---|---|
| [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) | README recommends CLI plus skills for many coding-agent workflows because of context efficiency. | MCP and token savings are usability/distribution advantages, not a durable moat. Avoid old generic-browser token benchmarks as pricing justification. |
| [Meta MemLab](https://github.com/facebook/memlab) | Scenario-based leak detection, heap analysis, retainer traces, MCP tools and AI investigation guidance. | Memory analysis is established competition. Vibe Guru must win on onboarding, useful triage and repeated regression workflow, not unique heap access. |
| [Lovable browser testing](https://docs.lovable.dev/features/browser-testing) | Browser interaction, form filling, navigation, runtime logs and checks across viewport sizes are built into the development workflow. | Broad “verify your AI app” positioning competes with functionality builders already provide. |
| [Checkly Playwright monitoring](https://www.checklyhq.com/product/start-monitoring-with-playwright/) and [monitoring as code](https://www.checklyhq.com/product/monitoring-as-code/) | Standard Playwright suites can run as monitors, with developer and agent interfaces. | Scheduling, dashboards and alerts create a larger competitive/operational category. Reuse customer-owned tests before building a hosted runner. |
| [Chrome memory debugging guidance](https://developer.chrome.com/docs/devtools/memory-problems) | Heap snapshots and allocation tools support manual investigation; acceptable memory levels depend on devices and behavior. | DevTools and internal engineers are real substitutes. Absolute thresholds require context and human review. |
| [Meta's MemLab engineering account, 12 Sep 2022](https://engineering.fb.com/2022/09/12/open-source/memlab/) | Reports a 50% reduction in Facebook OOM crashes in H1 2021. | Memory defects can have real production impact. This historical large-scale result does not prove small-agency willingness to pay or Vibe Guru effectiveness. |

These pages describe their authors' capabilities and experiences; no independent competitive benchmark was performed. The research does not establish market size, purchasing budgets, or conversion rates.

## Ranked directions

1. **Narrow agency handover check: default.** Known project timing and repeat projects are plausible triggers. Easier to identify prospects than discover private performance incidents. Start per project; repeat revenue is unproven.
2. **Symptom-led React degradation diagnosis: second offer.** Higher urgency where a tab actually degrades, but deeper diagnosis is unpredictable and requires stronger causal debugging skills. Offer only with an agreed reproduction and separate effort/price scope.
3. **Customer-run CI regression checks: expand after repeat demand.** Package the journeys and comparisons customers already value. Keep execution in their environment initially.
4. **Paid local team tool: possible after external adoption.** Requires dependable installation, low false positives, reliable output and a clear reason to pay beyond free alternatives.
5. **Hosted generic QA or monitoring SaaS: defer.** Authentication, private environments, isolation, job operation and on-call obligations are disproportionate to a solo part-time founder's current capacity.

The strongest counterargument to the default is that agencies buy delivery confidence and working features, not memory counters. A general QA freelancer may already address the visible risk. Brochure sites are poor prospects, and sophisticated agencies often have their own QA/performance teams. If qualified conversations consistently request broader feature testing and dismiss runtime/repeated-use evidence, test the symptom-led offer instead of adding arbitrary features.

## Founding pilot: chosen commercial contract

- **Price:** $300 USD per project as a founding-pilot experiment, not a verified market rate. Scope and scheduling are agreed before payment; no subscription or automatic billing.
- **Unit:** one runnable React web application, one agreed version/environment, up to 10 routes and two explicitly described journeys.
- **Effort:** at most six delivery hours in total, including human review, report and one confirmation rerun. A rerun replaces repeated automated checks on the same scoped behaviors; it does not add features or an unrestricted diagnosis session.
- **Output:** measured findings, reproduction steps, reviewed severity/impact, likely investigation actions, coverage and measurement limits, and a comparison after customer changes when the rerun can be completed within the cap.
- **Roles:** the customer supplies safe test access/data, expected journey outcomes, and a developer who can act on findings. Substantial fix implementation or additional investigation is separately scoped.
- **Boundaries:** no security assessment, backend load test, accessibility audit, comprehensive functional acceptance, full cross-browser coverage, continuous monitor, or scaling guarantee.
- **Delivery:** asynchronous, local or agreed staging execution. No source/session upload service or multi-tenant hosted runner is promised.

Important capability boundary: automatic route visitation is not a business assertion. The two journeys in a paid engagement need explicitly authored Playwright assertions and human review beyond the automatic route survey, whether those assertions run in a custom flow or a separate test. Check the updated engineering audit for flow validity/attribution behavior. Do not describe manual delivery work or unstated expected outcomes as autonomous product capability.

The local [landing page](../../site/index.html) reflects this contract. Its enquiry form produces a downloadable text brief; it sends nothing and clearly says so. A real contact channel, payment arrangement and schedule must be reviewed by the owner before any public launch. The linked [sample report](../../examples/sample-report.html) is generated from the bundled fixture; it is not a customer case study.

## Engineering and adoption priorities

First protect the meaning of a clean result: incomplete evidence, failed GC, missing measurements, blocked routes and incomplete flows must remain visible and must not silently become a confident pass. Then validate actual route rendering and reload avoidance on the supported React setup, distinguish source clues from causal claims, and ensure failures/write errors reach the caller.

Keep supported frameworks narrow until external fixtures prove broader behavior. Use a documented local development setup for early delivery; packaged smoke checks are needed before inviting broad self-serve usage. Maintain the Elixir/Node architecture unless observed support costs justify a change. A rewrite and a customer dashboard do not validate demand.

Do not integrate the investigation loop simply because it exists. Its conclusions need real evidence and unresolved cases must survive. Constructor count/shallow-byte summaries cannot be marketed as retainer-chain or exact source-line diagnosis.

Browser compute is not the immediate scaling limit; access, test data, reproduction, human interpretation and bespoke journey setup are. Track those separately. Cloud execution introduces another operational product, so expand through customer-run CI before owned hosted infrastructure.

## Investor-style assessment

**Upside:** a useful technical foundation, low variable model cost in the deterministic analysis, a plausible service wedge, and a path to learning without funding a hosted platform. A corpus of confirmed defects/fixes, calibrated patterns and reusable customer workflows could eventually improve differentiation.

**Downside:** no demand proof, easy-to-copy primitives, strong free alternatives, a smaller memory-specific buyer segment than generic AI QA suggests, packaging/support seams, uncertain confidence calibration, and founder-time dependence. Selling a polished report without verified usefulness would conceal rather than solve those risks.

**Judgment:** not currently a compelling conventional angel investment. A small founder-development bet is different from an investable product business. Reconsider after several independent teams pay repeatedly for the same workflow, external findings survive adjudication, delivery effort decreases, and repeat revenue grows without matching growth in founder hours. Service revenue alone does not establish SaaS economics.

## 30 / 60 / 90 day evidence gates

Assume roughly eight hours per week, with one concurrent pilot, until the founder supplies an actual budget. Treat these as effort-bound evidence goals; do not imply that calendar dates guarantee them.

| Period | Evidence target | Decision |
|---|---|---|
| First 30 days | Around 10 qualified discovery conversations; at least 3 external React app checks with permission or suitable public source; one honest before/after demonstration; reliable result validity. | Continue if the chosen segment has recurring painful incidents or handover risk and can identify a budget owner. Do not use compliments as buying evidence. |
| By 60 days | 3 bounded pilots, aiming for 2 paid at the experimental price; record all access/setup/delivery time, confirmed issues, rejected signals, customer actions and perceived value. | Narrow scope or change the offer if access/setup dominates, checks only produce noise, or value is unconvincing. |
| By 90 days | At least 1 repeat engagement plus evidence that a common portion of delivery is reusable. Test customer-run CI only where the buyer asks for repeated checks. | Build recurring product features only after recurring demand. Otherwise retain a transactional service or change the wedge. |

Switch rules: if 10–15 qualified conversations and credible demos produce no paid interest, change positioning or pause commercial expansion. If agency buyers want unrelated feature QA, test symptom-led diagnosis with affected application teams. If work consistently exceeds six hours, reduce scope or price diagnosis separately. If customers pay repeatedly to catch the same release regressions, automate that customer-owned workflow. If the report is valued once but not repeated, do not claim subscription validation.

## Saved execution resources

- [Pilot intake](../commercial/PILOT_INTAKE.md)
- [Discovery questions and evidence ledger](../commercial/DISCOVERY.md)
- [Delivery report template](../commercial/DELIVERY_TEMPLATE.md)
- [Unsent outreach drafts](../commercial/OUTREACH_DRAFTS.md)
- [30 researched agency leads, qualifications and evidence](../commercial/PROSPECTS.md)

No prospects have been contacted through this research. A lead's public portfolio does not establish an active bug, purchase intent, available budget, appropriate decision maker or consent to test a customer's app.
