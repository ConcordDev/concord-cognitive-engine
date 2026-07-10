# Defense Lens — Capability Map (Frontend Rebuild Program)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("defense"' server/domains/defense.js` → 31

## Reference apps

This is a force-structure / resource-allocation / C2 common-operating-picture
domain — the closest real-world analogs are:

1. **A Common Operating Picture / C2 system** in the shape of GCCS-J
   (Global Command and Control System – Joint) or Palantir Gotham's
   defense deployment — geospatial entity tracking (assets/threats/
   operations plotted on a shared map), a threat watchlist with
   escalation, and a secure comms log per operation.
2. **A readiness/resource-allocation planning tool** in the shape of
   DRRS (Defense Readiness Reporting System) — unit readiness rollups
   (personnel/equipment/training/supply), a mission task planner with
   dependency scheduling, and a priority-driven resource allocator
   that assigns scarce assets across competing mission demands.

The pre-existing bespoke panels already cover most of both references
well; this rebuild's job was closing the one real gap and retiring a
disconnected generic-CRUD layer sitting alongside them.

## Capability checklist

| Capability | Disposition | Notes |
|---|---|---|
| Threat assessment (likelihood × impact scoring) | ALREADY REAL | `DefenseActionPanel` → `threatAssessment` |
| Readiness scoring (personnel/equipment/training/supply) | ALREADY REAL | `DefenseActionPanel` → `readinessScore` |
| Incident response protocol lookup | ALREADY REAL | `DefenseActionPanel` → `incidentResponse` |
| DoD contract search (USAspending.gov, live external API) | ALREADY REAL | `ContractSearch` + `DefenseActionPanel` → `usaspending-dod-contracts` |
| Common Operating Picture (geospatial asset/threat/operation markers) | ALREADY REAL | `CommonOperatingPicture` → `cop-add`/`cop-map`/`cop-remove` |
| Mission planner (phased tasks, dependency scheduling, critical path) | ALREADY REAL | `MissionPlanner` → `mission-task-*`/`mission-plan` |
| Asset readiness rollup (fleet %, availability, low-readiness flags) | ALREADY REAL | `AssetReadiness` → `asset-upsert`/`asset-delete`/`asset-rollup` |
| Threat tracking board (severity ladder, escalate/de-escalate) | ALREADY REAL | `ThreatBoard` → `threat-*` |
| Personnel roster (availability, role breakdown, unassigned flags) | ALREADY REAL | `PersonnelRoster` → `personnel-*` |
| Logistics / supply-chain board (requested→delivered flow) | ALREADY REAL | `LogisticsBoard` → `supply-*` |
| Secure comms log (channel, classification, precedence, ack) | ALREADY REAL | `CommsLog` → `comms-*` |
| **Priority-driven resource allocation across missions** | **BACKEND-CAPABLE-BUT-UNSURFACED → now built** | `resourceAllocation` had zero frontend usage anywhere in the lens; see below |
| Dashboard summary stats | **was fabricated → now real** | see below |

## What was genuinely fake/generic (confirmed)

The prior audit's diagnosis was accurate on both counts:

1. **`resourceAllocation` was completely unwired.** The macro (a real
   priority-sorted force-allocation optimizer — sorts missions
   critical→low, greedily assigns available resource units, reports
   per-mission fully/partially/unallocated status plus a summary) had
   no frontend caller anywhere under `app/lenses/defense` or
   `components/defense`.
2. **A generic-CRUD scaffold sat alongside the 8 real panels**, disconnected
   from any of the 31 real macros: a multi-type client-side artifact store
   cycling through `Operation`/`Asset`/`Personnel`/`Intel`/`Supply`/`Comms`
   labels that matched no registered macro name, a top stat row computed
   entirely off that fake store (including a "Security Score" label with
   no domain meaning), a search bar wired to the fake store's create path,
   an inert editor-panel stub, a bottom items list with generic
   analyze/update/delete buttons, plus the two generic template-body
   components this program's honest-mode grader specifically watches for.
   All of it has been removed — the count of real bespoke panels visible
   on the page did not change, but the disconnected shadow layer around
   them is gone.

## What changed

- **New: `components/defense/ResourceAllocationPanel.tsx`.** A real
  designed tool, not a JSON textarea: an editable resource pool (add/
  remove named resource units), an editable mission-demand list
  (name/priority/quantity needed), a "Run Allocation" action that calls
  `resourceAllocation`, and a results view — priority-sorted allocation
  table with fully-allocated/partially-allocated/unallocated status
  badges plus a summary strip (resources, missions, fully staffed,
  understaffed, spare capacity after allocation). Mounted on the
  Dashboard tab, directly below the asset-readiness rollup, completing
  the flow: threats → assets → personnel → resource allocation across
  missions.
- **New: `components/defense/DashboardStats.tsx`.** Replaces the
  fabricated stat row with four tiles sourced from the same real
  roll-up macros the tab panels already call — fleet readiness
  (`asset-rollup`), active threats by severity (`threat-board`),
  personnel deployed (`personnel-roster`), and open supply requests
  (`supply-board`). No client-side fake array anywhere in the
  computation.
- **`app/lenses/defense/page.tsx` rebuilt.** Removed the generic
  multi-type artifact store and its four seed calls, the fabricated
  stat row, the search-and-create bar, the inert editor-panel stub,
  the bottom generic items list with its analyze/update/delete button
  row, and the two generic template-body components the honest grader
  flags (a global action-runner button keyed to an arbitrary first
  item, and a collapsible feature-spec browser). The now-dead
  artifact-shape type declarations and the tab→artifact-type mapping
  helper went with them. The page's `isLoading`/`isError` gating that
  used to block the whole page on the fake store's fetch is gone too —
  each real panel already owns its own loading/error state internally,
  confirmed by reading `AssetReadiness`/`ThreatBoard`/etc., so nothing
  needed to replace it.
- **Left alone (already real):** all 8 pre-existing panels
  (`CommonOperatingPicture`, `MissionPlanner`, `AssetReadiness`,
  `ThreatBoard`, `PersonnelRoster`, `LogisticsBoard`, `CommsLog`,
  `DefenseActionPanel`) and `ContractSearch`, in their existing tab
  slots.
- **Intel tab double-check:** confirmed the "Intel" tab correctly
  mounts `ThreatBoard` (backed by the real `threat-*` macro family) —
  there is no separate unwired `intel-*` macro family, so this was
  already correct and needed no change.

## Verification

- `npx eslint app/lenses/defense/page.tsx components/defense/*.tsx` — clean (0 errors, 0 warnings after removing one unused icon import).
- `node scripts/grade-ux-polish.mjs --honest` — `defense`: `tier: "polished"`, `isGenericScaffold: false`, `usesGenericBody: false`.
- No existing defense-lens test file (confirmed by grep) — nothing to update.
