# space — Feature Completeness Spec

Rival app(s): Launch Library / The Space Devs, Heavens-Above (2026)
Sources:
- https://thespacedevs.com/llapi (upcoming launches — live)
- https://www.heavens-above.com/ (launch + pass tracking)

## Features

### Live data
- [x] Upcoming launches — SpaceX + worldwide via Launch Library (macro: space.spacex-upcoming / launch-library-upcoming)

### Launch watchlist (Heavens-Above shape)
- [x] Track a launch — name, provider, NET date, pad, note (macro: space.launch-track)
- [x] Watchlist with days-until countdown + status (upcoming / today / launched / TBD), upcoming-first sort (macro: space.launch-watchlist)
- [x] Mark a launch watched (macro: space.launch-mark-watched)
- [x] Untrack a launch (macro: space.launch-untrack)

### Mission calculators
- [x] Orbit calculator (macro: space.orbitCalc)
- [x] Delta-v budget (macro: space.deltaVBudget)
- [x] Launch window (macro: space.launchWindow)
- [x] Reentry analysis (macro: space.reentryAnalysis)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Real satellite pass predictions | live TLE orbital elements + an SGP4 propagator | launch watchlist with days-until countdown; orbitCalc covers orbital mechanics |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/space.js` clean. 10 macros.
- 2026-05-20: Tests — `tests/space-geology-domain-parity.test.js` (space half)
  green — track + per-user scope, duplicate/nameless reject, days-until sort,
  mark-watched, untrack.
- 2026-05-20: Frontend — new `LaunchWatchlist` (track launches, T-minus
  countdown, watched toggle) mounted in the space lens page. `tsc` exit 0.
