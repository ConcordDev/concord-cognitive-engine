# Geology Lens — Capability Map (Frontend Rebuild Program, Wave 2 batch 5)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("geology"' server/domains/geology.js` → 30
> (+ `geology.live_quakes_today`, registered in `server/domains/free-api-live.js` →
> 31 total real geology macros).

## Reference apps + parity target

- **Rockd** (American Geosciences Institute / Macrostrat) — the real
  field-geology app: bedrock-map overlay at your GPS position, "rocks near
  me," geologic-time-aware unit lookups. Concord's `geologic-map` +
  `rock-units-here` macros hit the *same* Macrostrat API Rockd is built on,
  so this is a genuine same-data-source comparison, not an analog guess.
- **Mindat.org** — the reference mineral/rock database + personal
  collection tracker (specimen checklist, field observation log, locality
  data). Concord's observation log / specimen collection / field-trip
  planner macros cover this shape.
- **USGS Earthquake Hazards Program** (earthquake.usgs.gov) — the live
  seismic-catalog + ASCE 7-22 seismic-design-parameter lookup tool.
  Concord's `recent-earthquakes` + `usgs-seismic-hazard` macros call the
  actual USGS FDSN + DESIGNMAPS web services.
- **Parity target** (owner's framing): the only difference between the
  geology lens and Rockd+Mindat+USGS combined should be UI polish and
  which specific data the user has logged — every number on screen should
  trace to one of these three real sources or a real deterministic
  compute, never a placeholder.

## Checklist — reference-app features vs. Concord geology

| Feature | Bucket | Disposition |
|---|---|---|
| Bedrock geologic-map overlay at a coordinate | ALREADY REAL | `geology.geologic-map` (Macrostrat) → `GeologicMapPanel` |
| "Rocks near me" / stratigraphic column at a point | ALREADY REAL | `geology.rock-units-here` (Macrostrat) → `GeologicMapPanel` |
| Live earthquake feed (last 24h+) | ALREADY REAL | `geology.recent-earthquakes` + `geology.live_quakes_today` → `EarthquakeList` + `UsgsQuakePanel` |
| ASCE 7-22 seismic design parameters (Ss, S1, Sds, SDC, PGA) at a US site | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `geology.usgs-seismic-hazard` had zero UI — **fixed this rebuild**, new `SeismicHazardPanel` |
| Deterministic seismic-risk / amplification-factor estimate anywhere on Earth | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `geology.seismicRisk` had zero UI — **fixed this rebuild**, same `SeismicHazardPanel` |
| Hand-specimen rock classification (hardness/luster/texture → igneous/sedimentary/metamorphic) | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `geology.rockClassify` had zero UI (the fake "samples" CRUD tab stood in its place) — **fixed this rebuild**, new `RockMineralIdPanel` |
| Mineral ID test battery (hardness/streak/cleavage/fracture/specific gravity → confidence score) | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `geology.mineralId` had zero UI — **fixed this rebuild**, same `RockMineralIdPanel` |
| Build a real stratigraphic column from logged layers (cumulative depth, fossiliferous count) | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `geology.stratigraphicColumn` had zero UI (a hardcoded, unvarying Cenozoic→Paleozoic time-scale table stood in its place — see "What this rebuild fixed") — **fixed this rebuild**, new `StratigraphicColumnPanel` |
| Field observation journal (rock/mineral/fossil/outcrop/structure, geotagged, tagged, searchable) | ALREADY REAL | `geology.observation-*` + `field-dashboard` → `FieldLog` |
| Strike/dip structural measurements (digital compass, stereonet mean-strike) | ALREADY REAL | `geology.measurement-*` → `StructuralCompass` |
| Geotagged sample photos (EXIF GPS) | ALREADY REAL | `geology.photo-*` → `SamplePhotoCapture` |
| Specimen collection / checklist (mineral, rock, fossil, gem) | ALREADY REAL | `geology.collection-*` → `SpecimenCollection` |
| Field-trip / outcrop-stop sequencing with per-stop notes | ALREADY REAL | `geology.fieldtrip-*` → `FieldTripPlanner` |
| Encyclopedia-grade geology reference reading | ALREADY REAL | Wikipedia geology search panel |
| Live wildfire/earthquake-style world feed → DTU ingestion | ALREADY REAL | `geology.feed` (USGS significant-earthquake feed) → `LensFeedButton`/`LensFeedPanel` |

Every checklist item resolved to ALREADY REAL or BACKEND-CAPABLE-BUT-UNSURFACED-and-now-fixed. No GENUINELY MISSING items — Concord's geology domain already had full reference-app-grade backend coverage; the gap was entirely in the frontend not surfacing 5 of the 31 real macros, and in the 2 fake tabs described below crowding out the real ones.

## What this rebuild fixed

1. **Removed a fully fabricated "Samples" tab.** The `samples` tab was a
   disconnected `useLensData('geology','sample',...)` generic-CRUD store —
   arbitrary user-typed rock name/type/location with a client-side "Run AI
   analysis" button wired to a generic `analyze` action, no tie to any of
   the 31 real `geology.*` macros. The real analogous tool
   (`geology.rockClassify` / `geology.mineralId`) had never been called
   anywhere on the page.
2. **Removed a fully fabricated "Sites" tab.** Same `useLensData` pattern
   (`'site'` type) — a parallel data model with no backend macro behind it
   at all.
3. **Removed a hardcoded, unvarying "Stratigraphic Column" tab.** It
   rendered a fixed 7-row Cenozoic→Paleozoic geologic-time-scale table
   (`{ era: 'Cenozoic', period: 'Quaternary', age: '2.6 Ma - Present', ... }`
   literals) regardless of any user input — a textbook instance of the
   "zero demo content" violation CLAUDE.md names. The real
   `geology.stratigraphicColumn` macro (build a column from logged layers,
   compute cumulative depth) had zero UI. Replaced with
   `StratigraphicColumnPanel`, a real layer-entry builder.
4. **New `RockMineralIdPanel`** — wires `rockClassify` + `mineralId` side
   by side via the shared `CalcPanel` primitive (same pattern already
   proven in `WaveEcosystemPanel`/`MaterialsToolkit`).
5. **New `SeismicHazardPanel`** — wires `seismicRisk` (deterministic,
   works anywhere) + `usgs-seismic-hazard` (live USGS DESIGNMAPS ASCE 7-22
   lookup, US territory only) side by side.
6. **Removed `<UniversalActions domain="geology" artifactId={undefined}
   compact />`** — `artifactId` was hardcoded `undefined`, so every button
   was permanently disabled. Not a designed feature; deleted.
7. **Reorganized into 6 real tabs** (Field Log / Identify / Structure &
   Strat / Seismic / Map / Collection) instead of the prior 5 tabs, 2 of
   which were fake and 1 of which (Stratigraphy) was fabricated.

## Left alone (already real)

`FieldLog`, `StructuralCompass`, `SamplePhotoCapture`, `SpecimenCollection`,
`FieldTripPlanner`, `GeologicMapPanel`, `EarthquakeList`, `UsgsQuakePanel`,
`WikipediaSearchPanel`, `LensFeedButton`/`LensFeedPanel` — all pre-existing,
already macro-backed against real `geology.*` handlers or real external
APIs (USGS, Macrostrat, Wikipedia).

## Verification

- `npx eslint app/lenses/geology/page.tsx components/geology/RockMineralIdPanel.tsx components/geology/SeismicHazardPanel.tsx components/geology/StratigraphicColumnPanel.tsx` — clean, 0 errors / 0 warnings.
- `npx tsc --noEmit -p .` — 0 errors project-wide (run together with ocean + forestry).
- `node --test`/vitest: `tests/geology-lens-states.test.tsx` (8/8 passing) — targets `FieldLog` directly, untouched by this rebuild, still green.
- `node scripts/verify-lens-backends.mjs` — geology stays WIRED (258/260 total, 0 broken, unchanged from baseline).
- `node scripts/grade-ux-polish.mjs --honest` — geology: `tier: "polished"`, `isGenericScaffold: false` (was `functional` / `isGenericScaffold: true` before this rebuild).
