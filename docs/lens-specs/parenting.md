# parenting — Feature Completeness Spec

Rival app(s): BabyCenter, What to Expect, Huckleberry (2026)
Sources:
- https://www.saferproducts.gov/ — CPSC recall API, filtered to children's products (free, no key)

## Features

### Baby-tracking substrate
- [x] Children, feeds, sleeps, diapers, pumping sessions
- [x] Growth charts, milestones, medications, activities, parenting dashboard
- (32 macros)

### Live data & feed
- [x] Live child-safety recall feed — CPSC recalls filtered to nursery / infant / toy products ingested as DTUs (macro: parenting.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Pediatric milestone authority | a licensed clinical dataset | authored milestone templates + the lens never gives medical advice |

## Verification log
- 2026-05-20: Backend — `feed` macro added (CPSC child-product recalls → DTUs, regex-filtered to child-relevant items). `node --check` clean.
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` parenting feed green (asserts non-child recalls are filtered out); `tests/parenting-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="parenting"` mounted in the lens page.
