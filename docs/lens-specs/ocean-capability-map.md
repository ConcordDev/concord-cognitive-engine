# Ocean Lens — Capability Map (Frontend Rebuild Program, Wave 2 batch 5)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("ocean"' server/domains/ocean.js` → 24
> (+ `ocean.live_tides`, registered in `server/domains/free-api-live.js` →
> 25 total real ocean macros).

## Reference apps + parity target

- **NOAA Tides & Currents / CO-OPS** (tidesandcurrents.noaa.gov) — the
  authoritative US tide-prediction + water-level-observation tool.
  Concord's `noaa-tide-prediction`, `noaa-water-level`, and `noaa-stations`
  macros call this exact API.
- **Windy / Surfline-class marine-forecast + surf-report tools** — live
  swell/wind/buoy conditions and a computed surf-quality score. Concord's
  `marine-forecast` (Open-Meteo Marine), `ndbc-buoy` (NOAA NDBC realtime
  buoys), and `surf-score` macros cover this.
- **MarineTraffic** — live AIS vessel tracking. Concord's `ais-vessels`
  macro (AISHub feed, contributor-key-gated with an honest
  `configRequired` response when unset — never fabricated ship positions).
- **Parity target** (owner's framing): the only difference between the
  ocean lens and NOAA+Windy+MarineTraffic combined should be UI polish and
  catalog scope — every reading on screen should trace to a real source
  (NOAA, Open-Meteo, NDBC, AISHub, NWS) or a real deterministic compute.

## Checklist — reference-app features vs. Concord ocean

| Feature | Bucket | Disposition |
|---|---|---|
| Predicted tide highs/lows for a NOAA station | ALREADY REAL | `ocean.noaa-tide-prediction` → `NoaaTidesPanel`/`TidePredictions`/`TideActionStack` |
| Observed (as opposed to predicted) water level at a station | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `ocean.noaa-water-level` had zero UI — **fixed this rebuild**, new `NoaaStationExplorer` |
| Browse/search the full NOAA station directory (not just a curated 5–7 station list) | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `ocean.noaa-stations` had zero UI — **fixed this rebuild**, same `NoaaStationExplorer` |
| Live marine wave/swell forecast at any lat/lon | ALREADY REAL | `ocean.marine-forecast` (Open-Meteo Marine) → `LiveMarinePanel` |
| Live buoy observations | ALREADY REAL | `ocean.ndbc-buoy` (NOAA NDBC) → `LiveMarinePanel` |
| Computed surf-quality score | ALREADY REAL | `ocean.surf-score` → `LiveMarinePanel` |
| Sea-surface-temperature lookup / layer | ALREADY REAL | `ocean.sea-surface-temp` → `LiveMarinePanel` |
| Tide alerts / reminders | ALREADY REAL | `ocean.tide-alert-*` + `tide-alerts-check` → `LiveMarinePanel` |
| Live AIS vessel tracking | ALREADY REAL (honest-gated) | `ocean.ais-vessels` → `LiveMarinePanel`; returns `{ok:false, configRequired:"AISHUB_USERNAME"}` when no contributor key is set, never fabricated positions |
| Personal surf/dive/fishing spot log + session journal | ALREADY REAL | `ocean.spot-*` + `session-*` + `ocean-dashboard` → `SpotLog` |
| Session export (GPX/CSV) | ALREADY REAL | `ocean.session-export` → `LiveMarinePanel` |
| Wave-physics analyzer (significant height, wavelength, Beaufort, sea state) | ALREADY REAL | `ocean.waveAnalysis` → `WaveEcosystemPanel` |
| Marine ecosystem / species diversity scoring | ALREADY REAL | `ocean.marineEcosystem` → `WaveEcosystemPanel` |
| Lunar-phase tidal estimate (approximate, any location) | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `ocean.tidalPrediction` had zero UI — **fixed this rebuild**, new `TidalSalinityPanel` |
| Depth/salinity/temperature water-column profile (halocline detection) | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `ocean.salinityProfile` had zero UI — **fixed this rebuild**, same `TidalSalinityPanel` |
| Marine weather alerts → DTU feed | ALREADY REAL | `ocean.feed` (NWS marine alerts) → `LensFeedButton`/`LensFeedPanel` |
| Encyclopedia-grade oceanography reference reading | ALREADY REAL | Wikipedia oceanography search panel |

Every checklist item resolved to ALREADY REAL or BACKEND-CAPABLE-BUT-UNSURFACED-and-now-fixed. No GENUINELY MISSING items.

## What this rebuild fixed

1. **Removed the entire fake "Vessels / Research / Marine Life / Ports /
   Weather / Conservation" tab system.** All six were a single generic
   `useLensData('ocean', <Vessel|Research|Marine|Port|SeaWeather|
   Conservation>, ...)` CRUD store — user-typed vessel names, research
   expedition statuses, conservation records — with **zero** connection to
   any of the 25 real `ocean.*` macros. The real vessel-tracking macro
   (`ocean.ais-vessels`, live AISHub data) was never called by this tab
   system at all.
2. **Removed a fabricated "Ocean Depth Zones" visualization** that read
   `Math.floor(marine.length * 0.5) || 12` (and `|| 8`, `|| 4`, `|| 2`,
   `|| 1`) as its species-per-zone counts — hardcoded fallback numbers
   presented as if they were real biodiversity data whenever the fake
   `marine` CRUD list was empty (which it always was for a new user). A
   textbook "zero demo content" violation.
3. **New `TidalSalinityPanel`** — wires `tidalPrediction` + `salinityProfile`
   side by side via the `CalcPanel` primitive.
4. **New `NoaaStationExplorer`** — a real two-step workflow: search the
   live NOAA CO-OPS station directory (`noaa-stations`, filterable by
   state/type), pick a station, view its live observed water-level
   readings (`noaa-water-level`) with a real sparkline built from the
   actual 6-minute-interval reading series.
5. **Removed `<UniversalActions domain="ocean" artifactId={items[0]?.id}
   />` and `<LensFeaturePanel lensId="ocean" />`** — `items` came from the
   now-deleted fake CRUD store, so `artifactId` was always undefined or
   pointed at fabricated data; the collapsible features panel duplicated
   what the real tabs now show directly.
6. **Reorganized into 5 real tabs** (Tides / Waves & Water / Live Marine /
   Logbook / Map) replacing the prior 8 tabs (6 of which were fake).
   Map now renders real geotagged spots from `ocean.spot-list`, not the
   fake vessel positions the old Map tab drew.

## Left alone (already real)

`NoaaTidesPanel`, `TidePredictions`, `TideActionStack`, `WaveEcosystemPanel`,
`LiveMarinePanel` (633 LOC — already covers AIS/marine-forecast/NDBC/
surf-score/SST/tide-alerts/session-export), `SpotLog`, `WikipediaSearchPanel`,
`LensFeedButton`/`LensFeedPanel` — all pre-existing, already macro-backed.

## Verification

- `npx eslint app/lenses/ocean/page.tsx components/ocean/TidalSalinityPanel.tsx components/ocean/NoaaStationExplorer.tsx` — clean, 0 errors / 0 warnings.
- `npx tsc --noEmit -p .` — 0 errors project-wide (run together with geology + forestry).
- No pre-existing ocean-lens test file (confirmed by `find . -iname "*ocean*" | grep -i test`) — nothing to update; none was silently deleted.
- `node scripts/verify-lens-backends.mjs` — ocean stays WIRED (258/260 total, 0 broken, unchanged from baseline).
- `node scripts/grade-ux-polish.mjs --honest` — ocean: `tier: "polished"`, `isGenericScaffold: false` (was `functional` / `isGenericScaffold: true` before this rebuild).
