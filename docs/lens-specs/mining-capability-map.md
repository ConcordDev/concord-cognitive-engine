# mining — capability map (Frontend Rebuild Program, Wave 2 batch 5)

Reference apps: **Deswik** / **Micromine** (CAD-based open-pit mine design,
block-model interrogation, bench/pit-shell optimization, strategic
scheduling) plus the **MSHA** (US Mine Safety & Health Administration) open
data API for real federal mine + violation records, which the lens already
integrates. This supersedes `docs/lens-specs/mining.md` as the rebuild-program
capability-map artifact.

## Backend macro surface (verified via grep, 2026-07-09)

`server/domains/mining.js` (`registerLensAction`, 24 macros):

oreGradeCalc, blastDesign, safetyMetrics, resourceEstimate,
msha-mine-lookup, msha-violations, site-{add,list,update,delete},
incident-log, mining-dashboard, drillhole-{add,list,log-interval,delete},
block-model, grade-tonnage-curve, pit-design, production-schedule,
schedule-list, equipment-{add,update,delete}, fleet-dashboard,
reserve-report, gis-layer, site-set-location.

## Pre-existing frontend depth (found BEFORE this rebuild)

`concord-frontend/components/mining/` already had 7 files / ~1,400 LOC of
real, macro-wired UI — **every one of the 24 backend macros already has a
designed frontend caller**:

- `MineSiteManager.tsx` — site registry (add/delete, kind/commodity/
  production), per-site incident log, and an operations dashboard
  (`site-*`, `incident-log`, `mining-dashboard`).
- `GeologyWorkbench.tsx` — drill-hole database with per-interval assay
  logging, a 3D block model, and a grade-tonnage curve (`drillhole-*`,
  `block-model`, `grade-tonnage-curve`).
- `MinePlanWorkbench.tsx` — open-pit bench/shell design and JORC 2012 / NI
  43-101-shape reserve reporting (`pit-design`, `reserve-report`).
- `FleetManager.tsx` — equipment registry + fleet dashboard + production
  scheduling (`equipment-*`, `fleet-dashboard`, `production-schedule`,
  `schedule-list`).
- `GisPitMap.tsx` — geo-references sites and projects drill collars onto a
  slippy map (`site-set-location`, `gis-layer`).
- `MshaLookup.tsx` — real federal MSHA mine + violation-history lookup by
  7-digit Mine ID.
- `MiningActionPanel.tsx` — quick pure-compute calculators (ore-grade
  economics, blast design, safety metrics, resource estimate) plus a
  mint/DM/publish/agent action stack.

## What was actually wrong (genuinely broken/generic/fake)

`page.tsx` did NOT need any new backend work — every macro already has a real
designed caller. The entire defect was a **duplicate, disconnected generic-CRUD
surface layered on top of that real depth**:

1. An 8-tab mode switcher (`Dashboard`/`Sites`/`Operations`/`Safety`/
   `Geology`/`Equipment`/`Environmental`/`Map`) backed by
   `useLensData('mining', currentType, …)` — the generic per-lens artifact
   store, not the real `site-*`/`incident-log`/`drillhole-*`/`equipment-*`
   macros. This produced a SECOND, fake "Mine Sites" list and a fake
   "Environmental" tab with zero backing macro, sitting on the same page as
   the real `MineSiteManager`/`GeologyWorkbench`/`FleetManager` a few
   sections down — two different, disconnected "Sites" UIs on one page, one
   real and one a client-only CRUD demo. **Removed** (~230 lines).
2. **Generic scaffold signature.** The page imported the `ManifestActionBar` +
   `AutoActionStrip` + `RecentMineCard` trio and rendered `<UniversalActions>`
   — the auto-discovered-macro button wall. `node scripts/grade-ux-polish.mjs
   --honest` confirmed the cap pre-change: `tier: "functional"`,
   `isGenericScaffold: true`, despite 77% bespoke LOC. **Removed.**

The fix was a redesign of `page.tsx` around the real components only: a clean
7-tab switcher (Sites & Safety / Geology / Mine Plan / Fleet & Schedule / GIS
Map / MSHA Compliance / Quick Calcs), each tab mounting exactly one of the
already-real bespoke workbenches. No macro that previously had no UI needed
one — the gap was 100% presentation, not backend coverage.

## Reference-parity checklist (Deswik / Micromine + MSHA shape)

The only difference from Deswik/Micromine should be dataset scale (a real
deposit's full drill-hole/block-model volume) and CAD-grade 3D rendering
fidelity, nothing else in the workflow surface.

| Capability | Disposition | Where |
|---|---|---|
| Site registry (kind, commodity, production, status) | ALREADY REAL | `MineSiteManager` (`site-*`) |
| Safety incident log per site | ALREADY REAL | `MineSiteManager` (`incident-log`) |
| Operations dashboard (active sites, tonnage, incidents) | ALREADY REAL | `MineSiteManager` (`mining-dashboard`) |
| Drill-hole database + per-interval assay logging | ALREADY REAL | `GeologyWorkbench` (`drillhole-*`) |
| 3D block model | ALREADY REAL | `GeologyWorkbench` (`block-model`) |
| Grade-tonnage curve | ALREADY REAL | `GeologyWorkbench` (`grade-tonnage-curve`) |
| Open-pit bench/shell design + strip ratio | ALREADY REAL | `MinePlanWorkbench` (`pit-design`) |
| JORC/NI 43-101-shape reserve reporting | ALREADY REAL | `MinePlanWorkbench` (`reserve-report`) |
| Equipment/fleet registry + status | ALREADY REAL | `FleetManager` (`equipment-*`) |
| Fleet utilization dashboard | ALREADY REAL | `FleetManager` (`fleet-dashboard`) |
| Production scheduling | ALREADY REAL | `FleetManager` (`production-schedule`, `schedule-list`) |
| Geo-referenced sites + drill-collar map | ALREADY REAL | `GisPitMap` (`site-set-location`, `gis-layer`) |
| Real federal mine safety/violation lookup (MSHA) | ALREADY REAL | `MshaLookup` (`msha-mine-lookup`, `msha-violations`) |
| Ore-grade cutoff/economics calculator | ALREADY REAL | `MiningActionPanel` (`oreGradeCalc`) |
| Blast design calculator | ALREADY REAL | `MiningActionPanel` (`blastDesign`) |
| Safety metrics rollup | ALREADY REAL | `MiningActionPanel` (`safetyMetrics`) |
| Resource estimate calculator | ALREADY REAL | `MiningActionPanel` (`resourceEstimate`) |
| Environmental compliance / reclamation tracking | GENUINELY MISSING | Deferred — no `environmental-*`/`reclamation-*` macros exist server-side; the previous "Environmental" tab was 100% fake generic-CRUD (client-invented fields, no real state) and has been removed rather than kept as a fake surface. A real build would need new backend macros — out of scope for a UI-polish batch. |
| CAD-grade constraint-driven pit optimization (geotech limits) | GENUINELY MISSING | Deferred — `pit-design` computes bench geometry/strip ratio deterministically but does not run a geotechnical constraint solver; a real Deswik-class optimizer is a substantial new backend engine, out of scope here. |

Overall: this lens needed zero new backend surfacing — its 7 bespoke
components already cover all 24 macros. The rebuild was purely subtractive:
delete the redundant fake CRUD tabs and the generic scaffold, reorganize the
real components into a clean tab set.

## Verify gate

- `npx eslint app/lenses/mining/page.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- No `mining`-specific vitest file exists in `concord-frontend/tests/` prior
  to or after this change (checked via `find ... -iname "*mining*.test.*"`) —
  noted rather than silently skipped.
- `node scripts/verify-lens-backends.mjs` — mining stays WIRED; total
  `{"WIRED":258,"NO-BACKEND-CALL":2}` unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — mining: `tier: "polished"`,
  `isGenericScaffold: false` (was `functional` / `true`).
