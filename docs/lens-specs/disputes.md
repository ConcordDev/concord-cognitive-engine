# disputes — Feature Gap vs marketplace dispute / ODR systems

Category leader (2026): no single consumer rival — closest analog is eBay/PayPal Resolution Center or an online dispute resolution (ODR) platform. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `disputes` domain macros (assessDispute, timelineTrack, settlementCalc, evidenceStrength); generic `/api/lens` artifact store; LawStackFeed component.

## Has (verified in code)
- Dispute lifecycle: open → under_review → mediation → escalated → resolved/dismissed
- Dispute-type taxonomy (not_as_described, unauthorized_purchase, non_delivery, etc.)
- AI actions: assess dispute, track timeline, calculate settlement, score evidence strength
- LawStackFeed (Law Stack Exchange Q&A); generic dispute artifact CRUD

## Missing — buildable feature backlog
- [x] `[M]` Evidence upload + attachment per dispute — files, screenshots, receipts
- [x] `[M]` Two-party messaging thread — claimant and respondent exchange within the case
- [x] `[M]` Mediator assignment + neutral-party workflow
- [x] `[S]` Settlement offer / counter-offer exchange with accept/reject
- [x] `[S]` SLA timers — auto-escalate if a stage stalls past a deadline
- [x] `[S]` Resolution outcome record + searchable case archive
- [x] `[M]` Escrow/hold integration — freeze funds while a dispute is open

## Parity
~85% of an ODR platform. Full case-lifecycle workbench shipped: evidence
attachment, two-party (+ mediator) messaging thread, mediator assignment,
settlement offer/counter-offer exchange, SLA auto-escalation, resolution
outcome records, searchable resolved-case archive with analytics, and
escrow freeze/release. Lifecycle states, type taxonomy and AI assessment
remain. Implemented by `disputes` domain case-lifecycle macros wired into
`components/disputes/CaseWorkbench.tsx`.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
