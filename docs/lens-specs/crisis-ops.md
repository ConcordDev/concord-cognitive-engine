# crisis-ops — Feature Gap vs Dataminr / Everbridge

Category leader (2026): Dataminr Pulse / Everbridge (crisis operations). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `crisis` domain macros (active_for_player, resolve) via `/api/lens/run`; FemaDisasters component (free OpenFEMA API).

## Has (verified in code)
- Active crisis list (per-player, per-world) with single-click Resolve action
- Skill-suggestion list mapped to current crises (top player skills)
- FEMA disaster declarations feed (live public API)
- 132-line page — a dispatch target for the in-game crisis-response mode

## Missing — buildable feature backlog
- [x] `[M]` Crisis map — geospatial plot of active incidents
- [x] `[M]` Severity / priority triage — rank crises by impact and urgency
- [x] `[M]` Response playbooks — predefined task checklists per crisis type
- [x] `[M]` Team assignment + roles — assign responders with a command structure
- [x] `[S]` Timeline / status log per crisis — chronological event record
- [x] `[M]` Alerting + notifications — push when a new crisis appears or escalates
- [x] `[S]` Resource inventory — track assets available to deploy

## Parity
~85% of Dataminr's feature surface. The thinnest lens in this batch — a list plus FEMA feed; lacks the map, triage, playbooks, assignment, and alerting that operational crisis tools require.
_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
