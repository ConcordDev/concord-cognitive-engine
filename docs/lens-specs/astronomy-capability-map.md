# astronomy — capability map (Frontend Rebuild Program, Wave 2 batch 4)

Reference apps: **Stellarium** / **SkySafari** (interactive sky charting, observing
logs, equipment/session tracking) and **NASA APOD**-style apps (daily imagery +
near-earth-object tracking). This supersedes `docs/lens-specs/astronomy.md`
(2026-06-era backend-parity doc) as the rebuild-program capability-map
artifact — the old doc conflated "real backend macro exists" with "surfaced in
the UI"; this map keeps those two facts separate.

## Backend macro surface (verified via grep, 2026-07-09)

`server/domains/astronomy.js` (registerLensAction, 39 macros) +
`server/domains/astronomy-live.js` (3 `live_*` macros) + shared registrations
in `server/domains/curated-free-apis.js` (`live_spaceflight_news`,
`live_launches_upcoming`) and `server/domains/civic-data-apis.js`
(`live_iss_pass`):

celestialPosition, planObservation, lightTravelTime, orbitalMechanics, apod,
iss-current-location, near-earth-objects, target-{add,list,update,delete,detail},
observation-{log,list,delete}, session-{create,list,detail},
equipment-{add,list,delete}, wishlist-{add,list,remove}, event-{add,list,delete},
catalog-{list,import}, astro-dashboard, feed, sky-chart, whats-up,
constellations, ephemeris-calendar, observing-forecast,
goto-mount-{set,get}, goto-{command,queue,command-update,clear}, ar-resolve,
live_apod, live_iss, live_neo, live_spaceflight_news, live_launches_upcoming,
live_iss_pass. `server/domains/more-free-apis.js` was checked and has no
astronomy-relevant registrations.

## Pre-existing frontend depth (found BEFORE this rebuild)

The lens is far from a thin scaffold — `concord-frontend/components/astronomy/`
already had 10 files / ~2,800 LOC of real, macro-wired UI:

- `SkyChartWorkbench.tsx` (989 LOC) — 7-panel workbench: real-time azimuthal sky
  dome (`sky-chart`), what's-up-now visibility list (`whats-up`), constellation
  lines + deep-sky overlay (`constellations`), DeviceOrientation AR "point phone
  at sky" (`ar-resolve`), INDI/ASCOM GoTo bridge (`goto-*`), moon-phase/rise-set
  ephemeris calendar (`ephemeris-calendar`), Open-Meteo observing-conditions
  forecast (`observing-forecast`).
- `AstronomySkySection.tsx` (94 LOC) — dashboard KPI strip (`astro-dashboard`) +
  a 4-tab sub-workbench that already mounts `AstroTargetsPanel.tsx` (targets +
  Messier catalog import + per-target observation logging via
  `target-*`/`catalog-*`/`observation-log`), `AstroSessionsPanel.tsx` (observing
  sessions with Bortle/seeing/transparency via `session-*`),
  `AstroGearPanel.tsx` (equipment registry via `equipment-*`), and
  `AstroPlanPanel.tsx` (wishlist + astronomical events via `wishlist-*`/`event-*`).
  **Correction to an earlier same-session grep**: these four panels are NOT
  orphaned — they're mounted inside `AstronomySkySection`, which the page
  already renders. Verify: `grep -n AstroTargetsPanel components/astronomy/AstronomySkySection.tsx`.
- `NasaExplorer.tsx` (459 LOC) + `NasaLivePanel.tsx` (272 LOC) — real
  APOD/ISS/NEO explorer with DateScrubber + save-as-DTU.
- `IssPassPanel.tsx` (140 LOC) — real ISS pass predictions (`live_iss_pass`).
- `AstronomyActionPanel.tsx` (242 LOC) — AI-agent panel: mint a "sky log" DTU
  from today's real APOD/ISS/NEO/position data, publish a public sky card,
  and run a `chat_agent.do` task. Real macro calls, not a button wall.
- `components/space/SpaceflightNewsPanel.tsx` / `UpcomingLaunchesPanel.tsx` —
  shared with the `space` domain, real Spaceflight-News + Launch-Library data.

## What was actually wrong (genuinely broken/generic/fake)

1. **`app/lenses/astronomy/page.tsx` shipped a second, weaker, REDUNDANT
   catalog+observation-log implementation** on top of the real one above: an
   inline "Add Object" form + `CelestialCard` list backed by the generic
   `useLensData('astronomy', 'object' | 'observation', …)` artifact CRUD —
   completely bypassing the real `target-*`/`observation-log`/`session-*`
   macros that `AstronomySkySection` already exercises one scroll down the
   same page. Two different, disconnected "catalog" UIs on one page.
2. **Fabricated visibility data.** `isVisibleTonight(name)` hashed the object's
   *name string* to a deterministic true/false and rendered it as an "Tonight" /
   "Not visible" badge — a fake astronomical computation dressed as real data,
   on the exact same page where the real `celestialPosition` macro computes
   genuine altitude/azimuth/visibility via a Meeus equatorial→horizontal
   transform. This is precisely the "zero demo content" violation CLAUDE.md
   calls out. **Removed.**
3. **Generic scaffold signature.** The page imported the `ManifestActionBar` +
   `AutoActionStrip` + `RecentMineCard` trio and rendered `<UniversalActions>` +
   `<LensFeaturePanel>` — the auto-discovered-macro button wall / generic
   capabilities list. `node scripts/grade-ux-polish.mjs --honest` confirmed
   this cap: `tier: "functional"` with `isGenericScaffold: true` (pre-change),
   even though 86% of the lens's LOC was genuinely bespoke — the grader is
   right that the page ITSELF (not the components dir) was still leaning on
   the generated body.
4. **Three real, deterministic backend calculators were completely
   unsurfaced**: `planObservation` (moon-phase-aware target difficulty/priority
   planner), `lightTravelTime` (distance → light-travel-time / lookback-time,
   ly/pc/AU input), `orbitalMechanics` (Kepler's-third-law period/perihelion/
   aphelion/velocity from semi-major-axis + eccentricity + central mass) — zero
   frontend references to any of the three prior to this rebuild.

## Reference-parity checklist (Stellarium / SkySafari / NASA-APOD shape)

| Capability | Disposition | Where |
|---|---|---|
| Real-time sky chart from observer lat/long/time | ALREADY REAL | `SkyChartWorkbench` (`sky-chart`) |
| Tonight's-best / what's-up-now list | ALREADY REAL | `SkyChartWorkbench` (`whats-up`) |
| Constellation lines + deep-sky overlay | ALREADY REAL | `SkyChartWorkbench` (`constellations`) |
| AR "point phone at sky" | ALREADY REAL | `SkyChartWorkbench` (`ar-resolve`) |
| Telescope GoTo (INDI/ASCOM) | ALREADY REAL | `SkyChartWorkbench` (`goto-*`) |
| Moon-phase + rise/set ephemeris calendar | ALREADY REAL | `SkyChartWorkbench` (`ephemeris-calendar`) |
| Observing-conditions forecast | ALREADY REAL | `SkyChartWorkbench` (`observing-forecast`) |
| Observing targets + Messier catalog import | ALREADY REAL | `AstroTargetsPanel` (`target-*`, `catalog-*`) |
| Per-target observation log (rating/conditions/notes) | ALREADY REAL | `AstroTargetsPanel`, `AstroSessionsPanel` |
| Observing sessions (Bortle/seeing/transparency) | ALREADY REAL | `AstroSessionsPanel` (`session-*`) |
| Equipment registry (scope/eyepiece/camera specs) | ALREADY REAL | `AstroGearPanel` (`equipment-*`) |
| Observing wishlist + astronomical events | ALREADY REAL | `AstroPlanPanel` (`wishlist-*`, `event-*`) |
| NASA APOD daily imagery | ALREADY REAL | `NasaLivePanel`, `NasaExplorer`, `AstronomyActionPanel` (`apod`, `live_apod`) |
| Live ISS position + pass predictions | ALREADY REAL | `NasaLivePanel`, `IssPassPanel` (`iss-current-location`, `live_iss_pass`) |
| Near-earth-object tracking | ALREADY REAL | `NasaLivePanel`, `NasaExplorer` (`near-earth-objects`, `live_neo`) |
| Spaceflight news + upcoming launches | ALREADY REAL | `SpaceflightNewsPanel`, `UpcomingLaunchesPanel` (shared w/ `space`) |
| AI "mint a sky log DTU from tonight's data" | ALREADY REAL | `AstronomyActionPanel` |
| Light-travel-time / lookback calculator | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `AstroCalculators.tsx` (`lightTravelTime`) |
| Orbital-mechanics (Kepler) calculator | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `AstroCalculators.tsx` (`orbitalMechanics`) |
| Observation-session planner (moon phase + target difficulty) | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `AstroCalculators.tsx` (`planObservation`) |
| Live weather-webcam / seeing-cam integration | GENUINELY MISSING | Deferred — no free API identified with acceptable ToS; not scoped for this batch |
| Multi-observer shared session (co-observing) | ~~GENUINELY MISSING~~ **CLOSED (2026-07-17, `9e784048`)** | The "new realtime substrate" premise was stale. Reuses collab's own session roster (`STATE.collabLens.sessionRosters` via `sessionJoin`/`sessionLeave`) + `realtimeEmit` over a new `astronomy:session:<id>` room, gated in server.js by real membership (non-members blocked; never a fabricated "N watching"). Shared current-target + observation-log broadcast to members; each observer's alt/az stays computed from THEIR OWN lat/long via the real Meeus transform — pinned by a test asserting NYC vs Sydney get different alt/az for the same target. 46 tests. |

Overall: this lens was already close to Stellarium/SkySafari feature parity in
its **components/** directory; the defect was entirely in `page.tsx` — a
redundant/fake duplicate surface plus the generic scaffold wrapper plus three
unsurfaced calculators. Fixed all four in this batch.

## Verify-gate results (2026-07-09)

- `npx eslint app/lenses/astronomy/page.tsx components/astronomy/AstroCalculators.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide (see commit for full log).
- No astronomy-specific vitest files exist (`grep -rl astronomy concord-frontend/tests concord-frontend/**/*.test.tsx` → no matches) — noted honestly, not silently skipped.
- `node scripts/verify-lens-backends.mjs` — `astronomy` still WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `astronomy` now `tier: "polished"`, `isGenericScaffold: false`.
