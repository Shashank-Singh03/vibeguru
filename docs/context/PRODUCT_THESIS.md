# Vibe Guru: a broader product thesis to validate

**Longer-term vision:** [NORTH_STAR.md](NORTH_STAR.md) plans an autonomous reliability lab, including Jev, controlled experiments, reproduction reduction, fix verification and incident memory. The product below is an entry-point hypothesis into that larger direction. Implementation restraint is not a prohibition on planning the ambitious architecture.

Review date: **9 October 2026, Asia/Calcutta**. The founder wants a potentially scalable developer product, and rejected the small audience implied by a specialist diagnosis service. This document revises the commercial recommendation in [NEXT_DECISIONS.md](NEXT_DECISIONS.md). It is a proposed direction, not a customer-validated market or approval to implement every feature below. Earlier technical observations and test limitations still apply.

## Recommendation

**Build a runtime regression engine for web application changes, usable by developers and coding agents locally and in customer CI.**

The repeated job is: run an agreed workflow on a baseline and a candidate build, identify new runtime/resource failures or material degradation, preserve reproduction evidence, and rerun after a fix. Begin with React applications and repeated-use resource behavior, where the existing engine has a relevant foundation. Broader framework coverage must be verified individually.

This changes the adoption trigger from "we already have a memory complaint" to "we are changing a web application and want to catch a regression before release." The possible market is broader and the job recurs. Whether the extra check is useful enough to install, keep running and pay for remains unproven.

A specialist service can supply access, onboarding and real defect examples. Service-first is optional; it is not the identity of the proposed business. A multi-vector platform is a possible expansion of the same verified workflow, rather than a reason to build unrelated scanners immediately.

## Users, buyers and distribution

| Segment | User and buying authority | Proposed value | Priority |
|---|---|---|---|
| Small web product teams with regular releases and existing browser workflows | Frontend/full-stack engineer adopts; engineering lead or technical founder approves team spending | Catch a new runtime/resource regression with less setup and triage work | First design partners |
| Developers using coding agents | Developer invokes CLI/MCP after a change; individual spending may be limited | Obtain measured feedback that can drive another fix/test iteration | Broad adoption channel; downloads alone do not validate payment |
| Agencies maintaining several applications | Developer uses checks; owner/technical lead pays if reused across client releases | Standardize recurring verification and handover evidence | Secondary team segment |
| App-builder or coding-agent platforms | Platform engineers integrate; platform/product leadership approves a contract | Embed a reliable verifier behind their existing build loop | Later SDK/platform route; concentrated buyers and integration dependence |

The product should also work for human-written changes. AI assistance is a distribution opportunity, not a requirement for the underlying regression problem.

Initial distribution experiments: an existing-Playwright-workflow integration, customer-run GitHub Actions example, npm CLI/MCP onboarding, and public reproductions showing a defect, a clean control and a verified fix. Approach maintainers and small product teams with an actual proposed workflow. No outreach is sent by this document.

The first experiment is a developer installing and rerunning a useful check. The commercial experiment is a team paying to keep that check useful across releases. GitHub stars, survey interest, broad developer counts and compliments are not substitutes for either.

## Three possible product directions

| Direction | Durable job | Fit and difficulty | Decision |
|---|---|---|---|
| Developer/team runtime regression product | Compare known workflows before and after changes; verify fixes | Closest to current CLI/MCP and browser evidence; needs dependable comparison and workflow integration | Recommended first product hypothesis |
| Embedded verification SDK for app builders and coding agents | Supply machine-readable evidence after many generated changes | High potential execution volume; fewer purchasing organizations, integration/sales dependence and strong build-in-house alternatives | Earn this through a useful direct developer product or a real design partner |
| Incident-to-regression debugging product | Turn an observed user incident into reproduction, diagnosis and a future check | Valuable job, but requires telemetry, source context and reproduction inputs beyond the current engine | Consider if real users pull the product here |

## Competitive reality, checked 9 October 2026

- [Microsoft Playwright MCP](https://github.com/microsoft/playwright-mcp) provides browser automation and recommends CLI plus skills for many coding-agent workflows. CLI/MCP access and compact output are useful interfaces, not a sufficient moat.
- [Lovable browser testing](https://docs.lovable.dev/features/browser-testing) already offers navigation, forms, console/network inspection, runtime errors and checks across viewport sizes. "The agent opens your app and tests it" is already supplied by an app builder.
- [Checkly monitoring as code](https://www.checklyhq.com/product/monitoring-as-code/) covers browser/API checks, existing Playwright projects, CI and agent interfaces. A generic hosted testing dashboard would face an established competing workflow.
- [Sentry Seer](https://blog.sentry.io/seer-debug-with-ai-at-every-stage-of-development/) uses application telemetry and source context for AI debugging. A general autonomous debugging promise would require much more than the current snapshot counts and rule suggestions.

These are primary descriptions of vendor capabilities, not independent comparisons or proof that no gap exists. The proposed distinction to test is **measured resource/runtime changes during repeated workflows, comparable builds, actionable reproduction evidence and explicit unknowns with less effort than assembling existing tools**. Do not claim competitors cannot perform these tasks without an equivalent-task comparison.

## Minimum useful product and current gaps

Proposed initial experience: reuse one customer-owned Playwright workflow, execute a comparable baseline and candidate, show new runtime failures and repeated-use resource differences, retain the steps and evidence, and return a machine-readable result plus a readable CI artifact. Example numbers in demos must be measured or explicitly hypothetical. A constructor count increase can be an investigation lead without proving a leak or source line.

**Already present:** memory/runtime/census measurements sharing a browser session, deterministic analyzers, evidence records, CLI/MCP, structured verdicts and a report surface. The separate investigation subsystem is experimental. The Probe and Analyzer interfaces give a reasonable extension seam.

**Still proposed:** an integration that reuses existing Playwright tests, automated baseline/candidate execution and regression adjudication, stable cross-run defect fingerprints, measured action latency/long tasks, request-duration/count comparisons, and a recurring team service. The HTML report's local comparison is not a validated regression engine. No paying or repeat-use demand has been established.

Comparison must bind build, browser, host, data, workflow, warm-up and repetitions. Baseline changes require explicit review. A lower memory number alone is not a verified functional improvement; keep user-visible assertions. Timing noise, legitimate caches and changed backend conditions must remain visible.

Support required/optional checks and capability validity explicitly. For example, an inaccessible module-scoped constructor must not silently pass, but it need not make every unrelated check inconclusive if the agreed scope never required that constructor measurement. Do not expand the meaning of PASS to "the app is correct." It remains a scoped result.

## Vectors and Jev

1. Keep runtime and repeated-use memory/resource checks as the initial measurement specialization.
2. Add workflow latency/main-thread work when external examples need it. Forced-GC retention capture should use a separate pass from realistic latency measurement.
3. Add network duration/count/retry evidence when needed to distinguish backend waits, duplicate work or polling that persists after navigation.
4. Expand into API contracts, accessibility or other checks through proven tools when the same paying workflow demands them. Backend load, security and infrastructure require additional access, evidence contracts and expertise; a general scanner promise is premature.

Jev could later select a reliable next probe under a budget. It is not a prerequisite for broad adoption. Keep deterministic evidence interpretation and scoped validity. Evaluate an adaptive policy only against useful manual/rule choices on real cases; do not use a model to manufacture causal certainty from missing evidence.

## What customers would buy

Proposed packaging: a free local CLI for initial evaluation, followed by a paid team workflow for recurring comparisons, shared check policies, approved baselines and reduced triage work in customer CI. Those boundaries are hypotheses; do not withhold the core useful comparison merely to force payment before learning what teams value. Customer-owned execution avoids requiring a hosted browser fleet in the first product.

Team payment must reflect a useful maintained verification outcome. A dashboard, report storage or a pass badge alone does not establish value. An SDK/platform contract is a separate later purchasing experiment. No price, recurring revenue or conversion rate is claimed to be validated.

## Next validation experiment

Use independent local production builds of the previously selected react-admin community demo and Excalidraw, then authorized real team apps. Include natural behavior, labelled injected defects and verified clean/fixed variants. Do not stress public hosted demos. Compare equivalent tasks with ordinary Playwright/DevTools and MemLab where relevant.

Over an initial four-to-six-week experiment, assuming part-time capacity, target five external teams using one agreed workflow and ask at least three to rerun it across several changes. Track installation effort, founder help, run cost, rejected findings, confirmed regressions, actions taken and unprompted reuse. Attempt a concrete paid continuation with teams that receive value; aim for at least two paying teams before expanding the product. These targets are decision gates, not statistical proof or promised access.

- If developers need substantial bespoke setup, improve integration before adding vectors.
- If extra evidence does not change debugging or release decisions compared with their current checks, revise the claimed advantage.
- If users run once and do not return, a recurring product thesis is weak even if a one-off diagnosis service remains viable.
- If teams repeatedly use it but decline payment, investigate what maintained outcome a buyer will fund; do not assume a dashboard solves monetization.
- If repeated use, confirmed value and payment appear, expand the most requested adjacent vector and team workflow.

**Next investment:** external workflow reuse and comparable regression evidence. **Deferred:** additional marketing UI, hosted execution, Jev integration and indiscriminate vector expansion. This document changes strategy/context only; it does not implement the proposed product.
