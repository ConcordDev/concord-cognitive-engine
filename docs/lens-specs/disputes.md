# disputes — Feature Gap vs marketplace dispute / ODR systems

Category leader (2026): no single consumer rival — closest analog is eBay/PayPal Resolution Center or an online dispute resolution (ODR) platform. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `disputes` domain macros (assessDispute, timelineTrack, settlementCalc, evidenceStrength); generic `/api/lens` artifact store; LawStackFeed component.

## Has (verified in code)
- Dispute lifecycle: open → under_review → mediation → escalated → resolved/dismissed
- Dispute-type taxonomy (not_as_described, unauthorized_purchase, non_delivery, etc.)
- AI actions: assess dispute, track timeline, calculate settlement, score evidence strength
- LawStackFeed (Law Stack Exchange Q&A); generic dispute artifact CRUD

## Missing — buildable feature backlog
- [ ] `[M]` Evidence upload + attachment per dispute — files, screenshots, receipts
- [ ] `[M]` Two-party messaging thread — claimant and respondent exchange within the case
- [ ] `[M]` Mediator assignment + neutral-party workflow
- [ ] `[S]` Settlement offer / counter-offer exchange with accept/reject
- [ ] `[S]` SLA timers — auto-escalate if a stage stalls past a deadline
- [ ] `[S]` Resolution outcome record + searchable case archive
- [ ] `[M]` Escrow/hold integration — freeze funds while a dispute is open

## Parity
~45% of an ODR platform. Lifecycle states, type taxonomy, and AI assessment are real, but missing the evidence upload, two-party messaging, mediator workflow, and offer-exchange that define dispute resolution.
