# sports — Feature Completeness Spec

Rival app(s): ESPN, theScore, The Athletic (2026)
Sources:
- https://www.thesportsdb.com/api.php — TheSportsDB (free, public test key)

## Features

### Sports-fan substrate
- [x] Teams, team news, tracked games, standings
- [x] Predictions + accuracy, watchlist, tracked athletes + athlete stats
- [x] Sports dashboard — live games, watchlist, prediction accuracy
- (31 macros)

### Live data & feed
- [x] Live fixtures feed — TheSportsDB recent league fixtures ingested as DTUs (macro: sports.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Live in-play scores | a paid real-time score licence | recent-fixture feed + manual game tracking |
| Broadcast video | a media-rights licence | the `voice` / `film-studios` lenses carry media |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (TheSportsDB fixtures → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` sports feed green; `tests/sports-domain-parity.test.js` + `tests/sports-fan-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="sports"` mounted in the lens page.
