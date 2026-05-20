# fashion — Feature Completeness Spec

Rival app(s): Whering, Stylebook, Acloset (2026)
Sources:
- https://metmuseum.github.io/ — The Metropolitan Museum of Art Open Access API (free, no key)

## Features

### Wardrobe substrate
- [x] Closet items, outfits, wear log, lookbooks, packing lists
- [x] Closet value, never-worn + worn-this-month dashboard
- (28 macros)

### Live data & feed
- [x] Live museum costume feed — Met Museum costume/textile pieces ingested as DTUs (macro: fashion.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Retailer shop-the-look links | retailer affiliate APIs | the `marketplace` lens carries listings |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (Met Museum → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` fashion feed green (search + object fetch); `tests/fashion-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="fashion"` mounted in the lens page.
