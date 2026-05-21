# marketplace — Feature Gap vs Etsy (seller side)

Category leader (2026): Etsy (handmade/creative marketplace, seller tooling). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/marketplace.js` — 32 macros: shop get/update, listings CRUD + publish/unpublish, orders create/list/ship/deliver/refund, analytics (track-view, summary, by-listing), search impressions/visibility, keyword insights, saved searches, promotions CRUD+toggle, ai-optimize-listing, ai-price-suggest, dashboard-summary, listingScore, priceOptimize, sellerMetrics, marketTrend.

## Has (verified in code)
- Shop management — shop settings, dashboard summary, seller metrics
- Listings — create/update/publish/unpublish/delete, listing-score quality grading
- Orders — create, mark shipped/delivered, refund flow
- Analytics — view tracking, per-listing analytics, search impressions + visibility, keyword insights
- Promotions — create/toggle discount promotions
- AI tooling — ai-optimize-listing, ai-price-suggest, price optimization, market-trend
- Etsy-shape UI (EtsyShell, BandcampGrid), trending listings, saved searches

## Missing — buildable feature backlog
- [ ] `[M]` Storefront / buyer browse — public shop page with category navigation and filters
- [ ] `[M]` Reviews & ratings — buyer reviews per listing and per shop
- [ ] `[M]` Messaging — buyer↔seller conversation thread per order
- [ ] `[M]` Listing variations — size/color/material options with per-variant price + stock
- [ ] `[S]` Shipping profiles — configurable rates, zones, processing times
- [ ] `[M]` Coupons / sales events beyond simple promotions (tiered, BOGO, time-boxed)
- [ ] `[S]` Inventory alerts — low-stock and out-of-stock notifications
- [ ] `[M]` Checkout / cart flow for buyers

## Parity
~55% of Etsy's seller surface. Deep seller tooling — listings, orders, analytics, promotions, AI optimization — but missing the buyer-facing storefront, reviews, messaging, and listing variations that complete a two-sided marketplace.
