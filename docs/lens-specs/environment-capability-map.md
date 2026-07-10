# Environment Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

**Scope note:** this is the corporate/enterprise sustainability-reporting
lens (Watershed / Persefoni / EPA EJScreen shape — EJScreen lookup, RECs
ledger, offsets ledger, suppliers portal, decarbonization targets). It is a
separate lens from `eco` (the personal weather/AQI/species/carbon tracker
audited earlier this pass) — the two share no code and were not conflated.

## Backend surface

```
grep -noE "registerLensAction\([\"']environment[\"'], [\"'][a-zA-Z0-9_.\-]+[\"']" server/domains/environment.js | wc -l
```
→ **39** macros, all `registerLensAction("environment", ...)` in
`server/domains/environment.js` (1,119 lines). `grep -nE
"registerLensAction\(['\"]environment['\"]" server/server.js` → empty, no
inline registrations outside the domain file.

Two **additional** environment macros are registered in *other* domain files
via the separate `register()`/`MACROS` system (not `registerLensAction`/
`LENS_ACTIONS` — these are two distinct dispatch maps that `/api/lens/run`
checks in sequence, `LENS_ACTIONS` first, `MACROS` second — confirmed by
reading `server.js:39557-39572`): `environment.live_gbif`
(`server/domains/more-free-apis.js:342`) and `environment.live_air_quality`
(`server/domains/key-required-live.js:93`). Both are real, live, keyless/
key-gated external-API calls and both are genuinely wired (`GbifPanel.tsx`,
`AirQualityPanel.tsx`). `node scripts/lens-unsurfaced.mjs --lens environment`
audits only the 39-macro `registerLensAction` set (its own methodology), so
these two don't appear in its count either way.

The 39 macros split into three generations:
- **4 pre-parity "pure-compute environmental helpers"** (`populationTrend`,
  `complianceCheck`, `trailCondition`, `diversionRate`, lines 12-53) — real,
  small, deterministic handlers that read a generic `artifact.data` shape
  (survey time series / parameter+threshold list / trail array / waste
  totals) and return a computed trend, compliance verdict, maintenance
  priority ranking, or diversion percentage.
- **4 real free/keyed external-API integrations** (`epa-superfund-search`,
  `usgs-water-realtime`, `airnow-current`, `epa-ejscreen`, `noaa-climate-
  stations` — 5 total, lines 60-194 + 594-649): EPA Envirofacts Superfund
  search, USGS Water Services real-time gauges, EPA AirNow AQI (key-gated,
  honest `missing_api_key` failure), EPA EJScreen environmental-justice
  screening, NOAA Climate Data Online station lookup (key-gated).
- **30 "full-app parity: Watershed + Persefoni carbon accounting" macros**
  (lines 196-1118, explicit header comment in the source): emission factors
  catalog + lookup (EPA GHG Emission Factors Hub 2024 + eGRID 2022 + IPCC AR5
  GWP, 24 cited factors), Scope 1/2/3 activity log CRUD, supplier portal +
  Scope-3 disclosure tracking, SBTi-style decarbonization targets +
  trajectory, reduction-project backlog, RECs ledger, carbon-offsets ledger,
  dashboard summary, footprint breakdown, emissions trend vs. target
  trajectory, GHG-Protocol/CDP-style inventory report generation, bulk
  activity import (utility-bill/spreadsheet rows), reduction-scenario
  modeling, per-activity verification + audit trail, and an NWS
  severe-weather-alert → DTU ingest feed.

## Reference apps

Watershed / Persefoni (carbon accounting SaaS: activity log → Scope 1/2/3
rollup, targets, supplier engagement, inventory reports), EPA EJScreen
(environmental-justice mapping tool), a supplier-sustainability disclosure
portal (CDP Supply Chain-shape), EQuIS / ArcGIS Field Maps (field-survey and
environmental-asset management for the Sites/Species/Sampling/Trails/Waste
system — see below).

## Classification (before this pass)

**Mixed, but not in the way the assignment brief expected.** The 19-file
`components/environment/*` set is almost entirely real, correctly wired, and
well designed — this is the *strongest* backend/frontend correspondence
found in this Wave-3 batch (contrast with `eco`'s disconnected shadow CRUD or
`creative`'s fabricated project system). The genuine defects were narrower
and more subtle than "fake data": a dead legacy quick-actions cluster that
silently masked real computation behind an LLM guess, two real macros with
zero frontend callers, and two field-name mismatches between already-"real"
components and the actual macro response shape.

1. **18 of 19 components (`ActivityImportPanel`, `AirQualityPanel`,
   `AirQualityActionStack`, `AuditTrailPanel`, `CarbonFootprintDashboard`,
   `ComplianceDiversionPanel`, `EJScreenLookup`, `EmissionFactorsLibrary`,
   `EmissionsActivitiesPanel`, `GbifPanel`, `InventoryReportBuilder`,
   `OffsetsLedger`, `ProjectsBacklog`, `RECsLedger`, `ReportsBuilder`,
   `ScenarioModeler`, `SuppliersPortal`, `TargetsTracker`) — real, correctly
   wired, no fabrication.** Verified by reading every file and grepping for
   fabrication signatures
   (`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem\|hardcoded"
   components/environment/*.tsx` → 3 hits, all in comments *disclaiming*
   fake data, e.g. `AuditTrailPanel.tsx:9: "No mock entries — empty until..."`)
   and by grepping every `action: '...'` / `lensRun('environment', '...'` call
   site against the real macro name list above — every action id matched
   exactly (`offsets-list`, `recs-purchase`, `targets-progress`,
   `inventory-report`, etc. — no case/hyphen mismatches in this group).
   `ClimateShell.tsx` is a presentational silhouette component (props-only,
   no macro calls of its own) — genuinely 19 files, 18 with direct macro
   calls + `ClimateShell` as a pure view. `CarbonWorkbenchSection` (in
   `page.tsx`, mounts `ClimateShell` fed by `dashboard-summary` +
   `footprint-breakdown` + `emissions-trend` + `targets-list`) wires it for
   real.

2. **The legacy "Actions" quick-actions cluster in `page.tsx` was dead-wired
   — reachable, but silently wrong.** `DOMAIN_ACTIONS` (5 entries:
   `population_trend`, `compliance_check`, `diversion_calc`, `trail_report`,
   `water_quality`) drove a `handleAction()` → `useRunArtifact('environment')`
   → `POST /api/lens/environment/:id/run` → the `lens.run` macro's
   `LENS_ACTIONS.get('environment.<action>')` lookup (`server.js:38279`).
   None of the five action ids matched a registered macro name: the real
   macros are camelCase (`populationTrend`, `complianceCheck`,
   `diversionRate`, `trailCondition`) and `water_quality` has **no** backend
   macro at all. Every click therefore missed the `LENS_ACTIONS` lookup and
   fell through to the "AI fallback" utility-brain catchall
   (`server.js:38280-38297`, `source: "utility-brain"`) — an LLM guess
   silently standing in for cited, deterministic EPA/scientific math, with
   no indication to the user that the "Population Trend Analysis" or "Trail
   Condition Report" button never touched the real, well-cited macro at
   all. This is the same defect *class* CLAUDE.md's server.js section
   documents an established fix pattern for ("frontend uses snake_case,
   backend uses camelCase" → alias table, see `food`/`aviation`/`education`
   entries around `server.js:41985-42020`) — except here the correct fix was
   removal, not aliasing, because two of the five actions
   (`compliance_check` → `complianceCheck`, `diversion_calc` →
   `diversionRate`) were **already correctly, robustly wired** by
   `ComplianceDiversionPanel.tsx` (built by an earlier agent, calling the
   right macro names via the shared `CalcPanel` primitive with real,
   properly-shaped `parameters`/`totalVolume`/`divertedVolume` inputs) — so
   the legacy panel's versions were a strictly worse, broken duplicate of a
   feature that already existed correctly elsewhere. The remaining two
   (`population_trend` → `populationTrend`, `trail_report` →
   `trailCondition`) were genuinely never given a working home anywhere.
   `water_quality` had no macro to alias to at all — `complianceCheck`
   already explicitly covers "water/air/soil sampling" parameters per its
   own UI copy in `ComplianceDiversionPanel.tsx`, so `water_quality` was a
   redundant, unbacked duplicate of a capability `complianceCheck` already
   serves.

3. **Two macros were genuinely unsurfaced** (confirmed by
   `node scripts/lens-unsurfaced.mjs --lens environment` → `2/39`, and
   independently by `grep -rn "emission-factors-lookup\|noaa-climate-
   stations" concord-frontend/` → zero hits before this pass):
   `emission-factors-lookup` (single-factor detail lookup — `EmissionFactorsLibrary.tsx`
   only ever called the bulk `emission-factors-list`) and
   `noaa-climate-stations` (NOAA Climate Data Online station search by
   lat/lng — `EnviroPanel.tsx` had Superfund + USGS Water cards but no NOAA
   card, despite the macro sitting right next to `epa-ejscreen` in the
   backend file, both key-gated real government APIs).

4. **Two already-"real" components had field-name mismatches against the
   actual macro response shape — wired, but silently rendering blanks.**
   Found by cross-referencing every field the components read against the
   literal object the backend handler returns (not assumed from the
   component's own type annotations, which were the bug):
   - `EnviroPanel.tsx`'s `UsgsWater` sub-component typed the response as
     `{ site: string; readings: Array<{ parameter, value, unit }> }` and
     rendered `data.site` / `r.parameter` / `r.value`. The real
     `usgs-water-realtime` handler (`server/domains/environment.js:112-150`)
     returns `{ siteCode, readings: [{ siteName, variableName,
     variableDescription, unit, latestValue, latestDateTime, ... }] }` — no
     top-level `site`, no `parameter`, no `value` field. Every successful
     real USGS fetch rendered as a site name blank line plus rows reading
     "undefined · undefined ft" — data was genuinely flowing from the real
     API, but every label was wrong.
   - `EnviroPanel.tsx`'s `SuperfundSearch` sub-component typed sites as
     `{ siteName, epaId, nplStatus, city, state }` and used `s.epaId` as the
     React `key` plus rendered `s.nplStatus` as the status badge. The real
     `epa-superfund-search` handler returns `siteId` (not `epaId`) and
     `npListStatus` (not `nplStatus`) — every row had an `undefined` React
     key (a silent correctness/dedup hazard on top of the visible bug) and
     an always-empty NPL-status badge.

## What changed

- **`concord-frontend/app/lenses/environment/page.tsx`** (3,833 → 3,675
  lines): removed the dead-wired legacy Actions system in full —
  `DOMAIN_ACTIONS` array, `renderActionsPanel()`, `handleAction()`, the
  `runAction`/`useRunArtifact('environment')` hook, `selectedAction` +
  `actionResult` state, the `'actions'` member of the `view` union type, the
  "Actions" tab button, the `tab-actions` keyboard shortcut, the two "Action
  Result" JSON-dump panels, and the now-unused `useRunArtifact` import + `Zap`
  icon import. Also fixed a small honest-by-construction defect unrelated to
  the macro layer: the "Attach photo" button on the Species form
  (`renderFormFields`, case `'Species'`) created a native file `<input>` and
  called `.click()` on it with **no `onchange` handler** — picking a photo
  did nothing at all, silently discarding the selection. Since this lens has
  no photo-storage backend for field-survey records, the honest fix (not a
  fabricated "upload") is to fill the existing `photoLogRef` text field from
  the picked file's name — exactly what a user would otherwise type by hand.
- **`concord-frontend/components/environment/FieldMonitoringPanel.tsx`
  (new)** — a real, designed home for the two genuinely-orphaned pure-compute
  macros, `populationTrend` (species survey time series → trend/change-%) and
  `trailCondition` (trail asset list → maintenance-priority ranking), built
  on the same `CalcPanel` primitive `ComplianceDiversionPanel.tsx` already
  uses correctly: editable survey-point rows and trail rows, a numeric
  condition select (Good=5/Fair=3/Poor=1/Closed=0, matching the macro's
  numeric expectation instead of passing a raw string enum that would
  silently `NaN`), an Analyze button that calls both macros with correctly
  shaped `{ data: { surveyData } }` / `{ data: { trails } }` payloads, real
  result rendering (trend label + change-% + first/last count; a ranked
  maintenance-priority list with condition/usage/score), and Save-as-DTU.
  Mounted in `page.tsx` immediately after `ComplianceDiversionPanel`.
- **`concord-frontend/components/environment/EnviroPanel.tsx`** — three
  changes: (1) added `NoaaStations`, a third card (grid widened
  `md:grid-cols-2` → `md:grid-cols-3`) wiring the previously-unsurfaced
  `noaa-climate-stations` macro, with an honest "API token required" state
  (parses the `NOAA_CDO_TOKEN` error text) plus a free-signup link, matching
  the existing key-gated-API pattern already used by `AirQualityPanel.tsx`;
  (2) fixed `UsgsWater`'s field-name mismatch (`site`/`parameter`/`value` →
  `readings[0].siteName`/`variableDescription`/`latestValue`, matching the
  real handler shape verified by reading `server/domains/environment.js:112-150`
  directly) and added an honest empty state for a site code with no active
  readings; (3) fixed `SuperfundSearch`'s field-name mismatch (`epaId`/
  `nplStatus` → `siteId`/`npListStatus`, matching the real handler shape at
  `server/domains/environment.js:74-86`), which also fixes an `undefined`
  React `key` on every row.
- **`concord-frontend/components/environment/EmissionsActivitiesPanel.tsx`**
  — wired the previously-unsurfaced `emission-factors-lookup` macro as a
  live "verify before you log" preview: whenever the selected factor
  changes, the panel authoritatively re-fetches that single factor's
  `co2e`/`unit`/`source` via the lookup macro (rather than trusting the
  already-cached bulk `emission-factors-list` response) and shows a
  computed "≈ X kg CO₂e (Y t) at `co2e` kg/unit · `EPA source citation`"
  line above the activity table as the user types an amount — a genuine,
  non-decorative use of the macro (authoritative re-confirmation + inline
  citation), not a gratuitous call added only to clear the unsurfaced flag.

No changes to `server/domains/environment.js` or any other backend file —
every fix above closed a *frontend* reachability or correctness gap; the
backend macros were already correct as written (confirmed by the passing
`environment-domain-parity.test.js` suite, unmodified, both before and after
this pass).

## Verification

- `cd concord-frontend && npx eslint app/lenses/environment/page.tsx components/environment/EnviroPanel.tsx components/environment/EmissionsActivitiesPanel.tsx components/environment/FieldMonitoringPanel.tsx` — clean, exit 0.
- Manual type read-through in place of a full-project `tsc` (avoided here to
  not race sibling agents editing other lenses concurrently in the same
  working tree): `FieldMonitoringPanel`'s generic `updateTrail<K extends
  keyof TrailRow>(i, key, value: TrailRow[K])` helper is called with
  `e.target.value as TrailRow['condition']` / `as TrailRow['usage']` casts
  from a `<select>` whose options are exhaustively constrained to those
  literal unions, so the cast is sound; `CalcPanel<PopulationResult,
  TrailResult>`'s `renderResults`/`dtu.title`/`dtu.content` callbacks receive
  `LR`/`RR`-typed (non-null, per `CalcPanel`'s own `canSave` gate) arguments
  matching the exact pattern `ComplianceDiversionPanel.tsx` already uses
  unmodified. `EnviroPanel.tsx`'s new `UsgsReading`/`SuperfundSite`
  interfaces use optional (`?`) fields matching the handler's actual
  possibly-sparse response, with all array/index access guarded by a
  `.length > 0` check before use.
- Fabrication + dead-wiring re-grep after the edit:
  `grep -n "Math.random\|handleAction\|DOMAIN_ACTIONS\|runAction\b" app/lenses/environment/page.tsx` → no hits (was 1 handleAction cluster + a DOMAIN_ACTIONS array before).
- `node scripts/lens-unsurfaced.mjs --lens environment` — re-run after the
  edit: **`0/39 macros never referenced in the frontend`** (was `2/39`).
- `cd server && node --test tests/environment-domain-parity.test.js` —
  **38/38 pass, 0 fail** (unchanged backend, confirms no regression from the
  frontend-only fix).
- Did not touch `server/domains/environment.js` or any other backend file —
  purely a frontend reachability + correctness pass, matching the `eco` and
  `creative` capability maps' precedent for this program.
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
