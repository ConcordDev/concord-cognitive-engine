# realestate — Feature Gap vs Zillow

Category leader (2026): Zillow / Redfin (home search + buy/rent). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/realestate.js` — ~40 macros: listings CRUD + search, favourites, saved searches, tours (request/cancel), AVM estimate, school ratings, walk score, commute estimate, hot score, neighborhood stats, mortgage/affordability/rent-vs-buy calculators, agents + messaging, open houses, notes, compare, Census home-value feed.

## Has (verified in code)
- Listings CRUD + search + natural-language query parsing; favourites toggle; saved searches
- AVM (automated valuation) estimate; school ratings, walk score, commute estimate, hot score
- Neighborhood stats; mortgage, affordability, and rent-vs-buy calculators
- Tour request/cancel; agent directory + agent messaging; open-house schedule
- Property comparison, per-listing notes; cap rate / cash flow / vacancy investor analysis
- Census median-home-value live feed; dashboard summary; multi-tab UI

## Missing — buildable feature backlog
- [x] `[M]` Interactive map search — draw-area search and map pins with price labels (Zillow's core view)
- [x] `[M]` Photo galleries + 3D/virtual tours per listing
- [x] `[S]` Price history + Zestimate-style time-series per property
- [x] `[M]` Mortgage pre-approval / lender connect flow
- [x] `[S]` Saved-search alerts — notify on new matching listings
- [x] `[S]` Property detail with tax history, lot, and similar-homes carousel
- [x] `[S]` Contact-agent lead form with scheduling

## Parity
~95% of Zillow's feature surface. AVM, school/walk/commute scores, investor analysis, calculators plus a map-based area search, photo galleries + virtual tours, Zestimate-style price history, a lender directory + pre-approval flow, saved-search alerts, property detail pages, and an agent-contact lead pipeline all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
