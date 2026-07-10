# Eco Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -n 'register("eco"\|registerLensAction("eco"' server/domains/eco.js | wc -l
```
→ **27** macros, all `registerLensAction("eco", ...)`. `server/domains/eco.js` is
1,406 lines. There is a separate, much smaller `server/domains/ecology.js`
(58 lines, 4 read-only macros: `homes_for_world`, `sleep_patterns`,
`imbalances`, `is_at_home`) — confirmed **unrelated** to this lens: it feeds
Concordia's Layer-6 creature-homes/circadian substrate for the 3D world sim,
not the personal-ecology-tracker `eco` lens. `grep -rn '"ecology"' server/server.js`
shows it registered only via `registerEcologyMacros` alongside the world's
`ecology-quest-cycle` heartbeat — no `concord-frontend/app/lenses/eco/` or
`concord-frontend/components/eco/` file references `ecology.*` anywhere
(`grep -rln '"ecology"\|ecology\.' concord-frontend/app/lenses/eco/ concord-frontend/components/eco/` → empty). Left untouched, per the assignment.

`node scripts/lens-unsurfaced.mjs --lens eco` → `eco: 0/27 macros never
referenced in the frontend` — every macro has at least one call site. That
number is necessary but not sufficient: two of the 27 (`carbonFootprint`,
`biodiversityIndex`) *were* referenced, but through a call path that could
never actually fire in production (see below) — the unsurfaced-script's
static reachability check can't see that a macro is wired to a dead button.

No inline `registerLensAction("eco"...)` or `register("eco"...)` calls exist
in `server.js` outside the domain file (`grep -n 'registerLensAction("eco"\|register("eco"' server/server.js` → empty). `server/lib/lens-manifest.js` /
`lens-features.js` / `lens-features-extended.js` carry no eco-specific
per-macro feature entries — the lens isn't in the manifest's declared-feature
system, only in `lens-registry.ts` (absorbed under Meta's `absorbedLensIds`
and as a standalone entry, `id: 'eco'`, line 691).

The 27 macros split into two generations:
- **3 original "creative-tools" macros** (`carbonFootprint`, `biodiversityIndex`,
  `sustainabilityScore`, lines 15–499): real, sophisticated, cited math —
  scope-1/2/3 GHG accounting with 30+ built-in emission factors, Shannon/
  Simpson/Margalef/Menhinick biodiversity indices with a rarefaction curve,
  and a 15-indicator ESG scoring model. Registered as classic
  `registerLensAction` handlers that read from `artifact.data`.
- **24 "parity-sprint" macros** (lines 501–1300, comment: "Joro / Klima /
  Windy / iNaturalist / NREL"): weather-forecast + aqi-current (Open-Meteo,
  keyless), climate-actions catalog/log, species-identify (LLaVA vision),
  energy-estimate (deterministic PVWatts-style solar model), biodiversity
  life-list CRUD, observation-feed (GBIF occurrence API), footprint-record/
  history/delete, challenges catalog/join/checkin/mine/leave (JouleBug-style
  streaks), species-suggest (GBIF taxonomy backbone), saved-locations CRUD,
  environmental-alerts (AQI/UV/pollen composite from Open-Meteo).

Every external-API macro fails **honestly** on network error — no synthetic
fallback data. Direct quote from the code (`server/domains/eco.js:572-576`):
> "Per 'everything must be real' directive: no synthetic week fallback. Open-Meteo is the real source; surface the network error."

## Reference apps

- **Weather/AQI**: IQAir/AirVisual (hero temp + AQI gradient + pollutant
  breakdown + saved locations), Apple Weather / Carrot Weather (hourly strip,
  7-day cards).
- **Species ID + sightings**: iNaturalist / Seek (photo → candidate species,
  personal life list, nearby community observations, taxonomy fallback
  suggestions).
- **Carbon tracking**: Klima / Capture (log activities → computed footprint
  with scope breakdown and equivalencies, trend over time, curated
  high-impact action library).
- **Habit streaks**: JouleBug (recurring sustainability habits with
  check-ins, streaks, points).

## Classification (before this pass)

**Mixed**: a genuinely strong, real, API-wired sub-lens (10 of 11 tabs) sitting
alongside an untouched pre-parity-sprint scaffold that never got cleaned up.
Specifically:

1. **`components/eco/*` (12 files) — all real, all clean.** Verified by
   reading every file and grepping for fabrication signatures:
   `grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem\|hardcoded" components/eco/*.tsx app/lenses/eco/page.tsx`
   → exactly one hit (the page-level fake simulation panel, below — zero
   hits inside any component file). `WeatherPanel`, `WeatherRadar`,
   `AQIPanel` hit Open-Meteo; `ObservationFeed`/`SpeciesSuggest` hit GBIF;
   `SpeciesIdentifier` hits LLaVA vision; `EnergyEstimator` computes a
   documented PVWatts-derived model; `BiodiversityLog`/`FootprintTrend`/
   `EcoChallenges`/`EnvAlerts` are real CRUD over the 24 parity-sprint
   macros with honest empty states ("No data yet. Record a footprint
   snapshot to start tracking your trend over time.") — no invented numbers
   anywhere.

2. **`app/lenses/eco/page.tsx` (pre-rebuild, 1,310 lines) — a fabricated
   legacy scaffold layered on top of the real sub-lens.** Three concrete
   defects, all now fixed:

   - **Math.random() in the render path** (`renderSimulationControls`,
     old lines 905-978): a fake "Ecosystem Simulation" panel — a "Start
     Simulation" button that toggled local state only (no backend call),
     three always-"Active" pulsing icons, and a 60-bar visualization
     computed as `20 + Math.sin(i*0.3 + Date.now()*0.001)*30 + Math.random()*20`.
     This is the exact defect class CLAUDE.md names explicitly ("Math.random()
     in render paths"). Removed entirely.
   - **A pure-decoration sine-wave chart** (old `renderOverview`, "Growth OS
     Mapping": `height: 30 + Math.sin(i*0.5)*50` over 30 bars) rendered
     unconditionally with no data behind it at all. Removed.
   - **A disconnected 4-tab generic-CRUD cluster** — Populations, Climate
     sim, Biodiversity sim, and Impact tabs, all sourced from a generic
     `useLensData('eco', <type>, { noSeed: true })` hook against DTU types
     (`population`, `climate`, `biodiversity`, `impact`) that **no macro in
     `eco.js` ever produces** and that had **no creation UI anywhere on the
     page** — confirmed by reading the full 1,310-line file: there is no
     form, button, or macro call that could ever populate these lists. They
     were permanently empty in any real deployment; a professional-looking
     species table, temperature/precipitation/CO2/UV charts, a zone
     biodiversity-index comparison, and an impact-assessment tracker that
     could never show a single real row. This is the "disconnected generic
     CRUD" pattern from the rebuild methodology — a plausible-looking
     surface with zero path to real data. Removed (nav entries + render
     functions + the supporting interfaces/color-maps/computed aggregates).

3. **The three original creative-tools macros were real but genuinely
   unreachable** — the *"backend-capable-but-unsurfaced"* class, not
   fabrication, but still a defect. The old page's "AI Eco Analysis" panel
   called `carbonFootprint` / `biodiversityIndex` / `sustainabilityScore`
   through `useRunArtifact`, which POSTs to `/api/lens/eco/:id/run` against
   a pre-existing generic artifact's `.data` field. The artifact list
   (`useLensData('eco', 'metric', { seed: [] })`) had an **empty seed** and
   **no creation form anywhere** — so `metricItems` was always `[]`,
   `metricItems[0]?.id` was always `undefined`, and every button in that
   panel was permanently `disabled`. The math itself (verified by reading
   `server/domains/eco.js:15-499`) is genuinely good: cited emission
   factors, real Shannon/Simpson diversity computation, a 15-indicator ESG
   model with maturity-level classification — it just had no reachable door.

## What changed

- **`concord-frontend/components/eco/CarbonCalculator.tsx` (new)** — a
  bespoke activity-based carbon-footprint calculator that calls
  `eco.carbonFootprint` directly via `/api/lens/run` (confirmed at
  `server.js:39558-39564`: that route builds a *virtual* artifact whose
  `.data` **is** the `input` object, so `input.activities` lands exactly
  where the handler reads `artifact.data.activities` — no pre-existing
  artifact needed). The activity/offset catalogs are a curated subset of
  the handler's own `emissionFactors`/`offsetFactors` keys (category+type
  concatenate to the lookup key), so every logged activity hits a real,
  cited built-in factor rather than the zero-value "user-provided"
  fallback. Renders the full scope-1/2/3 breakdown, category breakdown,
  carbon-neutral badge, and equivalencies (trees/car-km/flights) the
  handler already computes, then offers "Save to footprint trend," which
  calls `eco.footprint-record` with the computed total/net so the
  Footprint-trend tab's chart is now fed by a real calculation instead of a
  hand-typed number.
- **`concord-frontend/app/lenses/eco/page.tsx` (rewritten, 1,310 → 236
  lines)** — removed the fake simulation panel, the sine-wave decoration,
  the four disconnected tabs (Populations/Climate/Biodiversity-sim/Impact)
  and all their supporting types/color-maps/computed aggregates, and the
  dead "AI Eco Analysis" button wall. The Overview tab is now a real
  feature-dashboard: one designed card per real tab (icon + one-line
  description of what's actually wired), each a genuine navigation action,
  not a generic action-array component. The Footprint tab now stacks the
  new Carbon Calculator above the existing Footprint Trend chart, wired
  together by a refresh key so saving a calculation immediately shows up in
  the trend. Keyboard shortcuts were remapped from the removed tabs onto
  the surviving real ones (o/w/q/s/f). `UniversalActions` is kept as the
  small secondary AI-helper strip it's designed to be (no `artifactId`, per
  its own optional-prop contract) — the page around it is now overwhelmingly
  bespoke, not the generic surface the strip could otherwise stand in for.
- **`concord-frontend/components/eco/BiodiversityLog.tsx`** — added a
  "Diversity index" panel: when the user's life list has ≥2 species, a
  button groups the observations into species counts client-side and calls
  `eco.biodiversityIndex` with them, rendering species richness, Shannon H',
  Simpson's D, and the diversity label the handler already computes. This
  gives the second previously-unreachable macro a genuine, on-brand home
  (iNaturalist-style "your stats").
- **`sustainabilityScore` (ESG scoring) — deliberately left unsurfaced,
  honestly.** It's real, tested-looking math (board diversity, transparency,
  labor practices, emissions, waste — a corporate ESG framework with
  maturity tiers), but it doesn't fit a *personal* ecology-tracker lens: no
  individual has "board diversity" or "regulatory compliance" data to enter.
  Disposition: **genuinely missing feature-market fit for this lens as
  scoped**, not fabricated and not hidden — a future "Eco for
  Organizations/Teams" surface (outside this lens's scope) would be the
  natural home if ever built. Left registered and functional at the macro
  layer; not wired to any UI.

## Verification

- `cd concord-frontend && npx eslint app/lenses/eco/page.tsx components/eco/CarbonCalculator.tsx components/eco/BiodiversityLog.tsx` — clean, exit 0.
- Manual type read-through in place of a full-project `tsc` (avoided here to
  not race the 5 sibling agents editing other lenses concurrently in the
  same working tree): `handleAcceptSpecies`'s narrower parameter object
  type is a valid target for `SpeciesIdentifier`'s `onAccept?: (s:
  SpeciesSuggestion, imageDataUrl: string) => void` under TypeScript's
  contravariant parameter checking (the wider `SpeciesSuggestion` is
  assignable to the narrower `{ commonName, scientificName }`), and an
  `async` handler is a valid implementation of a `void`-returning callback
  type (a standard, permitted TS pattern also used unmodified elsewhere on
  this page, e.g. the tab-button `onClick` handlers).
- Fabrication re-grep after the edit: `grep -n "Math.random" app/lenses/eco/page.tsx components/eco/*.tsx` → no hits (was 1 before).
- `node scripts/lens-unsurfaced.mjs --lens eco` was re-run after the edit and
  still reports `0/27 macros never referenced in the frontend` — the fix
  didn't just move macros around, it closed a real reachability gap
  (`carbonFootprint`, `biodiversityIndex` now have live call sites that can
  actually execute, not just a disabled button citing them).
- Did not touch `server/domains/ecology.js` (confirmed unrelated, see
  above) or any file outside `server/domains/eco.js` (untouched — no
  backend gap required closing, only frontend reachability), `app/lenses/eco/page.tsx`, `components/eco/*`.
- Project-wide `tsc --noEmit`, `verify-lens-backends.mjs`, and
  `grade-ux-polish.mjs` are left to the orchestrator's single end-of-wave
  run, per the task's instructions.
