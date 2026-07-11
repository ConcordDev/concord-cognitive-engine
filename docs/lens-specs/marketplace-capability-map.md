# Marketplace Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.
> This unit picks up after an earlier attempt died mid-audit (worktree
> cleanup, not a code problem) — its leads were re-verified from scratch, not
> assumed.

## Two systems share one lens

`marketplace` is genuinely two independent backend systems, both surfaced on
`/lenses/marketplace`:

1. **The Etsy-shape seller/buyer shop** — `server/domains/marketplace.js`
   (`grep -c 'registerLensAction("marketplace"' server/domains/marketplace.js`
   → **56** macros: shop settings, listings CRUD, orders, coupons,
   promotions, reviews, messages, shipping profiles, saved searches,
   analytics, AI listing tools, cart/checkout). Mounted via
   `<ShopfrontSection />` at the very top of `page.tsx` (always visible,
   above the tab bar) → `ShopDashboard` / `ListingsPanel` / `OrdersPanel` /
   `CouponsPanel` / `ShippingProfilesPanel` / `ReviewsPanel` /
   `MessagesPanel` / `VariationsPanel` / `ShopSettingsPanel` /
   `MarketingPanel` / `StatsPanel` / `InsightsPanel` /
   `InventoryAlertsPanel` (13 bespoke components, ~3,900 LOC combined).
   **This system was already fully audited and closed in a prior Wave-3
   pass** — see `docs/lens-specs/marketplace-wave3-audit.md`, which found
   and fixed the 6 macros (`listings-update`, `orders-create`,
   `analytics-track-view`, `search-impression`, `storefront-shop`,
   `checkout-history`) that had zero frontend callers. This unit re-verified
   that finding still holds (all 13 panel components call real
   `lensRun('marketplace', …)` macros, not a generic action array) and did
   not need to touch it further.

2. **The DTU/creative-royalty marketplace** — macros registered inline in
   `server/server.js` (`grep -c "register(\"marketplace\"" server/server.js`
   → **11**: `submit` (plugin listings), `browse`, `install`, `review`,
   `heartbeatSync`, `installed`, `list`, `purchase`, `dtu_browse`,
   `purchaseWithRoyalties`, `royalties`) **plus** a large parallel content
   pool this lens actually leans on harder: the **artistry marketplace**
   (`/api/artistry/marketplace/{beats,stems,samples,art,purchase}`,
   real beat/stem/sample-pack/artwork listings + a real purchase state
   machine, borrowed from the music/artistry lens per
   `lib/api/endpoint-inventory.ts`'s `usedBy: ['music']` tags). This is the
   system `page.tsx`'s own top-level tabs (Browse/Cart/Purchases/Analytics/
   Watchlist) drive directly with local component code, not a panel
   component — and where this unit found real, previously-unconfirmed
   defects.

Confirmed by reading `server/domains/marketplace.js` and the two `server.js`
`register("marketplace", …)` call sites side by side: no macro-name
collisions between the two systems.

## Defects found and fixed (system 2 — DTU/creative marketplace)

### 1. Checkout sent a literal string `'current'` as `buyerId` — every priced purchase failed

`handleCheckout` (`page.tsx`) called
`apiHelpers.artistry.marketplace.purchase({ buyerId: 'current', … })`. The
backend route (`server/server.js`, `POST /api/artistry/marketplace/purchase`)
takes `buyerId` straight from `req.body` with **no** server-side resolution
of a `'current'` sentinel to the authenticated user (checked: no such
resolution exists anywhere in `server/server.js`, and this route has no
`requireAuth()` at all — it trusts the body). Every settlement then called
`validateBalance(db, 'current', price)` against a wallet that doesn't exist,
so every checkout with `price > 0` failed balance validation. `useAuth()`
was already imported and `user` already destructured in the same component
(`const { user } = useAuth()`, used elsewhere for `RoyaltyDashboard`) — the
fix was to actually use it.

**Fix:** `buyerId: user.id`, with an honest early-exit
(`setCheckoutError('You must be signed in…')`) if `user?.id` is falsy,
instead of silently sending garbage.

### 2. Checkout also sent the wrong `listingType` for 3 of 4 real content categories

Independent of defect #1: the `typeMap` in `handleCheckout` mapped the
frontend's display type onto itself (`template→'template'`,
`component→'component'`, `dataset→'dataset'`, `artwork→'artwork'`) — but the
backend's listing lookup (`server.js`, purchase route) keys its stores by
`{ beat, stems, 'sample-pack', artwork }`. Beats (labelled `'template'` in
the UI via `normalizeItems`), stems (`'component'`) and samples
(`'dataset'`) all resolved to `stores['template']` / `stores['component']` /
`stores['dataset']` — **undefined** — so the purchase 404'd with "Listing
not found" for every beat/stem/sample, regardless of defect #1. Only
`'artwork'` happened to line up by coincidence, because the frontend label
and the backend store key are spelled the same.

**Fix:** corrected the map to the real store keys
(`template→'beat'`, `component→'stems'`, `dataset→'sample-pack'`,
`artwork→'artwork'`). Items with no real backend store (`'plugin'`,
`'preset'` — sourced only from the separate plugin-listings pool, which has
no purchase path through this route) now fail with a specific, honest
per-item error (`"this listing type isn't purchasable yet"`) instead of a
generic 404 masquerading as a listing-not-found bug. This residual gap is
triaged below.

### 3. "New Listing" posted a shape the backend endpoint didn't accept — always 404'd

`handlePublishListing` built a `{title, type, description, genre, tags,
licenses:{basic,premium,unlimited,exclusive}}` payload and POSTed it to
`/api/marketplace/submit` via `apiHelpers.marketplace.submit` (typed as
`PluginSubmitRequest`, i.e. the *plugin*-marketplace submit endpoint). The
live Express handler for that exact path
(`app.post("/api/marketplace/submit", requireAuth(), …)`, `server.js`)
expects `{dtuId, price}` — it looks up an **existing** personal DTU by id and
404s "DTU not found" if missing. (There's also a `register("marketplace",
"submit", …)` *macro* at a different call site expecting yet another shape,
`{name, githubUrl, …}` for plugin listings — but macros aren't reachable via
a raw `api.post()`, so that registration is irrelevant to this bug; the
Express route is what actually receives the request.) The form never
supplied `dtuId` or a top-level `price` — every submission failed.

**Fix:** routed through `marketplace.listings-create` (a real, already-used
macro — `ListingsPanel`'s own "Add Listing" flow calls it) instead, whose
shape (`title`/`description`/`priceUsd`/`tags`) matches this form. Follows
with `listings-publish` so the listing goes live immediately (matching the
button's "Publish" intent), then switches to the My Shop tab so the user
sees the concrete result rather than a listing that silently lands in a
store the Browse tab never reads. **Known trade-off, documented not hidden:**
the e-commerce listing model has one `priceUsd`, not this form's 4-tier
license schema — only the basic-tier price carries over. Fully unifying the
4-tier license form with the single-price listing model, or building a
public cross-seller browse macro for `s.listings` so newly-published items
also appear in the Browse tab, is a larger change triaged below (DATA
already exists locally per-user; what's missing is a public/global read
macro — ENGINEERING).

### 4. Purchases didn't survive a page reload

`purchases` was a plain `useState<Purchase[]>([])`, populated only inside
`handleCheckout`'s success branch — reloading the page always started from
an empty array, even though the purchase was real and settled server-side
(the checkout already calls a real, ledger-settling endpoint;
`server/economy/purchases.js`'s purchase state machine already persists
every purchase to the `purchases` SQLite table with a `buyer_id` column and
already exports a ready-to-use `getUserPurchases(db, userId, {role, status,
limit, offset})` — it just had no HTTP route and no frontend caller).

**Fix (ENGINEERING — real gap, no external dependency, closed same pass):**
added `GET /api/artistry/marketplace/purchases` (`requireAuth()`-gated,
`server.js`), which calls the existing `getUserPurchases` and enriches each
row with the listing snapshot (title/genre/owner) the same way the purchase
POST handler already does. Wired a `myPurchasesData` query in `page.tsx`
(`apiHelpers.artistry.marketplace.purchases()`, new client helper in
`lib/api/client.ts`) that fetches on mount — this is what makes history
survive reload. The pre-existing optimistic `setOptimisticPurchases` push on
checkout success is kept (renamed from `setPurchases`) for sub-100ms
perceived feedback per the fluidity invariant; a `useMemo` unions it with
the fetched rows (deduped by item id) so the UI shows the new purchase
instantly and reconciles with the real row once the query (already
invalidated on checkout success) refetches — optimistic-then-reconciled, not
optimistic-forever.

## Verification

- `node --check server/server.js` — OK.
- `npx eslint concord-frontend/app/lenses/marketplace/page.tsx
  concord-frontend/lib/api/client.ts` — 0 errors, 0 warnings.
- Real backend test suites (`node --test` from `server/`):
  `tests/marketplace.test.js`, `tests/marketplace-domain-parity.test.js`,
  `tests/marketplace-service.test.js`, `tests/artistry-domain-parity.test.js`
  → **131/131 passing, 0 failing** (unaffected — this pass added a new route
  and fixed frontend payload shapes; it did not change any macro contract).
  `tests/purchases.test.js` (the purchase state machine this pass's new
  route depends on) → **48/48 passing**.
- Real-DB (in-memory `better-sqlite3`, actual migration `005_purchases_table.js`,
  actual `createPurchase`/`transitionPurchase`/`getUserPurchases` from
  `server/economy/purchases.js`) ad-hoc script reproducing the new route's
  exact transform: creates a purchase, transitions it through
  CREATED→PAID→SETTLED→FULFILLED, calls `getUserPurchases(db, buyerId,
  {role:'buyer'})`, applies the same store-enrichment the route applies —
  confirms the emitted shape (`id/status/listingId/listingType/licenseType/
  price/purchasedAt/listing.title`) matches what the frontend's
  `normalizeServerPurchase()` expects, and confirms purchase isolation (the
  seller's own buyer-role history is empty). Not a committed test file — a
  disposable verification script, deleted after the run.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}
  total 260` — unchanged (marketplace was already WIRED; this pass fixed
  correctness of an already-reached call, not reachability).
- `node scripts/grade-ux-polish.mjs --honest` → marketplace entry:
  `"tier":"polished"`, `"isGenericScaffold":false`,
  `"importsGenericTrio":false`, `"pillarsPresent":5` — unaffected by this
  pass's changes (no scaffold/design changes were made).
- A full out-of-process HTTP boot (`CONCORD_FORCE_LISTEN=true` subprocess,
  the pattern `tests/edge-cases-critical-paths.test.js` uses) was attempted
  for an end-to-end register→purchase→history round trip but the server
  subprocess did not become ready within several minutes on this box under
  concurrent sibling-agent load; it was killed rather than let it contend
  for shared resources further (CLAUDE.md's "one heavy Node process at a
  time" guidance). The in-process real-DB script above and the existing
  131+48 passing tests are the verification of record for this pass.

## Genuinely missing / deferred (triaged, not silently dropped)

- **Public cross-seller browse for `s.listings`** (the e-commerce domain's
  per-user listing store) — **ENGINEERING**. No macro currently lets Browse
  discover listings created via `listings-create` across all sellers; today
  they're only visible in the creating seller's own My Shop tab. A
  `listings-browse-all` macro (paginate across all users' published
  listings) would let "New Listing" (fixed this pass to publish into this
  store) actually surface in Browse too. Not attempted this pass — the fix
  above already makes the button truthful (it publishes a real, visible
  listing under My Shop) without inventing a new cross-user index; unifying
  Browse with this store is additive future work, not a regression.
- **Plugin-type Browse items have no real purchase path** — **ENGINEERING**
  (a genuine product-shape question, not a data-sourcing one: does buying a
  "plugin" listing mean something different from an artistry purchase, e.g.
  free install rather than paid license?). Left as an honest per-item
  checkout error rather than papered over.
- **Buyer "Download" button in the Purchases tab calls a route that doesn't
  exist** (`GET /api/marketplace/install` — no such Express route; it 404s,
  which the existing code already surfaces as an honest "Failed to install"
  toast, not a fabricated success). **ENGINEERING** — a real fulfillment/
  asset-access endpoint for a purchased artistry license doesn't exist yet
  (the underlying blob/asset serving exists at `/api/artistry/blobs/:id` and
  `/api/artistry/assets/:id`, but nothing connects a `license_id` to
  "here's your file"). Out of scope for this pass's fix list (checkout +
  publish + persistence); left as a known, honestly-failing gap rather than
  a fabricated one.
- **Seller tooling (coupons/promotions/shipping-profiles/saved-searches)** —
  already real and wired via `ShopfrontSection`'s panel components (see the
  Wave-3 audit doc referenced above). Not re-scoped this pass.
