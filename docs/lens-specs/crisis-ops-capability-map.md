# Crisis-Ops Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/crisis.js` (731 LOC) in full — every macro registered via
> `register("crisis", "<name>", ...)`, confirmed with
> `grep -n 'register("crisis"' server/domains/crisis.js` (18 macros, no
> inline registrations elsewhere). Frontend audited by reading
> `app/lenses/crisis-ops/page.tsx` (252 LOC) and all 8
> `components/crisis-ops/*.tsx` files (~1300 LOC combined) in full.

## Backend surface — 18 macros, all real

`active_for_player`, `resolve`, `declare`, `map` (USGS quake + NWS alert
merge), `triage`, `playbook`/`playbook_step`, `assign`/`unassign`/`team`,
`log_event`/`timeline`, `alerts`/`acknowledge_alert`, `resources`/
`resource_upsert`/`resource_deploy`. This is the in-game world-incident
console — distinct from the sibling `cri` lens, which is a separate
business-crisis-planning + DTU-quality toolkit backed by its own `cri`
domain.

## Reference apps

Dataminr Pulse / Everbridge (operational crisis-response consoles) — live
incident map, severity triage, response playbooks, command roster,
timeline, alerting. Dense, alert-forward identity (rose/red accent on dark
background, command-deck layout) already matches this category, not a
generic dashboard.

## Audit result: no real defects found

Full read of `page.tsx` and all 8 sub-panels
(`CrisisMap`, `TriagePanel`, `PlaybookPanel`, `TeamPanel`, `TimelinePanel`,
`AlertsPanel`, `ResourcePanel`, `IncidentReportPanel`, `FemaDisasters`)
confirms the pre-existing `docs/lens-specs/crisis-ops.md`'s "full backlog
implemented" claim. Every macro is reached from a real, designed panel:

- `map` → `CrisisMap.tsx`, rendered on the shared `MapView` component with
  real USGS/NWS source attribution and severity-tone markers — not a fake
  static image.
- `triage`/`playbook`/`team`/`timeline`/`resources` → command-deck grid of
  5 real panels, gated behind selecting an active crisis.
- `alerts` → `AlertsPanel.tsx`, real 30s poll (`setInterval`) against the
  live macro, not decorative.
- `FemaDisasters.tsx` → live public OpenFEMA API feed.
- Incident reports are real durable artifact CRUD (`useLensData`,
  `noSeed: true`), not caller-fabricated data.

No `Math.random()`, no hardcoded stats, no fake-success catch blocks
found. `grep -rniE "TODO|FIXME|mock|dummy|hardcoded|fake" app/lenses/
crisis-ops/ components/crisis-ops/` returns only an honest
self-documenting comment ("No mock/seed data — an empty backend renders
the empty state...") in `IncidentReportPanel.tsx`, confirming the honesty
invariant is actively maintained, not merely accidental.

## 1.5 Reference-parity checklist

| # | Item | Disposition |
|---|---|---|
| 1 | Live incident map | ALREADY REAL — USGS + NWS via `crisis.map` |
| 2 | Severity/priority triage | ALREADY REAL — `TriagePanel` |
| 3 | Response playbooks | ALREADY REAL — `PlaybookPanel` |
| 4 | Team assignment + roles | ALREADY REAL — `TeamPanel` |
| 5 | Timeline/status log | ALREADY REAL — `TimelinePanel` |
| 6 | Alerting/notifications | ALREADY REAL — `AlertsPanel`, live poll |
| 7 | Resource inventory | ALREADY REAL — `ResourcePanel` |
| 8 | FEMA declarations feed | ALREADY REAL — `FemaDisasters` |
| 9 | Incident after-action reports | ALREADY REAL — `IncidentReportPanel`, durable artifact |

**Coverage summary:** 9 of 9 checklist items already real. Keyboard
affordance is thin (only `r` for refresh registered via `useLensCommand`)
but the panel-heavy, form-driven surface doesn't have many more natural
scoped shortcuts to add without inventing busywork — left as-is rather
than padding with decorative bindings. No changes made this session.

## Files touched

None — audit only, no defects found.
