# retail — Feature Gap vs Shopify

Category leader (2026): Shopify (commerce platform + POS). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/retail.js` — ~49 macros: products + variants + inventory + pricing, carts (open/add/total/tender), orders, customers + segments + RFM, discounts, abandoned-cart recovery, shipping zones + rate quotes, tax rates, gift cards, refunds, collections, inventory transfers, revenue/top-product analytics, Stripe payment intents, product feed.

## Has (verified in code)
- Product catalog with variants, inventory, pricing sub-tabs; low-stock + reorder checks
- Carts with line items, totals, tender; orders list + timeline + returns
- Real Stripe payment-intent creation + confirm-paid; refunds
- Customers directory, segments, RFM analysis; abandoned-cart list + recovery
- Discounts (create/apply), gift cards (create/balance/redeem), collections
- Shipping zones + rate quoting, tax rates; inventory transfers between locations
- Analytics: revenue-by-day, top products, summary; customer LTV, pipeline value, SLA status; 6 tabs

## Missing — buildable feature backlog
- [ ] `[M]` Storefront / buyer-facing shop — a public product browse + checkout page
- [ ] `[M]` Shipping label purchase + tracking — carrier API integration beyond rate quotes
- [ ] `[S]` Order fulfillment workflow — pick/pack/ship status with notifications
- [ ] `[M]` Marketing campaigns — email/discount campaigns and conversion tracking
- [ ] `[S]` Multi-channel listing — sync inventory to external marketplaces
- [ ] `[S]` Product reviews + ratings on the storefront
- [ ] `[S]` Staff accounts + permissions for the admin

## Parity
~75% of Shopify's admin feature surface. The commerce backend is genuinely deep — variants, real Stripe payments, RFM, discounts, gift cards, shipping/tax, transfers, analytics. The main gap is a buyer-facing storefront and carrier label/tracking integration.
