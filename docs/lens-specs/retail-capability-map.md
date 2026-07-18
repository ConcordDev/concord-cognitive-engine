# Retail Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("retail"' server/domains/retail.js
```
→ **85** macros in `server/domains/retail.js` (2,321 lines), a Shopify/
Square/Lightspeed-parity POS + commerce-admin backend: product catalog,
cart/checkout (cash + real Stripe PaymentIntent), orders, customers +
segmentation, discount codes, storefront (buyer-facing publish/checkout),
order fulfillment pipeline, carrier shipping labels + tracking, marketing
campaigns, multi-channel listing, product reviews, staff accounts +
permissions, gift cards, refunds, collections, inventory transfers, tax
rates, abandoned-cart recovery, sales analytics, and four store-ops
"paste a book, get a report" calculators (`reorderCheck`, `pipelineValue`,
`customerLTV`, `slaStatus`). No inline registrations for `"retail"` exist in
`server/server.js`.

## Frontend surface (23 files per `grade-ux-polish.mjs`, 3,731 LOC)

`concord-frontend/app/lenses/retail/page.tsx` + 22 components in
`concord-frontend/components/retail/`: RetailWorkbench, LivePosTerminal,
RetailActionPanel, TaxRatesPanel, CustomersPanel, DiscountsManager,
AbandonedCartsPanel, ShippingZonesEditor, GiftCardsPanel, RefundsPanel,
CollectionsPanel, InventoryTransfers, SalesAnalytics, CommerceSuite (which
itself composes StorefrontManager, FulfillmentBoard, ShippingLabelsPanel,
CampaignsManager, ChannelsPanel, ReviewsPanel, StaffPanel), StorefrontShell.

## The defect: a fabricated 6-tab generic-artifact CRUD system sitting on
## top of a fully real, already-mounted commerce backend, plus 3 real
## macros with zero frontend caller, plus hardcoded fake KPI numbers

Before this pass, `app/lenses/retail/page.tsx` (2,112 lines) had **two
completely disconnected systems**:

1. **The real system** (unchanged by this pass, already correct): a
   `RetailWorkbench` slide-over (POS register / catalog / orders / low
   stock, all real `product-list`/`product-upsert`/`product-delete`/
   `cart-*`/`orders-list`/`low-stock` calls), a `RetailWorkbenchSection`
   (9 real tabs: Analytics/Customers/Discounts/Abandoned/Shipping/Gift
   cards/Refunds/Collections/Transfers), a `CommerceSuite` (7 more real
   tabs: Storefront/Fulfillment/Labels/Campaigns/Channels/Reviews/Staff), a
   `LivePosTerminal`, a `RetailActionPanel` (the 4 paste-a-book
   calculators), and a `TaxRatesPanel` — together these 19 components
   already covered 82 of the 85 macros with real, bespoke, macro-backed UI.
2. **A fabricated parallel system**: `MODE_TABS` (`Products`, `Orders`,
   `Customers`, `Pipeline`, `Support`, `Displays`) driven entirely by
   `useLensData<ArtifactData>('retail', currentType, …)` +
   `useRunArtifact('retail')` — the generic artifact-CRUD hooks that hit a
   client-side artifact store with **zero backing macro** for create,
   update, or delete on any of the six types. This is exactly the
   "fabricated parallel CRUD system" defect class from `CLAUDE.md`, and
   here it was the *dominant* surface of the page — the six MODE_TABS
   (with 13 sub-tabs, a shared editor modal, card renderers, and a full
   "Enhanced Dashboard") outweighed the real system in raw line count.

Specifics, verified by full read of the pre-pass file:
- **`Products`, `Orders`, `Customers`** each duplicated a concept that
  ALREADY has a complete, real, bespoke home: `RetailWorkbench`'s Catalog
  tab (`product-upsert`/`product-delete`), `RetailWorkbench`'s Orders tab +
  `FulfillmentBoard`/`RefundsPanel`/`ShippingLabelsPanel` (real orders come
  only from completing a sale via `cart-tender`/`cart-confirm-paid-with-intent`/
  `storefront-checkout` — there is no `order-create` macro at all), and
  `CustomersPanel` (`customers-add`/`customers-delete`/`customers-segments`).
  The fake tabs let a user hand-type an "Order" with an arbitrary
  `orderNumber`/`total` that never touched real inventory, wallet, or the
  real `orders-list` — a fabricated-success surface with no backend
  correspondence.
- **`Pipeline` (CRM deals), `Support` (tickets), `Displays` (in-store
  marketing displays)** have **zero backing macro of any kind** — no
  `retail.*` action persists a lead/deal, a support ticket, or a display
  record. These three fake tabs invented entire sub-products, matching the
  insurance rebuild's "Quote/Client/Compliance" precedent exactly.
- **`renderDashboard()`** (the "Enhanced Dashboard" view) rendered
  **hardcoded fabricated KPI numbers presented as live data**: `trend=
  "+12.4%"`, `trend="+3.2%"`, `trend="+8.1%"`, `trend="-0.8%"`, `trend=
  "-12%"`, `value="4.2%"` (Return Rate), `subtext="SLA compliance 94%"`,
  `value="$34.50"` (Customer Acquisition Cost) — none computed from any
  real or even fake data, just literal strings on `MetricCard`s styled
  identically to the genuinely-computed tiles next to them. Same violation
  in `renderReturnsPanel()`: `value="2.4 days"` (Avg Resolution). This is a
  direct "zero demo content" invariant violation — a user could not tell
  these numbers apart from the real ones on the same screen.
- **4 real, designed macros became orphaned by their own dependency on the
  fake system**: `generate_label`, `send_tracking`, `initiate_return`,
  `process_refund` are artifact-shaped order-lifecycle actions (their own
  code comments say "These run from the inline order-card buttons") that
  were called ONLY from the fake `Order` card's action buttons
  (`handleAction('generate_label', item.id)` etc.), operating on the
  fabricated `Order` artifact shape (`orderNumber`/`customer`/
  `trackingNumber`/`timeline[]`/`refundAmount`) — a shape that has **no
  correspondence to a real STATE-backed order** (real orders have `number`/
  `buyerName`/`buyerEmail`/no `timeline`, no `refundAmount` field).
- **3 real macros had zero frontend caller anywhere**, independent of the
  fake system: `discounts-apply` (no cart UI ever applied a discount code
  to a live cart — `DiscountsManager` only manages the code catalog),
  `gift-cards-balance` (no way to check a card's balance without
  redeeming it), `staff-check-permission` (the `"can role X do Y"` helper
  macro had no UI at all).

## What changed

### 1. `app/lenses/retail/page.tsx` — removed the fabricated 6-tab CRUD
### system wholesale (2,112 → 202 lines)

Deleted: `ArtifactType`/`ArtifactData`/`Product`/`Order`/`Customer`/`Lead`/
`Ticket`/`Display` interfaces, `MODE_TABS`, `seedData`, the `useLensData`/
`useRunArtifact` calls, every `render*` helper built on the fake `items`
array (`renderFunnelVisualization`, `renderOrderTimeline`,
`renderRFMAnalysis`, `renderCustomerTiers`, `renderSLADashboard`,
`renderResponseTemplates`, `renderInventoryForecasting`,
`renderVariantManagement`, `renderPricingHistory`, `renderReturnsPanel`,
`renderCard`, `renderFormFields`, `renderDashboard` — the one with the
hardcoded fake trend numbers — `renderLibrary`, `renderSubTabs`), the
editor modal, `handleAction`/`handleSave`/`handleDelete`, the "Quick Stats"
strip (computed from fake `items`), and `<UniversalActions domain="retail"
artifactId={items[0]?.id} …>` (a generic action array with no meaningful
target once the fake artifact ids are gone — same call the insurance
rebuild made, for the same reason: retail's real macros are STATE-keyed by
user, not artifact-id-keyed, so `UniversalActions`' artifact-id model
never fit this domain).

What remains is exactly the real system: header, `RetailWorkbench` (button
+ slide-over, now bound to the `W` keyboard shortcut via `useLensCommand`
— discoverable per the fluidity invariant), `LivePosTerminal`,
`RetailWorkbenchSection` (unchanged, 9 real tabs), `CommerceSuite`
(unchanged, 7 real tabs), `RetailActionPanel` + `TaxRatesPanel`, and the
shared infra footer (`LensFeedButton`, `RecentMineCard`, `AutoActionStrip`,
`CrossLensRecentsPanel`, `LensFeaturePanel`).

### 2. `components/retail/LivePosTerminal.tsx` — closes `discounts-apply`

Added a discount-code input + Apply button to the cart panel, appearing
once the cart has at least one line. Calls `discounts-apply` with the real
`cartId`, replaces the cart with the server's response (which carries
`appliedDiscountCode`), re-fetches `cart-total` so the displayed subtotal/
tax/total reflect the discount before tender, and shows the applied code
as a badge (mirrors the invariant that a cart can't double-apply — the
input is replaced by the applied-code badge once one succeeds).

### 3. `components/retail/GiftCardsPanel.tsx` — closes `gift-cards-balance`

Added a second footer row: "Check balance (no redeem)" — a code input +
button calling `gift-cards-balance`, showing `$balance of $initialValue ·
status` without touching the card's balance. Distinct from the existing
Redeem row directly above it (which spends value); this is a read-only
lookup a cashier or support agent needs before deciding how much to redeem.

### 4. `components/retail/StaffPanel.tsx` — closes `staff-check-permission`

Added a per-staff-member "Check access" toggle (shield icon) that expands
an inline permission-check widget: pick a permission from the real
`STAFF_ROLES` permission catalog, click Check, and see `✓ allowed` / `✗
denied` from `staff-check-permission`. This gives the helper macro a real,
designed home (verifying access before granting a workflow) rather than
inventing a redundant permissions-matrix page.

## Macro → UI classification (all 85 macros)

**DESIGNED** (real, bespoke UI, no fabrication) — 81/85:

| Macro group | Count | Where |
|---|---:|---|
| `product-list/upsert/delete`, `cart-open/add-line/total/tender`, `cart-create-payment-intent/confirm-paid-with-intent`, `orders-list`, `low-stock` | 10 | `RetailWorkbench.tsx` (POS/Catalog/Orders/Low-stock tabs) |
| `product-list`, `orders-list`, `cart-*`, `cart-create-payment-intent` | (reuse) | `LivePosTerminal.tsx` (also newly: `discounts-apply`) |
| `analytics-summary/revenue-by-day/top-products` | 3 | `SalesAnalytics.tsx` |
| `customers-list/add/delete/segments` | 4 | `CustomersPanel.tsx` |
| `discounts-list/create/delete` | 3 | `DiscountsManager.tsx` |
| `abandoned-carts-list`, `abandoned-cart-recover` | 2 | `AbandonedCartsPanel.tsx` |
| `shipping-zones-list/create/delete`, `shipping-rate-quote` | 4 | `ShippingZonesEditor.tsx` |
| `gift-cards-list/create/redeem`, `gift-cards-balance` (**newly wired**) | 4 | `GiftCardsPanel.tsx` |
| `refunds-list/create` | 2 | `RefundsPanel.tsx` |
| `collections-list/create/add-product/delete` | 4 | `CollectionsPanel.tsx` |
| `transfers-list/create/receive` | 3 | `InventoryTransfers.tsx` |
| `storefront-get/configure/publish/catalog/checkout` | 5 | `StorefrontManager.tsx` |
| `fulfillment-queue/advance/notifications` | 3 | `FulfillmentBoard.tsx` |
| `shipping-label-buy/labels-list/track` | 3 | `ShippingLabelsPanel.tsx` |
| `campaigns-list/create/send/record-conversion/performance` | 5 | `CampaignsManager.tsx` |
| `channels-list/connect/disconnect/list-products/sync-inventory` | 5 | `ChannelsPanel.tsx` |
| `reviews-list/submit/moderate/delete/summary` | 5 | `ReviewsPanel.tsx` |
| `staff-list/invite/update-role/activate/remove`, `staff-check-permission` (**newly wired**) | 6 | `StaffPanel.tsx` |
| `tax-rates-list/set/delete` | 3 | `TaxRatesPanel.tsx` |
| `reorderCheck`, `pipelineValue`, `customerLTV`, `slaStatus` | 4 | `RetailActionPanel.tsx` (paste-a-book analytics, pre-existing, real) |
| `feed` | 1 | `<LensFeedButton domain="retail">` (generic feed mount, macro-backed) |
| **`discounts-apply`** | 1 | **`LivePosTerminal.tsx` (newly wired this pass)** |
| **`gift-cards-balance`** | 1 | **`GiftCardsPanel.tsx` (newly wired this pass)** |
| **`staff-check-permission`** | 1 | **`StaffPanel.tsx` (newly wired this pass)** |

Running total: 10 + 3 + 4 + 3 + 2 + 4 + 4 + 2 + 4 + 3 + 5 + 3 + 3 + 5 + 5 +
5 + 6 + 3 + 4 + 1 + 1 + 1 + 1 = **82**. (`product-list`/`orders-list`/
`cart-*` are shared between `RetailWorkbench` and `LivePosTerminal` — two
real, bespoke consumers of the same macro, not double-counted as separate
macros.)

**GENERIC-STRIP-ONLY**: none — the removed 6-tab system was the lens's
only generic-scaffold surface, and it's gone. `scripts/grade-ux-polish.mjs
--honest` confirms: `isGenericScaffold: false`, `hasMacroButtonWall: true`
is present but paired with `bespokeRatio: 0.946` and `pillarsPresent: 5` —
i.e. the macro-action affordances are inside real bespoke panels
(`RetailActionPanel`'s labeled action grid), not standing in for them.

**UNSURFACED, confirmed real, intentionally left unsurfaced** — 4/85
(`generate_label`, `send_tracking`, `initiate_return`, `process_refund`):
verified real (registered, tested via `retail-lens-macros.test.js`) but
**superseded by a richer, already-real, already-surfaced STATE-backed
system** operating on actual orders instead of an artifact-shaped stand-in:
- `process_refund` → superseded by `refunds-create` (`RefundsPanel.tsx`),
  which validates against the real order's total and refund history,
  restocks real inventory, and is exposed via `refunds-list`.
- `generate_label`/`send_tracking` → superseded by `shipping-label-buy`
  (`ShippingLabelsPanel.tsx`, real carrier purchase against a real order,
  honest "not configured" failure) and `fulfillment-advance`'s built-in
  buyer-notification write on ship/deliver transitions (surfaced in
  `FulfillmentBoard.tsx`'s "Buyer notifications" list).
- `initiate_return` → its only effect (besides a computed RMA number) is a
  best-effort mirror write into an orphaned `returns` bucket that has **no
  listing macro anywhere** in the 85 — dead-end storage even when called.
Building a *second* UI surface for these would exactly reintroduce the
dual-disconnected-system problem this pass just removed — the correct
call (mirroring the insurance rebuild's disposition of `policy-document-
list`/`payment-list`/`claim-detail`) is to document them as real-but-
superseded rather than resurface them. Not a request to delete backend
code in a shared tree; a UI decision only.

## Genuinely missing, deferred

Real Shopify/Square-parity concepts the removed fake tabs were standing in
for, with **zero backend macro** anywhere in the 85-macro surface — per
the honesty invariant these are relabeled as deferred, not faked:
- ~~**CRM / sales pipeline**~~ **BUILT (2026-07-16, `cb45c52b`) — Wave 4
  larger-unit build.** New `deals-list`/`deals-upsert`/`deals-stage-move`/
  `deals-delete` macro family: a real SMB CRM funnel
  (lead→contacted→qualified→proposal→negotiation→won/lost), every stage
  change auditable via an appended `stageHistory` entry (never a mutable
  label), won/lost terminal with an explicit `reopen: true` path back into
  an open stage only (a closed deal can't skip won→lost directly), and
  `deals-list` rollups (total/weighted pipeline value, per-stage
  count/value/weighted, won/lost totals) computed server-side only —
  never a client-invented number. `pipelineValue`'s pre-existing
  pasted-book calculator now falls back to reading this persisted book,
  but ONLY on true omission of both the `deals`/`opportunities` keys —
  a caller who pastes any value under either key (even malformed
  garbage) still gets the exact pre-existing "invalid → empty pipeline,
  never crash" behavior, verified against the pre-existing test that
  covers exactly that case (`retail-lens-macros.test.js`'s "a non-array
  deals payload yields an empty pipeline, never crashes"). New
  `PipelinePanel.tsx`: a real kanban board by stage with per-column
  totals, a designed create form, a stage-move select per card (no
  drag-and-drop primitive existed anywhere in the codebase to reuse —
  building one from scratch was out of this unit's scope), and a
  won/lost archive with a reopen action. Mounted as a new "Pipeline" tab
  in the retail workbench, next to Customers. Tests: 28 new backend
  (`retail-deals-pipeline.test.js`, incl. exact rollup-math assertions
  and per-user isolation) + all 5 retail backend test files re-run
  together (148/148, 0 regressions) + 7 new frontend
  (`PipelinePanel.test.tsx`).
- ~~**Support tickets**~~ **BUILT (2026-07-16, `e9c4f7fd`) — Wave 4
  larger-unit build.** New `tickets-list`/`tickets-upsert`/
  `tickets-status-move`/`tickets-reply-add`/`tickets-delete` macro
  family: a real support-desk lifecycle
  (open→in-progress→waiting-on-customer→resolved→closed), `closed` a
  locked terminal requiring `reopen: true` back into an open status
  only, and resolving a ticket stamps `resolvedWithinSla` (boolean)
  computed against the ticket's real `slaDeadline` — never a
  client-invented flag. The per-priority SLA target table
  (`TICKET_PRIORITY_SLA_MINUTES = {critical:60, high:240, medium:1440,
  low:2880}`) was hoisted to a single shared constant at the top of the
  file and is now the ONE source of truth `slaStatus`'s pre-existing
  incidents branch reads too, so a persisted ticket's deadline and the
  ad-hoc incidents-report compliance math can never silently disagree.
  `slaStatus`'s legacy `tickets` branch now falls back to reading this
  persisted queue, gated the exact same way the sibling CRM unit's
  `pipelineValue` fix required: true omission of the `tickets` key
  (checked via `in`), never falsy/non-array shape — so a caller pasting
  any value under `tickets`, even garbage, still gets the pre-existing
  "invalid → empty report, never crash" behavior byte-identically
  (verified against `retail-lens-macros.test.js`'s "a non-array
  incidents payload falls through to the legacy ticket branch" test,
  which still passes unmodified). New `TicketQueuePanel.tsx`: a real
  list/detail split view — priority + SLA-countdown badges (color-coded
  breached/approaching/healthy), status filter tabs, a create form, a
  reply thread + composer, resolve and reopen actions. Mounted as a new
  "Tickets" tab next to Pipeline. Tests: 24 new backend (standalone) +
  all 6 retail backend test files re-run together (206/206, 0
  regressions) + 9 new frontend (`TicketQueuePanel.test.tsx`).
- ~~**In-store marketing displays**~~ **BUILT (2026-07-16, `3f0dfc3d`) —
  Wave 4 larger-unit build.** New `displays-list`/`displays-upsert`/
  `displays-status-move`/`displays-log-impressions`/
  `displays-record-conversion`/`displays-delete` macro family: a real
  physical-merchandising record (`displayType` enum — endcap/window/
  checkout-counter/floor-display/shelf-talker/promotional-table —
  validated, unknown rejected), genuinely distinct from the pre-existing
  digital `campaigns-*` family (email/SMS sends) rather than a
  duplicate. `productSkus` validated against the real product catalog
  (`s.products`), not free text. A `planned→active→removed` lifecycle
  with an auditable `statusHistory` (mirrors deals'/tickets' pattern),
  `removed` a locked terminal requiring `reopen: true` back into an
  open status. Two honesty design points carried through from the
  sibling units: impressions are a MANUALLY LOGGED, accumulating count
  (`displays-log-impressions`, deliberately named "log" not "track" —
  no automated foot-traffic sensor exists anywhere in Concord), and
  conversions mirror `campaigns-record-conversion`'s existing discipline
  exactly — `displays-record-conversion` requires a real `orderId` that
  exists in the caller's own order book (`s.orders`), rejects an
  unknown/fake id, and guards double-attribution via
  `attributedOrderIds`. `revenuePerBudgetDollar` is honestly `null`
  (never `Infinity`/`NaN`) whenever budget is 0, both per-display and in
  the aggregate rollup. New `DisplaysPanel.tsx`: a real merchandising
  board with status filters, a create form, a log-impressions quick
  action, and a record-conversion flow gated on picking a real order via
  `orders-list`. Mounted as a new "Displays" tab next to Tickets. Tests:
  42 new backend + all 7 retail backend test files re-run together
  (248/248, 0 regressions) + 12 new frontend + 33/33 combined retail
  frontend regression (`PipelinePanel`/`TicketQueuePanel`/
  `DisplaysPanel`/`retail-lens-states`).
- ~~**Richer product schema**~~ **BUILT (2026-07-16, `f5541272`) — Wave 4
  larger-unit build, the FOURTH AND FINAL of this section's originally
  "Genuinely missing" items; the whole section below is now historical.**
  `product-upsert` extended with `supplier`/`leadTimeDays`/
  `dailySalesRate`. A structural landmine specific to this macro (unlike
  the sibling `deals-*`/`tickets-*`/`displays-*` upserts, which do
  field-by-field partial updates, `product-upsert` does a FULL OBJECT
  REPLACE every call — the only field it previously preserved from the
  existing record was `createdAt`) was resolved by extending that exact
  preserve-on-omit pattern to the three new fields, proven byte-identical
  against the pre-existing minimal `{sku,name,price,stock}` call shape
  (the shape existing callers already use). `priceHistory` is
  SERVER-COMPUTED only — never readable from caller params — auto-
  appending `{oldPrice,newPrice,changedAt}` only when `price` genuinely
  changes. `turnoverRate` = `(dailySalesRate × 365) / stock` (standard
  annual-turnover formula), honestly `null` (never `Infinity`) at
  stock=0. `abcClass` is a real Pareto/ABC bucketing by revenue proxy
  (`price × dailySalesRate`), ranked across the caller's whole catalog on
  `product-list` (a lone product can't self-classify), classified by the
  CUMULATIVE revenue share of every product ranked ABOVE it — this
  specific design choice avoids a real boundary-overshoot bug where a
  single dominant SKU's own revenue crossing 80% would otherwise
  misclassify it as "C" instead of "A"; honestly `null` catalog-wide when
  there's no sales-rate data to rank against. New `product-price-history`
  (a lighter single-SKU read than fetching the whole catalog). Variants
  (size/color/style sub-SKUs) are genuinely SEPARATE records
  (`product-variant-upsert`/`-list`/`-delete`) — own SKU, own stock, a
  `priceDelta` from the real parent price, parent-SKU validated against
  the live catalog, cascade-deleted when the parent product is deleted —
  with true partial-update semantics from day one (no legacy-shape
  landmine, since these are new macros). New `ProductCatalogPanel.tsx`
  REPLACES `RetailWorkbench`'s old thin `CatalogTab` (name/price/stock/
  category/barcode only) rather than standing beside it as a second
  competing catalog surface — ABC-class badges, turnover rate, a
  read-only price-history timeline, and a variants sub-list with its own
  add/edit/remove, all real designed fields, no JSON-paste. Tests: 36 new
  backend + all 8 retail backend test files re-run together (284/284, 0
  regressions) + 11 new frontend + 44/44 combined retail frontend
  regression (`PipelinePanel`/`TicketQueuePanel`/`DisplaysPanel`/
  `ProductCatalogPanel`/`retail-lens-states`).

Each of the four items above needed new `domains/retail.js` macros
before a real, designed UI could be built for them — all four are now
built (2026-07-16, Wave 4 larger-unit builds `cb45c52b`/`e9c4f7fd`/
`3f0dfc3d`/`f5541272`). This "Genuinely missing, deferred" section is
now empty.

## Confirmed real and left alone, with reason

`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/retail/*.tsx` → only two honesty-invariant *comments*
(`CommerceSuite.tsx`: "no seeded or mock data"; `ShippingLabelsPanel.tsx`:
"no fake labels"), zero actual fabrication in any of the 22 components.
`RetailActionPanel.tsx`, `RetailWorkbench.tsx`, `CustomersPanel.tsx`,
`FulfillmentBoard.tsx`, `RefundsPanel.tsx`, `ShippingLabelsPanel.tsx`,
`DiscountsManager.tsx` (besides the new Apply-in-cart wiring),
`AbandonedCartsPanel.tsx`, `ShippingZonesEditor.tsx`, `CollectionsPanel.tsx`,
`InventoryTransfers.tsx`, `SalesAnalytics.tsx`, `StorefrontManager.tsx`,
`ChannelsPanel.tsx`, `CampaignsManager.tsx`, `ReviewsPanel.tsx`,
`TaxRatesPanel.tsx` — all already real, already macro-backed, no changes
needed beyond the three unsurfaced-macro closures above.

## Verification

- `node --check server/domains/retail.js` — clean (file untouched this
  pass; frontend-only fix, no backend risk taken in a shared tree).
- `cd server && node --test tests/retail-domain-parity.test.js
  tests/retail-lens-macros.test.js tests/depth/retail-behavior.test.js
  tests/depth/retail-fulfillment-behavior.test.js` — **83/83 pass**,
  unmodified.
- `concord-frontend/tests/retail-lens-states.test.tsx` — this file
  previously pinned the *removed* `useLensData`/`useRunArtifact` fake-CRUD
  loading/error/empty/populated states; rewritten (not softened) to pin
  the real architecture instead: the page mounts inside `LensShell`
  without crashing, the real POS terminal / sales analytics / commerce
  suite / ops action panel all mount, the Retail Workbench button opens
  the real POS/catalog/orders/low-stock modal (starts closed, `W` opens
  it), the workbench's Customers sub-tab switches to the real
  `CustomersPanel`, and a static guard confirms the page source no longer
  imports `use-lens-data`/`use-lens-artifacts`. `npx vitest run
  tests/retail-lens-states.test.tsx` — **5/5 pass**.
- `npx eslint app/lenses/retail/page.tsx components/retail/*.tsx
  tests/retail-lens-states.test.tsx` (from `concord-frontend/`) — clean,
  exit 0.
- `npx tsc --noEmit -p .` (from `concord-frontend/`) — zero retail-related
  errors (`grep -i retail` on the full-repo output is empty).
- `node scripts/verify-lens-backends.mjs` (from repo root) — retail is
  WIRED (absent from the `NO-BACKEND-CALL` list, which is exactly
  `narrative-walk` + `ux-suite`, the two program-wide exemptions); totals
  `{"WIRED":258,"NO-BACKEND-CALL":2}` of 260.
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) — retail
  entry: `"tier": "polished"`, `"isGenericScaffold": false`,
  `"bespokeRatio": 0.946`, `"pillarsPresent": 5`, `"antiPatterns": 0`,
  `"honestCapped": false`. `audit/` outputs reverted via `git checkout --
  audit/` per the transient-artifact rule.
- `node scripts/lens-unsurfaced.mjs --lens retail` — before: 3 flagged
  (`discounts-apply`, `gift-cards-balance`, `staff-check-permission`, all
  now closed) plus the fake system silently hid 4 more (`generate_label`,
  `send_tracking`, `initiate_return`, `process_refund` — the scanner
  doesn't see through `handleAction('generate_label', item.id)` string
  literals passed to a generic dispatcher, which is exactly the kind of
  false negative the assignment brief warned about). After: 4 flagged,
  all four documented above as confirmed-real-and-intentionally-
  superseded — the 3 genuine gaps are closed, none remain unexplained.
