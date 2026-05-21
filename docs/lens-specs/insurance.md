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
- [ ] `[L]` Carrier rating / real-time quote bridge — pull comparative quotes from multiple carriers
- [ ] `[M]` Policy renewal automation — auto-generate renewal quotes + reminders pipeline
- [ ] `[M]` Claims FNOL intake workflow with adjuster assignment routing
- [ ] `[M]` Commission reconciliation against carrier statements (import + match)
- [ ] `[M]` Certificate of insurance generation / ACORD form export
- [ ] `[S]` Producer/agency performance leaderboard and book-of-business reports
- [ ] `[M]` Document e-signature + binder issuance flow

## Parity
~65% of an agency management system. Genuinely deep — full CRM, dashboard analytics, and compliance tracking — but lacks carrier integration for live quoting/binding and the ACORD-form/e-sign document automation that define a production AMS.
