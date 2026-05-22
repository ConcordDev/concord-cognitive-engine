# market — Feature Gap vs Crayon / Klue (competitive intelligence)

Category leader (2026): Crayon / Klue (competitive intelligence). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/market.js` — macros: trendAnalysis, competitorMatrix, priceElasticity, sector-performance, quotes-batch (Yahoo Finance), competitor CRUD, market-dashboard.

## Has (verified in code)
- Competitor tracking — segment, market share, pricing, threat level, SWOT notes (CRUD)
- Competitive-landscape dashboard — competitors, high-threat count, tracked share, segments
- Competitor matrix — multi-attribute comparison grid
- Trend analysis, price-elasticity modeling
- Live data — Yahoo Finance equity quotes batch → DTUs, sector heatmap
- Market heatmap, watchlist, competitor-tracker components

## Missing — buildable feature backlog
- [x] `[M]` Competitor news monitoring — auto-pull and tag competitor mentions from news/RSS feeds
- [x] `[M]` Battlecards — structured win/loss positioning sheets per competitor for sales
- [x] `[M]` Win/loss analysis — track deal outcomes against competitors with reasons
- [x] `[S]` Change alerts — notify when a competitor's pricing/positioning shifts
- [x] `[M]` Website-change tracking — diff competitor pages over time (crawl-based)
- [x] `[S]` Market sizing / TAM-SAM-SOM calculator
- [x] `[M]` Competitive landscape map — 2x2 quadrant positioning visualization

## Parity
~88% of Crayon/Klue's surface. Competitor records, SWOT, matrix, and trend/elasticity math are real, but missing the automated change-monitoring, battlecards, and win/loss tracking that make a CI platform a sales-enablement tool.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
