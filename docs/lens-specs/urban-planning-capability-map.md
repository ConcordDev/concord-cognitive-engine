# urban-planning — capability map (Frontend Rebuild Program)

Reference apps: **Esri CityEngine / ArcGIS Urban** (procedural massing,
zoning-driven envelope generation, scenario comparison, impact dashboards)
and **CommunityViz** (parcel-level scenario planning, transit/walkability
analysis, public-participation workflow). Both are the closest real-world
category leaders to what this lens's backend already computes — a
parcel/zoning substrate feeding 3D massing, transit catchment, and
stakeholder-comment tooling.

## Backend macro surface (verified via reading `server/domains/urbanplanning.js`)

`registerLensAction("urban-planning", ...)`: `zoningAnalysis`,
`walkabilityScore`, `densityCalc`, `trafficImpact`, `census-acs-county`,
`hud-income-limits`, `parcel-add`, `parcel-list`, `parcel-remove`,
`massingEnvelope`, `scenario-create`, `scenario-list`, `scenario-remove`,
`scenario-compare`, `impactDashboard`, `transitCoverage`, `comment-add`,
`comment-list`, `comment-resolve`, `exportPlan`. All 19 macros are pure
compute or in-memory per-user workspace state (`STATE.urbanPlanningLens`),
plus two real external API calls (US Census ACS 5-year, HUD Income Limits).

## Pre-existing frontend depth (found BEFORE this rebuild)

`concord-frontend/components/urban-planning/` already had 7 files of real,
macro-wired UI, confirming the earlier audit's framing:

- `ParcelManager.tsx` — add/list/remove real parcels (`parcel-*`) + per-parcel
  3D massing envelope (`massingEnvelope`), rendered on `CityMap`.
- `ScenarioStudio.tsx` — create/list/remove development scenarios
  (`scenario-*`) with a real side-by-side comparison dashboard
  (`scenario-compare`) including a bar chart and a best-per-metric table.
- `TransitCoveragePanel.tsx` — add transit stops, run real walk-shed
  catchment-buffer analysis (`transitCoverage`), rendered on `CityMap`.
- `PublicCommentPanel.tsx` — real stakeholder comment workflow
  (`comment-add/list/resolve`) with stance tally.
- `PlanExportPanel.tsx` — real impact-projection dashboard
  (`impactDashboard`) + shareable markdown plan export (`exportPlan`).
- `CountyDataPanel.tsx` — real US Census ACS demographics
  (`census-acs-county`) + HUD Income Limits (`hud-income-limits`), both
  live external-API calls, not fixtures.
- `CityMap.tsx` — a real, legitimate pure-visualization component: it takes
  parcel/catchment data as props and computes a local-coordinate bounding-box
  map. Confirmed it is only ever fed real data from its two callers
  (`ParcelManager`, `TransitCoveragePanel`) — not touched in this rebuild.

## What was actually wrong (confirms the prior audit)

1. **Fabricated-looking "Dashboard" + "Projects" tabs with no backend at
   all.** Both ran on `useLensData<ProjectData>('urban-planning', 'Project',
   …)` / `useLensData<InfraData>('urban-planning', 'Infra', …)` — the generic
   client-side artifact-CRUD store. There is no `Project` or `Infra` macro
   registered anywhere in `urbanplanning.js` (confirmed by reading the whole
   file — the only registrations are the 19 listed above). The Dashboard's
   "Active Projects" / "Critical Infrastructure" / "Total Projects" /
   "Pending Permits" stat tiles, and the Projects tab's create/list/delete
   UI, rendered a plausible-looking planning department view backed by
   nothing — this is the disconnected generic-CRUD-store defect class.
   **Removed.** The Projects tab is retired outright (not relabeled): there
   is no real per-project entity substrate behind it, and inventing one was
   out of scope for a UI-parity rebuild.
2. **Four real, substantive macros were completely unsurfaced.** Grepping
   the frontend tree found zero references to `zoningAnalysis`,
   `walkabilityScore`, `densityCalc`, or `trafficImpact` anywhere before this
   change — real deterministic planning math (FAR/setback/height/parking
   from zone type, a 7-category walkability score, population/housing
   density classification with transit-mode fit, and a traffic-impact
   projection with a mitigation checklist) with no UI at all.
3. **Generic scaffold body.** The page rendered the auto-discovered-macro
   button wall directly in JSX — the same template-body pattern already
   fixed in the preceding batch of lenses. Removed.

## What changed

- Deleted the `Project`/`Infra` `useLensData` calls, the `ProjectData` /
  `InfraData` / `ArtifactDataUnion` interfaces, `STATUS_COLORS`, the
  `Projects` tab (and its search box / create button / item list / empty
  state), the `useRunArtifact` wiring, and the `handleAction` callback — none
  of it had a real backend behind it.
- Removed the generic action-wall body from the page's JSX entirely (import
  and usage both gone) so the honest UX grader stops treating the page as a
  thin template.
- Rebuilt the Dashboard tab to load real counts on mount from the three
  already-real list macros (`parcel-list`, `scenario-list`, `comment-list`)
  — parcels tracked, scenarios modeled, total dwelling units summed across
  scenarios' computed massing, total public comments plus a real
  support/neutral/oppose tally — with a genuine loading/retry-on-error state
  instead of instant fabricated numbers. The previously-honest "Workbench"
  quick-link block is kept and extended with the new Zoning tab.
- Added `ZoningSiteAnalysis.tsx`: four purpose-built forms (zone-type select
  + lot-size input; an amenity-category + walkable-checkbox list builder;
  population/area/housing-unit inputs; new-housing-units/new-commercial-sqft/
  current-ADT inputs), one per macro, each rendering the actual computed
  result fields (not a JSON blob) — mirrors the calculator-tab pattern
  established in `components/astronomy/AstroCalculators.tsx`.
- Added a new "Zoning & Site" tab (keyboard shortcut `z`) to `MODE_TABS`.

## Reference-parity checklist (CityEngine / ArcGIS Urban / CommunityViz shape)

| Capability | Disposition | Where |
|---|---|---|
| Parcel inventory with zone/lot metadata | ALREADY REAL | `ParcelManager` (`parcel-*`) |
| 3D massing/building-envelope generation from zoning | ALREADY REAL | `ParcelManager`, `ScenarioStudio` (`massingEnvelope`) |
| Alternative development-scenario authoring | ALREADY REAL | `ScenarioStudio` (`scenario-*`) |
| Side-by-side scenario comparison (yield/emissions) | ALREADY REAL | `ScenarioStudio` (`scenario-compare`) |
| Population/jobs/emissions impact dashboard | ALREADY REAL | `PlanExportPanel` (`impactDashboard`) |
| Shareable plan report export | ALREADY REAL | `PlanExportPanel` (`exportPlan`) |
| Transit walk-shed catchment analysis | ALREADY REAL | `TransitCoveragePanel` (`transitCoverage`) |
| Public-comment / stakeholder review workflow | ALREADY REAL | `PublicCommentPanel` (`comment-*`) |
| County-level demographic + affordable-housing context | ALREADY REAL | `CountyDataPanel` (`census-acs-county`, `hud-income-limits`) |
| Zoning envelope calculator (FAR/height/setback/parking) | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | `ZoningSiteAnalysis` (`zoningAnalysis`) |
| Walkability scoring | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | `ZoningSiteAnalysis` (`walkabilityScore`) |
| Density classification + transit-mode fit | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | `ZoningSiteAnalysis` (`densityCalc`) |
| Traffic impact projection + mitigation | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | `ZoningSiteAnalysis` (`trafficImpact`) |
| Honest project/permit-status tracking (proposed→approved→built) | GENUINELY MISSING | No backing domain macro exists; the prior "Projects" tab faked this with a client-only artifact store. Deferred — would need a real `urbanplanning.project-*` macro set (status workflow, permit dates, budget) before a UI is built; not scoped for this parity batch. |
| Live parcel/GIS basemap tiles (satellite/street imagery) | GENUINELY MISSING | `CityMap` is a legitimate local-coordinate schematic, not a georeferenced basemap. Deferred — needs a tile-provider integration decision (cost/ToS), out of scope for this batch. |
| Shadow/sun-path 3D massing study | GENUINELY MISSING | `massingEnvelope` returns a box-massing envelope (dimensions + yields), not a renderable sun-study. Deferred. |

## Verify-gate results

- `npx eslint app/lenses/urban-planning/page.tsx components/urban-planning/*.tsx` — clean.
- `npx tsc --noEmit -p .` — no urban-planning-specific errors.
- `node scripts/grade-ux-polish.mjs --honest` — `urban-planning` now `tier: "polished"`, `isGenericScaffold: false` (see the run's raw JSON in `audit/ux-polish-honest.json`).
