# Discovery: learn from actual incidents

Version: 8 October 2026. Interview first; avoid asking whether someone likes the idea. No outreach has been sent by this project task.

## Questions for an agency owner or technical lead

1. What was the last client handover that produced a runtime failure, blank page, stalled interaction, or tab that became worse with repeated use?
2. Who found it, how long did reproduction/fixing take, and what client or delivery consequence followed?
3. What checks had already passed? Which browser journey or longer session was missing?
4. How do you currently check React apps before handover? Who owns the checklist and results?
5. Which work is already covered by Playwright, manual QA, DevTools, MemLab, monitoring or the app builder?
6. How often did this class of problem occur across your last few application projects? Ask for examples, not estimated future need.
7. Does an independent runtime/repeated-use check solve an actual gap, or is broader functional QA the real need?
8. What would make a report actionable for the developer? What evidence would they reject as noise?
9. Could you supply one stable app build, a safe test account and two explicit journeys without hours of setup?
10. Who can approve $300 for this specific scoped pilot, and from which existing project budget?
11. Which upcoming eligible project could you use to evaluate it? What concrete decision would the result support?
12. After a useful first check, what would trigger another purchase: next handover, a symptom, every release, or nothing?

For a product team reporting degradation, ask for the precise reproduction, duration, affected devices, telemetry, earlier attempted fixes, and cost of leaving it unresolved. Do not presume every slow application has a memory leak.

## Evidence ledger

One row per conversation or engagement. Keep personal/customer information local and consensual; public case studies require separate agreement.

| Date / organization | Recent actual problem | Current workaround | Pain / consequence in buyer's words | Budget owner | Safe access feasible? | Specific next step | Paid / repeat status |
|---|---|---|---|---|---|---|---|
| ___ | ___ | ___ | ___ | ___ | ___ | ___ | ___ |

Strong evidence: a real relevant incident, permission/access to a suitable app, a named technical/budget owner, payment, developer action on a confirmed result, or repeat purchase. Weak evidence: friendly feedback, “interesting,” downloads, GitHub stars, speculative ROI, or statements about what other companies might buy.

## Pilot measurements

Record access lead time, founder setup hours, run/reproduction hours, report hours, rerun hours, confirmed actionable findings, rejected/expected signals, blocked checks, changes made by the customer, and whether the same scope was bought again. Use source/behavior evidence to judge findings, not how impressive a graph looks.

After 10–15 qualified conversations and credible demonstrations without paid interest, revise the segment/offer or pause commercial expansion. If buyers consistently need broad feature acceptance instead, do not disguise that requirement as a memory product. If a repeated regression check is purchased, automate that observed need in the customer's CI first.
