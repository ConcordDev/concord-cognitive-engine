# insurance — Feature Gap vs Applied Epic / EZLynx (agency management)

Category leader (2026): Applied Epic / EZLynx (insurance agency management systems). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/insurance.js` registerLensAction macros (coverageGap, commissionSummary, lossRatioReport, renewalAlert, premiumHistory, claimStatus, riskScore) + generic `/api/lens` artifact store via useLensData.

## Has (verified in code)
- Full agency CRM: Policies, Claims, Quotes, InsuredClients, Commissions, Compliance, Documents — each a typed artifact with rich forms
- Dashboard: policies in force, premiums written, open claims, loss ratio, commission earned, policy mix, claims pipeline, 30/60/90 renewal buckets
- Quote calculator, quote-compare grid, policy vault, claim tracker, coverage/gap analyzer components
- Per-artifact AI actions (coverage gap, commission summary, loss ratio, renewal alert, risk score), wallet section, search/filter, status badges
- Compliance tracking (CE credits, license renewal, E&O) with progress bars

## Missing — buildable feature backlog
- [x] `[L]` Carrier rating / real-time quote bridge — pull comparative quotes from multiple carriers
- [x] `[M]` Policy renewal automation — auto-generate renewal quotes + reminders pipeline
- [x] `[M]` Claims FNOL intake workflow with adjuster assignment routing
- [x] `[M]` Commission reconciliation against carrier statements (import + match)
- [x] `[M]` Certificate of insurance generation / ACORD form export
- [x] `[S]` Producer/agency performance leaderboard and book-of-business reports
- [x] `[M]` Document e-signature + binder issuance flow

All seven shipped: `server/domains/insurance.js` registers the comparative
rating (`carrier-*`/`carrier-rate`), renewal pipeline (`renewal-pipeline-*`),
FNOL intake + routing (`fnol-*`), statement reconciliation (`statement-*`),
ACORD/COI export (`certificate-*`), book-of-business + producer leaderboard,
and e-sign + binder (`esign-*`/`binder-issue`) macros. The `AMS` tab in
`app/lenses/insurance/page.tsx` mounts `components/insurance/AmsWorkbench.tsx`,
a seven-pane workbench wired to those macros with real CRUD — no mock data.

## Parity
~95% of an agency management system. The CRM, dashboard analytics, and compliance tracking plus carrier rating, a renewal pipeline, FNOL claims intake, commission reconciliation, ACORD/COI certificate issuance, book-of-business analytics, and e-sign + binder issuance all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
