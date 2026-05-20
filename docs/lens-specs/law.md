# law — Feature Completeness Spec

Rival app(s): Ironclad, LegalZoom, DocuSign CLM (2026)
Sources:
- https://ironcladapp.com/ (contract lifecycle — draft, clause library, review, sign, repository)
- https://www.legalzoom.com/ (contract templates, business legal docs)
- https://search.patentsview.org/ (USPTO PatentsView — live patent search)
- https://www.courtlistener.com/ (Free Law Project — live case opinions)

`law` is the **contract lifecycle** lens; `legal` is the separate
Westlaw-shape legal-research heavyweight. Previously `law` had only
analytical macros and a contract-builder UI that called an unregistered
`add-clause` macro — this spec covers the new contract backend.

## Features

### Contract lifecycle (Ironclad shape)
- [x] Create a contract — title / type / counterparty / value / dates (macro: law.contract-create)
- [x] List contracts, filter by status (macro: law.contract-list)
- [x] Contract detail with clauses + signatures (macro: law.contract-detail)
- [x] Update a contract — metadata + status transitions (macro: law.contract-update)
- [x] Delete a contract (macro: law.contract-delete)
- [x] Clause library — 15 standard clauses across 5 categories (macro: law.clause-library)
- [x] Compose — add / remove clauses on a contract (macro: law.clause-add / clause-remove)
- [x] Risk review — flags missing recommended clauses, grades risk 0-100 (macro: law.contract-review)
- [x] Signatures — record signing parties, auto-flip to "signed" at two (macro: law.contract-sign)
- [x] Contract dashboard — counts by status, total value, expiring-soon, unsigned (macro: law.contract-dashboard)

### Legal research & analysis
- [x] Case analysis — duration, win rate, judge stats (macro: law.caseAnalysis)
- [x] Statute keyword search with relevance scoring (macro: law.statuteLookup)
- [x] Deadline tracker — overdue / urgent / on-track (macro: law.deadlineTracker)
- [x] Billing calculator — by attorney / category / month (macro: law.billingCalculator)
- [x] Live USPTO patent search (macro: law.uspto-patent-search)
- [x] Live CourtListener case-opinion search (macro: law.courtlistener-search)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Cryptographic e-signature | a certificate authority + signing infra | named-party signature ledger with auto status transition |
| Redline / version diff of clause text | a rich-text diff engine | clause add/remove with a per-clause repository; risk review surfaces gaps |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/law.js` clean. 16 macros
  (6 research/analysis + 10 contract-lifecycle). `law` already in
  `domains/index.js` + `ALL_LENS_DOMAINS`.
- 2026-05-20: Tests — `tests/law-domain-parity.test.js` 11/11 green
  (clause library / contract create-list-detail + per-user scope /
  clause add-remove / risk review missing-clause flags + sound grade /
  signatures + duplicate reject + auto-status / dashboard / analytical
  macros intact).
- 2026-05-20: Frontend — new `LawContracts` workbench (contract list +
  detail, clause-library compose, risk review, signing, dashboard) mounted
  in the law lens page; the previously-broken static clause "Add" buttons
  now copy the clause text to the clipboard. `npx tsc --noEmit` exit 0.
