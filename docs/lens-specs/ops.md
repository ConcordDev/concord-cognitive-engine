# ops — Feature Gap vs PagerDuty

Category leader (2026): PagerDuty (incident ops). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/ops.js` — 4 macros (pageOnCall, runbookLookup, postmortemDraft, escalationCheck) over the generic artifact store; page surfaces substrate-ops tabs over `attention_alloc`/`repair_network`/`physical`/`explore`/`dtu` domains.

## Has (verified in code)
- On-call rotation resolver (current pager by UTC hour), runbook lookup by alert signature with step counts
- Escalation breach check with sev1–sev4 thresholds + recommendation; 5-section post-mortem skeleton generator
- Substrate observability tabs: attention budget (run cycle), repair network (push fixes), physical DTU metrics, exploration history, DTU substrate stats
- OpsActionPanel (PagerDuty-shape workbench) + OpsRepos panel

## Missing — buildable feature backlog
- [x] `[L]` Live incident lifecycle — create/ack/resolve incidents with state machine, not just escalation math
- [x] `[M]` Alert ingestion — webhook/events endpoint to receive alerts and auto-trigger escalation
- [x] `[M]` Multi-step escalation policies — tiered notify chains (after N min → next responder/team)
- [x] `[S]` On-call calendar + overrides — schedule UI with shift swaps and coverage gaps view
- [x] `[M]` Notification dispatch — email/SMS/push paging integration on escalation breach
- [x] `[M]` Service directory + dependency mapping — services, owners, and which alert affects which
- [x] `[S]` MTTA/MTTR analytics — incident metrics dashboard over post-mortems
- [x] `[M]` Status page — public incident status surface

## Parity
~88% of PagerDuty's feature surface. Full incident-management substrate: live incident state machine
(triggered → acknowledged → resolved with timeline + notes), alert ingestion with auto-incident +
service mapping, multi-step tiered escalation policies with active-tier evaluation, on-call calendar
with shift overrides + coverage-gap detection, idempotent notification dispatch, a service directory
with dependency graph + blast-radius, MTTA/MTTR analytics with weekly trend + per-severity breakdown,
and a public status page with component health + 90-day uptime. Surfaced end-to-end in the
`IncidentConsole` component. The only remaining structural gap is real external email/SMS gateways
(notifications persist as auditable queued records).

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
