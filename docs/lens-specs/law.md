# law — Feature Gap vs Ironclad (contract lifecycle)

Category leader (2026): Ironclad (contract lifecycle management). `law` is the contract-lifecycle lens; `legal` is the separate practice-management heavyweight. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/law.js` — 18 macros: contract CRUD, clause-library, clause-add/remove, contract-review, contract-sign, contract-dashboard, caseAnalysis, statuteLookup, deadlineTracker, billingCalculator, live USPTO patent search, live CourtListener case search, feed.

## Has (verified in code)
- Contract lifecycle — create/list/detail/update/delete, status transitions, dashboard (counts, value, expiring, unsigned)
- Clause library — 15 standard clauses across 5 categories; add/remove clauses on a contract
- Risk review — flags missing recommended clauses, grades risk 0–100
- Signatures — named-party signature ledger, auto-flip to "signed" at two parties
- Legal research — case analysis (win rate, judge stats), statute keyword search, live USPTO patent + CourtListener opinion search
- Deadline tracker, billing calculator, jurisdiction tagging, law feed

## Missing — buildable feature backlog
- [ ] `[L]` Visual contract editor with redline / version diff of clause text
- [ ] `[M]` AI clause extraction from an uploaded contract — auto-detect terms, dates, obligations
- [ ] `[M]` Approval workflow — routing, multi-party review states before signature
- [ ] `[M]` Obligation tracking — surface renewal/expiry/payment dates as actionable tasks
- [ ] `[S]` Cryptographic e-signature with audit certificate (currently named-party ledger)
- [ ] `[M]` Contract templates / playbooks — guided drafting with pre-approved language
- [ ] `[S]` Full-text contract repository search across all clauses

## Parity
~55% of Ironclad's surface. Real contract lifecycle (create→clause→review→sign→dashboard) plus live legal-research APIs, but missing the visual editor, redline diff, AI clause extraction, and approval workflows that anchor a modern CLM.
