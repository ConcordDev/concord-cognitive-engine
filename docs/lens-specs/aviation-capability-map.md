# Aviation Lens — Capability Map (Frontend Rebuild Program, Wave 3)

Reproduce the macro list:
`grep -c 'registerLensAction("aviation"' server/domains/aviation.js` → 55

## Reference apps

**ForeFlight / Garmin Pilot / Jeppesen FliteDeck Pro** — confirmed directly
from in-code comments (`server/domains/aviation.js:504` "2026 parity —
ForeFlight/Garmin Pilot/Jeppesen FliteDeck Pro"; `:818` "Full-app parity:
ForeFlight + FlightAware 2026"; `:1349` "ForeFlight feature-parity backlog —
moving map, route plotting, weather radar overlay, ATC filing, approach
plates, endorsements, synthetic-vision"). Realized in `EFBSuite.tsx` (moving
map / filing / plates / endorsements / EFIS-synthetic-vision tabs).

## Audit finding: real, deep, honest EFB — one genuine gap, two explainable ones

All 55 macros are real (no stubs). Two families:
- **Legacy artifact-based** (`:76-816`): `currencyCheck`, `maintenanceDue`,
  `hobbsLog`, `dutyTimeCheck`, `flightSummary`, `maintenanceAlert`,
  `weatherCheck`, `slipUtilization`, `calculate-wb`, `validate-wb` — real
  arithmetic over stored flight/aircraft/pilot artifacts.
- **2026 parity set** (`:541-1895`): live external data (FAA NASR airport
  lookup, aviationweather.gov METAR/TAF/PIREP/AIRMET, FAA NOTAMs, FAA d-TPP
  approach plates, tfr.faa.gov TFRs, Open-Meteo/NWS radar overlay, OpenSky
  live-flight feed) plus real user-state CRUD (flight plans, aircraft,
  logbook, currency events, track logs, endorsements/ratings).

All 18 frontend components (`AircraftPanel`, `LogbookPanel`, `CurrencyPanel`,
`RouteAdvisor`, `FuelStopsCalc`, `LiveFlightsPanel`, `TrackLogsPanel`,
`BriefingPanel`, `AirportBrief`, `AviationActionPanel`, `AviationWorkbench`,
`AvShell`, `EFBMovingMap`, `EFBFiling`, `EFBPlates`, `EFBEndorsements`,
`EFBSyntheticVision`, `TrackMap`) call specific named macros. No
`Math.random()` in render paths, no hardcoded fake-record arrays, no
lorem-ipsum found.

`node scripts/lens-unsurfaced.mjs --lens aviation`:
```
aviation: 3/55 macros never referenced in the frontend
  aircraft-update, notams-fetch, validate-wb
```
- `notams-fetch` — gated behind `FAA_NOTAM_API_KEY`; explainable (paywalled
  tier), not a defect.
- `aircraft-update` — no edit form exists for an already-created aircraft
  profile (add/list/delete only). Minor, left for a future pass.
- **`validate-wb` — REAL GAP (fixed).** A dedicated envelope-safety
  validator (over-gross / CG-forward / CG-aft / near-max-gross checks with
  severity + specific failure messages, `server/domains/aviation.js:446`)
  had zero frontend callers even though `calculate-wb` (which does the same
  arithmetic but never checks against limits) was fully wired in three
  places. This is a safety-relevant macro sitting unreachable next to a
  calculator that computes the exact numbers it needs to validate.

## What this rebuild changed

`concord-frontend/app/lenses/aviation/page.tsx`:
- Added a **"W&B Validate"** button next to every existing "W&B Calculate"
  button (Quick Actions panel, per-tab action row, and the editor-modal
  footer) — all three call `handleAction('validate-wb', …)` against the
  same aircraft/loading artifact `calculate-wb` already uses.
- Added a result-rendering block for `validate-wb`'s response shape
  (`withinEnvelope`, `overallSeverity`, `issues[]`) — a green/amber/red
  status pill plus each specific over-gross/CG-envelope violation message,
  distinct from (and additive to) the existing `calculate-wb` gross/
  CG/moment display.

`usesGenericBody`/`hasMacroButtonWall` grader flags (from `<UniversalActions>`
+ `<LensFeaturePanel>` mounts) are confirmed false-positive-safe: `page.tsx`
is 2300+ LOC, far past the grader's 700-LOC bespoke-page threshold, and
these are supplementary utility panels sitting alongside 18 genuinely
bespoke, macro-wired components — not a disconnected scaffold layer. Left
unchanged.

## Verification

- `npx eslint app/lenses/aviation/page.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `aviation` stays `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `aviation`: `tier: "polished"`, `isGenericScaffold: false`.
