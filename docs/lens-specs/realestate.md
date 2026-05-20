# realestate — Feature Completeness Spec

Rival app(s): Zillow, Redfin, Realtor.com (2026)
Sources:
- https://www.census.gov/data/developers/data-sets/acs-1year.html — US Census ACS (free, no key for low volume)

## Features

### Property substrate
- [x] Listings, favourites, tours, saved searches, agent messaging
- [x] Mortgage + affordability calculators, comp analysis, real-estate dashboard
- (39 macros)

### Live data & feed
- [x] Live home-value feed — Census ACS median home value by state ingested as DTUs (macro: realestate.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Live MLS listing data | a licensed MLS / IDX feed | the Census home-value feed gives the macro market; listings are user-authored |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (Census ACS home values → DTUs). No free MLS listing feed exists — listings remain user-authored (see Boundary register).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` realestate feed green; `tests/realestate-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="realestate"` mounted in the lens page.
