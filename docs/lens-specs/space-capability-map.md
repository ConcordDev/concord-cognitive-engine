# space — capability map (Frontend Rebuild Program, Wave 2 batch 4)

Reference apps: a spaceflight-tracking app in the **N2YO / Flightradar24-for-space
/ Go4Liftoff** shape (live satellite & ISS tracking, launch schedules with
countdowns, orbit visualization) plus lightweight **mission-planning
calculators** (the KSP/Delta-V-map shape: orbit period, delta-v budget, launch
window, reentry corridor). This supersedes `docs/lens-specs/space.md` as the
rebuild-program capability-map artifact — the old doc listed the four
calculator macros under "Has" without distinguishing "backend macro exists"
from "reachable in the UI"; this map keeps those separate.

## Backend macro surface (verified via grep, 2026-07-09)

`server/domains/space.js` (registerLensAction, 19 macros) + shared
registrations in `server/domains/curated-free-apis.js`
(`live_spaceflight_news`, `live_launches_upcoming`) and
`server/domains/civic-data-apis.js` (`live_iss_pass`):

orbitCalc, deltaVBudget, launchWindow, reentryAnalysis, spacex-upcoming,
launch-library-upcoming, launch-{track,watchlist,mark-watched,untrack}, feed,
iss-{track,groundtrack,passes}, orbit-3d, launch-countdown, rocket-detail,
sky-map, launches-filtered, apod, live_spaceflight_news,
live_launches_upcoming, live_iss_pass. `server/domains/more-free-apis.js` was
checked and has no space-relevant registrations.

## Pre-existing frontend depth (found BEFORE this rebuild)

`concord-frontend/components/space/` already had 13 files / ~2,100 LOC of
real, macro-wired UI, all correctly mounted:

- `SpaceObservatory.tsx` (88 LOC) — an 8-tab "Live Observatory" deck that
  mounts `IssLiveTracker` (`iss-track`), `VisiblePassPredictor` (`iss-passes`),
  `Orbit3DGlobe` (`orbit-3d`), `LaunchCountdown` (`launch-countdown`,
  webcast embed + browser Notification reminder), `RocketDetail`
  (`rocket-detail`), `SkyMap` (`sky-map`), `LaunchExplorer`
  (`launches-filtered`), `ApodFeed` (`apod`). Verified none of these 8
  sub-components are orphaned: every one is imported and tab-routed inside
  `SpaceObservatory`, which `page.tsx` already renders.
- `SpaceflightNewsPanel.tsx` / `UpcomingLaunchesPanel.tsx` — shared with
  `astronomy`, real Spaceflight-News-API + Launch-Library-2 data.
- `UpcomingLaunches.tsx` + `LaunchWatchlist.tsx` — personal launch
  track/untrack/mark-watched watchlist (`launch-track`, `launch-watchlist`,
  `launch-mark-watched`, `launch-untrack`), sorted by days-until.
- The page's own "Mission Control" tab set (Dashboard / Missions / Satellites
  / LaunchOps / Telemetry / Crew / Debris) is a genuine, hand-designed,
  bespoke personal tracking journal (mission timeline, orbital-zone LEO/MEO/GEO
  distribution bar chart, live launch countdown banner, telemetry signal-health
  bar with per-item signal bars) backed by the generic per-user artifact store
  (`useLensData`) — this is legitimate user-authored journaling data (like a
  personal mission log), not fabricated data presented as a live feed, and
  it isn't a duplicate of anything above (the watchlist tracks *real* launches
  from Launch Library 2; this tracks the user's *own* missions/satellites).
  Left as-is.

## What was actually wrong (genuinely broken/generic/fake)

1. **Generic scaffold signature.** `page.tsx` imported the `ManifestActionBar` +
   `AutoActionStrip` + `RecentMineCard` trio and rendered `<UniversalActions>` +
   `<LensFeaturePanel>`. `node scripts/grade-ux-polish.mjs --honest` confirmed
   the cap: `tier: "functional"`, `isGenericScaffold: true` (pre-change), even
   with 75.6% bespoke LOC — same defect class as astronomy: the page itself,
   not the components dir, still carried the generated wrapper.
2. **Four real, deterministic mission-planning calculators were completely
   unsurfaced**: `orbitCalc` (altitude → orbital period/velocity/LEO-MEO-GEO
   classification/escape velocity), `deltaVBudget` (maneuver list → total
   delta-v + feasibility band), `launchWindow` (target orbit + launch latitude
   → windows-per-day + dogleg-maneuver penalty), `reentryAnalysis` (mass +
   velocity + angle → peak-G, peak-temp, heat-shield type, corridor
   survivability). Zero frontend references to any of the four prior to this
   rebuild — this is exactly the KSP/Delta-V-map-shaped tool a spaceflight app
   in this category is expected to have, and the backend already computes it
   correctly; nothing was reaching it.

## Reference-parity checklist (N2YO / Flightradar24-for-space / Go4Liftoff shape)

| Capability | Disposition | Where |
|---|---|---|
| Live ISS tracking (world map) | ALREADY REAL | `IssLiveTracker` (`iss-track`, `iss-groundtrack`) |
| Visible-pass predictions for observer location | ALREADY REAL | `VisiblePassPredictor` (`iss-passes`) |
| 3D orbit visualization | ALREADY REAL | `Orbit3DGlobe` (`orbit-3d`) |
| Launch countdowns + webcast + reminders | ALREADY REAL | `LaunchCountdown` (`launch-countdown`) |
| Rocket/vehicle detail pages | ALREADY REAL | `RocketDetail` (`rocket-detail`) |
| Sky map / planetarium view | ALREADY REAL | `SkyMap` (`sky-map`) |
| Launch filtering by provider/orbit/location | ALREADY REAL | `LaunchExplorer` (`launches-filtered`) |
| NASA APOD imagery | ALREADY REAL | `ApodFeed` (`apod`) |
| Personal launch watchlist | ALREADY REAL | `LaunchWatchlist`, `UpcomingLaunches` |
| Spaceflight news + upcoming launches feed | ALREADY REAL | `SpaceflightNewsPanel`, `UpcomingLaunchesPanel` |
| Orbital-period/velocity/escape-velocity calculator | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `MissionPlanningPanel.tsx` (`orbitCalc`) |
| Delta-V budget analyzer | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `MissionPlanningPanel.tsx` (`deltaVBudget`) |
| Launch-window estimator | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `MissionPlanningPanel.tsx` (`launchWindow`) |
| Reentry-corridor analysis | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `MissionPlanningPanel.tsx` (`reentryAnalysis`) |
| Live satellite catalog beyond ISS (Starlink, debris) | GENUINELY MISSING | Deferred — Space-Track/N2YO's full-catalog TLE feed needs an authenticated account; not a free/keyless API. Noted honestly rather than faked. |
| Ground-station pass scheduling for own satellites | ~~GENUINELY MISSING~~ **CLOSED (2026-07-16, `3dcfa1a0`)** | `orbitalPeriodMinutes(altitudeKm)` extracted from `orbitCalc`'s original inline formula into a shared helper reused by `orbitCalc`/`satellite-list`/`satellite-passes` (a test proves both call sites return identical period figures at the same altitude, so they can never independently drift). New `satellite-track`/`satellite-list`/`satellite-untrack`/`satellite-passes` macros. A user's own satellite is fictional/hypothetical with no live ephemeris source — unlike `iss-passes`, which samples real `wheretheiss.at` telemetry — so `satellite-passes` never pretends to call a tracking API for it: it's an explicitly-labeled `precision:"estimated"` analytical estimate, with an inclination-band gate returning an honest zero passes (never fabricated visibility) for a ground station outside the satellite's reachable-latitude band. `OwnedSatellites.tsx` mounts as a new "My Satellites" tab, visually distinct from the live ISS panels (amber dashed framing, persistent "ESTIMATED — not live" badge, `est.` chip on every pass row, backend honesty note surfaced verbatim). 27 new backend tests (`server/tests/depth/space-satellite-behavior.test.js`), 13 new frontend tests. |

Overall: like astronomy, this lens was already close to feature parity in its
**components/** directory; the defect was the generic scaffold wrapper on the
page plus four unsurfaced mission-planning calculators. Fixed both in this batch.

## Verify-gate results (2026-07-09)

- `npx eslint app/lenses/space/page.tsx components/space/MissionPlanningPanel.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide (see commit for full log).
- No space-specific vitest files exist (`grep -rl space concord-frontend/tests concord-frontend/**/*.test.tsx` → no matches beyond unrelated "space" substring noise) — noted honestly, not silently skipped.
- `node scripts/verify-lens-backends.mjs` — `space` still WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `space` now `tier: "polished"`, `isGenericScaffold: false`.
