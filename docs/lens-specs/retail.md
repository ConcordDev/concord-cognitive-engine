# retail — Feature Completeness Spec

Rival app(s): Shopify, Square, Lightspeed Retail (2026)
Sources:
- https://world.openbeautyfacts.org/data — Open Beauty Facts open product database (free, no key)

## Features

### Commerce substrate
- [x] Products + SKUs, orders, carts, customers
- [x] Revenue + average-order-value + active-cart dashboard
- (49 macros)

### Live data & feed
- [x] Live product feed — Open Beauty Facts consumer products ingested as DTUs (macro: retail.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Payment capture | a payments processor licence | the `wallet` lens carries settlement |
| Shipping label printing | a carrier API | order records with manual fulfillment status |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (Open Beauty Facts → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` retail feed green; `tests/retail-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="retail"` mounted in the lens page.
