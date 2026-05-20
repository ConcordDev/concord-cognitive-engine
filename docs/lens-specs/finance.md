# finance — Feature Completeness Spec

Rival app(s): Monarch Money, YNAB, Empower (2026)
Sources:
- https://www.frankfurter.app/ — Frankfurter API, ECB reference rates (free, no key)

## Features

### Personal-finance substrate
- [x] Budget envelopes, net-worth snapshots, subscriptions
- [x] Holdings + positions, monthly income, goals, finance dashboard
- (50 macros)

### Live data & feed
- [x] Live FX rate feed — ECB foreign-exchange reference rates ingested as DTUs (macro: finance.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Bank account aggregation | a Plaid-style aggregator licence | manual account + snapshot entry |
| Live equity quotes | a market-data licence | the `market` lens carries live quotes |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (Frankfurter ECB rates → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` finance feed green; `tests/finance-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="finance"` mounted in the lens page.
