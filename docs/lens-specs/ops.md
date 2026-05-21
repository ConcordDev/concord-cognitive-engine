# ops — Feature Gap vs PagerDuty

Category leader (2026): PagerDuty. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/ops.js` — 4 macros (on-call rotation lookup, runbook search, post-mortem skeleton, escalation threshold check); page surfaces substrate-ops tabs over `attention_alloc`/`repair_network`/`physical`/`explore`/`dtu` domains.

## Has (verified in code)
- On-call rotation resolver (current pager by UTC hour), runbook lookup by alert signature.
- Escalation check with sev1–sev4 thresholds + recommendation; 5-section post-mortem skeleton generator.
- Substrate observability tabs: attention budget (run cycle), repair network (push fixes), physical DTU metrics, exploration history, DTU substrate stats.

## Missing — buildable feature backlog
- [ ] `[L]` Live incident lifecycle — create/ack/resolve incidents with state machine, not just escalation math.
- [ ] `[M]` Alert ingestion — webhook/events endpoint to receive alerts and auto-trigger escalation.
- [ ] `[M]` Multi-step escalation policies — tiered notify chains (after N min → next responder/team).
- [ ] `[S]` On-call calendar + overrides — schedule UI with shift swaps and coverage gaps view.
- [ ] `[M]` Notification dispatch — email/SMS/push paging integration on escalation breach.
- [ ] `[M]` Service directory + dependency mapping — services, owners, and which alert affects which.
- [ ] `[S]` MTTA/MTTR analytics — incident metrics dashboard over post-mortems.
- [ ] `[M]` Status page — public incident status surface.

## Parity
~35% of PagerDuty's feature surface. Has the analytical building blocks (rotation, escalation, runbooks, post-mortems) but no actual incident object, alert ingestion, or notification dispatch — it is a calculator, not an incident manager.
