# marketplace — Wave 3 unsurfaced-macro audit

Frontend Rebuild Program, Wave 3. `marketplace` scored `polished` under
`grade-ux-polish.mjs --honest`, but `node scripts/lens-unsurfaced.mjs --lens marketplace`
flagged 6/56 macros with zero frontend references:

```
analytics-*  (1): analytics-track-view
checkout-*   (1): checkout-history
listings-*   (1): listings-update
orders-*     (1): orders-create
search-*     (1): search-impression
storefront-* (1): storefront-shop
```

Note: `marketplace` is actually two systems sharing one domain namespace — an
Etsy-shape seller/buyer shop (`server/domains/marketplace.js`, the subject of
this audit) and a separate DTU/creative-royalty marketplace whose macros
(`purchase`, etc.) are registered inline in `server/server.js`. Confirmed by
grep — the two never collide on macro names. This audit is scoped to the
Etsy-shape domain file only, which is where all six unsurfaced macros live.

Method: read all six macros in `server/domains/marketplace.js`, then read every
component under `concord-frontend/components/marketplace/` (`ListingsPanel`,
`OrdersPanel`, `StorefrontPanel`, `StatsPanel`, `InsightsPanel`,
`ShopfrontSection`, `ShopDashboard`, ...) and grep every `lensRun('marketplace', …)`
call site to confirm each macro was genuinely never reached.

## Findings — all six were real gaps

### `listings-update` — REAL GAP (fixed)
`server/domains/marketplace.js:210` patches title/description/currency/price/
shipping/stock/tags/images/kind on an existing listing. `ListingsPanel.tsx`
(pre-fix) had create/publish/unpublish/delete plus two AI tools
(`ai-optimize-listing`, `ai-price-suggest`) that only *suggest* changes — there
was no path to actually apply a manual correction (a price change, a stock
count, a typo) without deleting and recreating the listing (which loses its
order history, since orders reference `listingId`).

**Fix:** added an "Edit listing" inline form in the row's expanded panel
(alongside the two AI tool buttons) that calls `listings-update`.

### `orders-create` — REAL GAP (fixed)
`server/domains/marketplace.js:266` creates an order directly against one of
the seller's own listings (buyer name/email/address, qty, stock check) — a
distinct, simpler path from the buyer-side `cart-add` → `checkout-create` flow
`StorefrontPanel.tsx` already used. It's the natural shape for a seller
recording an offline/in-person/phone sale. `OrdersPanel.tsx` (pre-fix) could
only list orders and progress their fulfillment status — there was no way to
create one at all from that panel.

**Fix:** added a "Record sale" form to `OrdersPanel.tsx` (pick a published
listing + qty + optional buyer info → `orders-create`), decrementing stock and
appearing in the same order list/fulfillment flow as any cart checkout.

### `analytics-track-view` / `search-impression` — REAL GAP (fixed)
`server/domains/marketplace.js:349,442` are Etsy-Stats-parity instrumentation
macros: a listing "view" event (fed into `analytics-summary` /
`analytics-by-listing`, which `StatsPanel.tsx` already renders) and a
keyword-search "impression"/"click" event (fed into `search-visibility`, which
`StatsPanel.tsx` also already renders). The seller-facing stats surfaces were
real and rendering — but nothing on the buyer side ever called the two macros
that produce the numbers they display, so every seller's Stats/Insights tab
was structurally guaranteed to show zero views and zero impressions forever.
This is the same "real backend depth with the button that fires it missing"
pattern named in `docs/FRONTEND_REBUILD_PROGRAM.md`.

**Fix:** `StorefrontPanel.tsx`'s buyer catalog now calls `analytics-track-view`
when a listing is opened (its new detail modal, see below) and calls
`search-impression` for every result surfaced by an active keyword search
(view) and again with `click: true` when the buyer adds a searched-into
listing to cart (click) — the two real signals the seller's existing Stats
panel was already built to display.

### `storefront-shop` — REAL GAP (fixed)
`server/domains/marketplace.js:768` returns a single seller's shop page (bio,
tagline, policies, avg rating, published listings) — `StorefrontPanel.tsx`
only ever called cross-seller `storefront-browse`; a buyer had no way to view
one specific seller's shop even though every listing card already showed the
seller's shop name.

**Fix:** the shop name on each listing card (and inside the new listing detail
modal) is now a link that opens a shop-page modal via `storefront-shop`.

### `checkout-history` — REAL GAP (fixed)
`server/domains/marketplace.js:1341` returns a buyer's past checkouts.
`StorefrontPanel.tsx` had cart + checkout but no purchase-history view — once
the "Order placed" confirmation panel was dismissed, a buyer had no way to see
what they'd bought.

**Fix:** added a "My orders" button to the storefront header that opens a
history modal via `checkout-history`.

## Files touched
- `concord-frontend/components/marketplace/ListingsPanel.tsx` — edit form.
- `concord-frontend/components/marketplace/OrdersPanel.tsx` — record-sale form.
- `concord-frontend/components/marketplace/StorefrontPanel.tsx` — listing
  detail modal (view tracking), shop modal, search impression instrumentation,
  order-history modal.

No generic button walls: every new control is a designed field on the panel
that already owns the underlying record, wired to the exact macro it exercises.
