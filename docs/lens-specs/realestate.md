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
- [ ] `[M]` Interactive map search — draw-area search and map pins with price labels (Zillow's core view)
- [ ] `[M]` Photo galleries + 3D/virtual tours per listing
- [ ] `[S]` Price history + Zestimate-style time-series per property
- [ ] `[M]` Mortgage pre-approval / lender connect flow
- [ ] `[S]` Saved-search alerts — notify on new matching listings
- [ ] `[S]` Property detail with tax history, lot, and similar-homes carousel
- [ ] `[S]` Contact-agent lead form with scheduling

## Parity
~65% of Zillow's feature surface. The macro depth is exceptional — AVM, school/walk/commute scores, investor analysis, and full calculators are all real. Gaps are the consumer-facing essentials: a map-based search UI, photo/virtual tours, and price history.
