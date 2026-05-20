# market — Feature Completeness Spec

Rival app(s): Crayon, Klue, SimilarWeb, Yahoo Finance (2026)
Sources:
- Yahoo Finance quote API (equity quotes — live)
- competitive-intelligence / market-research record-keeping

## Features

### Market-research management
- [x] Track competitors — segment, market share, pricing, threat level (macro: market.competitor-add)
- [x] List competitors sorted by share, filter by segment (macro: market.competitor-list)
- [x] Update competitor share / threat / SWOT notes (macro: market.competitor-update)
- [x] Delete a competitor (macro: market.competitor-delete)
- [x] Competitive-landscape dashboard — competitors, high-threat, tracked share, segments (macro: market.market-dashboard)

### Live data
- [x] Equity quotes — Yahoo Finance quotes ingested as DTUs (macro: market.quotes)
- [x] Sector heatmap (SectorHeatmapPanel)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Automated competitor web-scrape | a crawl/scrape engine | manual competitor records + SWOT; the `news` lens carries headline ingestion |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/market.js` clean.
  Competitor substrate (5 macros) appended to the Yahoo-Finance domain.
- 2026-05-20: Tests — `tests/market-competitor-domain-parity.test.js` 5/5
  green (competitor CRUD + per-user scope + threat fallback / share-sorted
  listing + segment filter / dashboard threat + tracked-share aggregation).
- 2026-05-20: Frontend — new `CompetitorTracker` (competitor list with SWOT
  editor + threat colouring + dashboard) mounted in the market lens page.
  `npx tsc --noEmit` exit 0.
