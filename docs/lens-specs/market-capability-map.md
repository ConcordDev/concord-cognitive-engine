# Market Lens — Capability Map (Frontend Rebuild Program)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Scope note — disambiguating "market"

This codebase has **three** distinct things that answer to "market":
1. **`server/domains/market.js`** (this doc's target) — a real
   competitive-intelligence / market-research business tool (Crayon/Klue +
   trading-desk parity): trend analysis, competitor matrix, price
   elasticity, sector performance, competitor CRUD + SWOT, news monitoring,
   battlecards, win/loss analysis, website-change tracking, TAM/SAM/SOM
   sizing, landscape quadrant. Surfaced at `app/lenses/market/page.tsx`.
2. **Four inline `register("market", ...)` macros in `server/server.js`**
   (lines 28641–28714): `listingCreate`, `list`, `buy`, `library` — a much
   older, unrelated in-game-item marketplace substrate (`STATE.listings`,
   `STATE.transactions`, `STATE.entitlements`). Investigated below — this is
   a genuine domain-string collision but not a functional one (see
   "Domain-string collision" section).
3. **Sibling lenses `markets`, `marketplace`, `marketing`, and the
   `market-competitor` domain** — separate targets, out of scope, not
   touched by this pass.

## Backend surface

```
grep -c 'registerLensAction("market"' server/domains/market.js
```
→ **25** macros in `server/domains/market.js` (1102 lines). No inline
`register("market", ...)` macro-name collisions with these 25 (the 4 inline
`server.js` macros use disjoint names — see below).

Macro list: `trendAnalysis`, `competitorMatrix`, `priceElasticity`,
`sector-performance`, `quotes-batch`, `competitor-add`, `competitor-list`,
`competitor-update`, `competitor-delete`, `market-dashboard`,
`competitor-news`, `battlecard-save`, `battlecard-list`, `battlecard-delete`,
`winloss-record`, `winloss-delete`, `winloss-analysis`, `page-snapshot`,
`page-watch-list`, `page-watch-delete`, `change-alerts`, `alert-mark-read`,
`market-sizing`, `sizing-scenarios`, `landscape-quadrant`.

## Domain-string collision: `market.listingCreate`/`list`/`buy`/`library`

`server/server.js:28641-28714` registers four macros under the SAME domain
string `"market"` for a completely different feature: a DTU marketplace
listing/purchase/entitlement substrate (`STATE.listings`,
`STATE.transactions`, `STATE.entitlements`), with its own dedicated REST
routes in `server/routes/operations.js`: `POST /api/market/listing`,
`GET /api/market/listings`, `POST /api/market/buy`,
`GET /api/market/library`.

**No runtime collision** — the macro registry is keyed by
`(domain, action)`, and none of these four action names (`listingCreate`,
`list`, `buy`, `library`) overlap with any of the 25
`server/domains/market.js` action names, so `runMacro("market", X, ...)`
always routes correctly regardless of which file registered it.

**But it IS orphaned.** Grepped the entire frontend
(`concord-frontend/`, `concord-mobile/`) for both the macro names and the
dedicated REST paths:
```
grep -rn "listingCreate" --include="*.ts" --include="*.tsx" --include="*.js" . --exclude-dir=node_modules --exclude-dir=.next
grep -rn "/api/market/listing\|/api/market/buy\|/api/market/library" --include="*.ts" --include="*.tsx" concord-frontend/ concord-mobile/
```
→ zero frontend hits for either. The only caller of `listingCreate` outside
`server.js` itself is `server/routes/operations.js:421`, which just proxies
the same macro to the same dead REST route. **Conclusion: the 4 inline
macros + their 4 REST routes are dead code — no UI anywhere calls them.**
They pre-date the current `server/domains/market.js` competitive-intel
substrate and were never migrated or removed when "market" was repurposed.
Left alone (out of scope: removing dead backend code wasn't requested, and
doing so risks an undiscovered caller such as an external API consumer or
test fixture; flagging it here is the honest disposition).

## What changed

### The defect: 3 real, well-built quant macros wired to a permanently-dead generic action strip

`app/lenses/market/page.tsx` (pre-fix) had a "Market Analysis" panel with
3 buttons — Trend Analysis, Competitor Matrix, Price Elasticity — wired
through `useRunArtifact('market')`, which POSTs to
`/api/lens/market/:id/run` and requires a **persisted artifact id**
(`marketItems[0]?.id`, from `useLensData('market', 'data', { noSeed: true })`
— a generic artifact store of type `'data'`). **Nothing in the market lens,
or anywhere else in the frontend, ever creates a `market`-domain artifact of
type `'data'`.** `noSeed: true` also disables the dev-mode auto-seed
fallback. The result: `marketItems` was permanently empty, so clicking any
of the three buttons showed "No market data artifact found. Add price data
to analyze." with **no way in the UI to add price data** — a dead button
wall, exactly the "real macro reached only through a generic action array"
defect class CLAUDE.md's zero-generic-tendencies invariant names (and the
identical shape to the home-improvement lens's "planning-calculators panel"
defect from the prior wave).

This is real backend depth going unused: `trendAnalysis` computes SMA/EMA
crossovers, MACD histogram, and Wilder RSI with golden-cross/death-cross/
overbought/oversold signal generation; `competitorMatrix` does
weighted-feature composite scoring + SWOT balance + market-share + gap
analysis; `priceElasticity` runs both arc elasticity and a log-log OLS
regression (slope, intercept, R², standard error) with an
inelastic/elastic classification. All three are genuine, non-trivial
compute (verified by reading `server/domains/market.js` lines 1–368 in
full) — they just had no real front door.

### Fix: `concord-frontend/components/market/MarketAnalysisWorkbench.tsx` (new)

A tabbed workbench (Trend Analysis / Competitor Matrix / Price Elasticity),
matching the existing `CompetitiveIntelligence.tsx` tab idiom already used
lower on the same page, calling `lensRun(domain, action, params)` directly
(the virtual-artifact path — `POST /api/lens/run` builds `artifact.data`
from the input body directly, no persisted artifact needed, per
`server.js`'s `_handleLensRun`/`/api/lens/run` handler) instead of the dead
`useRunArtifact` + persisted-id path:

- **Trend Analysis tab** — a real repeatable price-point table (date +
  close, add/remove rows) plus a "Paste CSV" quick-fill (`date,close` per
  line, parsed and validated client-side, no raw-JSON textarea), SMA-short/
  SMA-long/RSI-period parameter inputs, a live close-price line chart
  (`ChartKit`) of the entered series, and a results panel rendering the
  overall trend badge, latest close, RSI, SMA values, and the signal list
  with bullish/bearish coloring — all fields sourced 1:1 from the macro's
  real response shape (`overallTrend`, `sma`, `macd`, `rsi`, `signals`).
- **Competitor Matrix tab** — a shared feature-tag editor (add/remove
  scored dimensions), a repeatable competitor table (name, revenue, and a
  0–10 score input per feature) with a per-row expandable SWOT editor
  (strengths/weaknesses/opportunities/threats textareas, one item per line —
  mirroring the existing `BattlecardEditor`/`SwotEditor` line-splitting
  idiom already used elsewhere on this page for consistency), and a results
  panel showing the ranked composite scores, market share, SWOT balance, and
  competitive gaps (features trailing the leader by ≥3 points).
- **Price Elasticity tab** — a repeatable price/quantity observation table,
  an arc-vs-log-log method toggle, a price-vs-quantity scatter chart, and a
  results panel showing the classification (highly inelastic → highly
  elastic), primary elasticity, and the log-log regression's R²/standard
  error.

All three tabs persist their in-progress working set to `localStorage`
(`concord:market:trendPrices:v1`, `concord:market:competitorMatrix:v1` +
`...Features:v1`, `concord:market:elasticityObs:v1`) — the same pattern
already used by `Watchlist.tsx` for its symbol list — so a user's
in-progress data survives a reload. This is client-side scratch-pad state
only; no persistence is implied or claimed on the backend side (these three
macros are pure compute-from-input with no `STATE` writes, unlike the
competitor/battlecard/winloss/pagewatch macros which are genuinely
server-persisted per-user).

### `app/lenses/market/page.tsx`

- Removed the dead "Backend Action Panel" (3-button strip + its
  hand-rolled, duplicated results-rendering JSX), `useLensData`/
  `useRunArtifact` imports, `marketItems`/`runAction`/`actionResult`/
  `isRunning`/`handleAction` state, and the now-unused `Play`/`Loader2`
  icon imports.
- Mounted `<MarketAnalysisWorkbench />` in its place.

## Confirmed real and already correctly wired (no changes)

Read every remaining component in full;
`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/market/*.tsx app/lenses/market/page.tsx` → no fabrication
signatures found in any of them:

- **`CompetitorTracker.tsx`** — real `competitor-add`/`competitor-list`/
  `competitor-update`/`competitor-delete`/`market-dashboard`, with a real
  per-competitor SWOT accordion editor. Bespoke, not a generic CRUD wall.
- **`CompetitiveIntelligence.tsx`** (824 LOC, 6-tab workbench) — real
  `competitor-news` (Google News RSS pull + competitor tagging),
  `battlecard-save`/`-list`/`-delete` (full editor with why-we-win/why-we-
  lose/landmines/objections), `winloss-record`/`-delete`/`-analysis` (deal
  form + win-rate/loss-reason bar chart via `ChartKit` + head-to-head
  records), `page-snapshot`/`page-watch-list`/`-delete`/`change-alerts`/
  `alert-mark-read` (real URL fetch + HTML-strip diffing + price-token
  extraction + change-alert feed), `market-sizing`/`sizing-scenarios`
  (top-down/bottom-up TAM/SAM/SOM calculator with saved scenarios),
  `landscape-quadrant` (real 2×2 positioning plot driven by tracked
  competitor records, axis-selectable). This is the Crayon/Klue parity
  surface and it is fully real — no changes needed.
- **`MarketHeatmap.tsx`** — real `sector-performance` (SPDR sector ETF
  quotes via Yahoo Finance), range-selectable 1D/1W/1M/YTD tile grid.
- **`Watchlist.tsx`** — real `quotes-batch` (Yahoo Finance quote batch),
  localStorage-persisted symbol list, add/remove, sortable table.
- **`SectorHeatmap.tsx`** (in `components/market/`) — a second, differently
  styled `sector-performance` presentation with `SaveAsDtuButton` (motion-
  animated tile grid + 1D/YTD toggle). Duplicate macro, distinct
  presentation and distinct feature (save-as-DTU) — not redundant enough to
  merge; left alone.
- **`components/lens/SectorHeatmap.tsx`** (generic, imported as
  `SectorHeatmap` in `page.tsx`) — renders `realtimeData.quotes` from
  `useRealtimeLens('market')`, a **different** real-time index feed
  (GSPC/DJI/IXIC/RUT/VIX), not the `sector-performance` macro. Genuinely
  distinct data source (live index quotes vs. sector ETF pull-on-demand);
  correctly not conflated with `MarketHeatmap`/`SectorHeatmapPanel`.
- **`MarketEmpireListing.tsx`, `PurchaseButton.tsx`, `RoyaltyDashboard.tsx`,
  `EntityAttributionCard.tsx`, `QualityTierBadge.tsx`,
  `ArtifactDetailModal.tsx`, `PipelineTrail.tsx`** — all belong to the
  **generic DTU-marketplace surface** (`/api/marketplace/*`,
  `/api/entity/*`), NOT the `market` domain's 25 macros. `MarketEmpireListing`
  is used on this page (the "Active Listings" grid + purchase-confirm flow,
  backed by `/api/marketplace/listings` + `/api/marketplace/purchaseWithRoyalties`
  — real, distinct system). The other six
  (`ArtifactDetailModal`/`RoyaltyDashboard`/`EntityAttributionCard`/
  `QualityTierBadge`/`PurchaseButton`/`PipelineTrail`) are **not imported by
  the market lens at all** — grepped and confirmed they're used exclusively
  by `app/lenses/marketplace/page.tsx` (a sibling lens, explicitly out of
  scope for this pass). They live under `components/market/` for historical/
  naming reasons but are marketplace-lens components, not market-lens
  components. Left alone — out of scope, and removing/relocating them risks
  breaking the `marketplace` lens another rebuild pass owns.

## Verification

- `node --check server/domains/market.js` — clean (file untouched this
  pass; verified anyway per the task checklist).
- `node --test tests/market-domain-parity.test.js` — **22/22 pass**
  (unmodified).
- `node --test tests/market-competitor-domain-parity.test.js` — **5/5 pass**
  (unmodified; confirmed by reading its header that it also targets
  `server/domains/market.js`, not a different file, despite the name).
- `npx eslint app/lenses/market/page.tsx components/market/*.tsx` — clean,
  zero warnings/errors.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260 (`market` counts as WIRED; the two `NO-BACKEND-CALL` lenses are
  `narrative-walk` and `ux-suite`, both by design, unrelated to this pass).
- `node scripts/grade-ux-polish.mjs --honest` → `market` lens entry:
  `"tier": "polished"`, `"isGenericScaffold": false`, `"honestCapped": false`,
  `"pillarsPresent": 5`, `"antiPatterns": 0`. `audit/` regenerated files show
  no diff (`git diff --stat -- audit/` empty) — nothing to revert.

## Left alone, with reason

- **The 4 orphaned inline `market.listingCreate`/`list`/`buy`/`library`
  macros in `server.js` + their dead `/api/market/*` REST routes** — no
  frontend caller anywhere (verified by grep across
  `concord-frontend/`/`concord-mobile/`); out of scope to remove backend
  code not requested, and deleting it risks an undiscovered external/API
  caller. Documented here so a future pass doesn't have to re-discover it.
- **`ArtifactDetailModal`/`RoyaltyDashboard`/`EntityAttributionCard`/
  `QualityTierBadge`/`PurchaseButton`/`PipelineTrail`** — real components,
  but belong to the sibling `marketplace` lens (confirmed by import grep),
  not this one. Not touched.
- **`markets`, `marketplace`, `marketing`, `market-competitor`** — explicitly
  out of scope per the assignment brief; not touched.

## Genuinely missing

None found. All 25 `server/domains/market.js` macros now have real,
designed frontend surfaces; no macro was found unsurfaced or backed only by
a generic scaffold after the fix above.
