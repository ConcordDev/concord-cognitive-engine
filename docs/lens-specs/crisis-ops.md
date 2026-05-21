# crisis-ops — Feature Gap vs Dataminr / FEMA tools

Category leader (2026): Dataminr Pulse / Everbridge (crisis operations). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: macro `crisis.active_for_player` / `crisis.resolve` via `/api/lens/run`; FemaDisasters component (free FEMA OpenFEMA API).

## Has (verified in code)
- Active crisis list (per-player) with resolve action
- Skill-suggestion list mapped to current crises
- FEMA disaster declarations feed (live public API)

## Missing — buildable feature backlog
- [ ] `[M]` Crisis map — geospatial plot of active incidents
- [ ] `[M]` Severity / priority triage — rank crises by impact and urgency
- [ ] `[M]` Response playbooks — predefined task checklists per crisis type
- [ ] `[M]` Team assignment + roles — assign responders to a crisis with a command structure
- [ ] `[S]` Timeline / status log per crisis — chronological event record
- [ ] `[M]` Alerting + notifications — push when a new crisis appears or escalates
- [ ] `[S]` Resource inventory — track assets available to deploy

## Parity
~30% of Dataminr's feature surface. The thinnest lens in this batch — a list plus FEMA feed; lacks the map, triage, playbooks, assignment, and alerting that operational crisis tools require.
