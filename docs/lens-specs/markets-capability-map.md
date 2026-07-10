# Markets Lens — Capability Map (Frontend Rebuild Program)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

**Scope note:** this is the **markets** lens (plural) — a financial-markets /
trading-terminal domain (options, futures, forex, prediction markets, order
books). It is distinct from the sibling `market` (singular,
competitive-intelligence), `marketplace`, and `marketing` lenses, which this
pass did not touch.

## Backend surface

```
grep -c 'registerLensAction("markets"' server/domains/markets.js
```
→ **22** macros in `server/domains/markets.js` (1,117 lines). No inline
`register("markets", ...)` in `server.js`.

The 22 macros split into three real sub-systems:
- **Derivatives/global-markets terminal (7):** `options-chain` (Black-Scholes
  greeks, Abramowitz & Stegun `normCdf`), `futures-board` (9 CME continuous
  contracts, live quotes via Yahoo Finance `v7/finance/quote`), `forex-quotes`
  (7 FX majors, live via Yahoo), `depth-of-book` (real single-level inside
  quote — Yahoo doesn't expose L2, and the macro says so honestly rather than
  synthesizing fake depth), `alerts-list` / `alert-create` / `alert-cancel`
  (per-user, `STATE.marketsLens.alerts` Map).
- **Quote research (1):** `quote-history` — real OHLCV bars via Yahoo Finance
  `v8/finance/chart`, 11 range × 13 interval combinations validated server-side.
- **Prediction markets — Polymarket/Kalshi parity (14):** `market-create`,
  `market-list` (category/search/sort/facets), `market-get`, `market-odds`
  (live payout preview), `market-history` (price-history chart points),
  `position-open` (pooled parimutuel bet), `my-positions` (mark-to-market),
  `position-cashout` (2% exit fee, non-extractive — fee stays in the pool),
  `market-resolve` (creator-only, evidence-gated, settles every open
  position), `market-resolution` (dispute/evidence view), `order-place` /
  `order-cancel` / `order-book` (resting limit orders that convert to
  positions when the implied probability crosses the limit), `leaderboard`
  (realized P&L ranking).

## Frontend surface

- `concord-frontend/app/lenses/markets/page.tsx` (233 lines) — page shell +
  a **separate, pre-existing** spectator-betting section (see "Adjacent
  system" below) + mounts the three bespoke components.
- `concord-frontend/components/markets/MarketsWorkbench.tsx` (422 lines) —
  slide-in terminal panel, 5 tabs (Options / Futures / FX / Depth / Alerts),
  covers the 7 derivatives/terminal macros.
- `concord-frontend/components/markets/MarketsQuoteDetail.tsx` (586 lines) —
  TradingView-style quote-research surface: hero price card, `lightweight-charts`
  line/area chart, timeframe pills, up-to-4-ticker percent-rebase comparison,
  Save-as-DTU. Covers `quote-history` (plus a **read-only** cross-domain call
  to the sibling `market` lens's `quotes-batch` macro for fundamentals —
  price/PE/EPS/market cap — that `markets` itself doesn't compute; no
  `market`-domain files were touched).
- `concord-frontend/components/markets/PredictionMarkets.tsx` (955 lines) —
  full Polymarket/Kalshi-parity surface: Browse (search/category
  facets/sort/trending) → Propose-market form → Market detail modal (odds,
  price-history chart, pooled-bet + limit-order panel, live order book,
  creator-only resolve-with-evidence, dispute view) → My Positions
  (mark-to-market, cash-out) → Leaderboard. Covers all 14 prediction-market
  macros.

## Verification of coverage (every macro traced to a real caller)

```
node scripts/lens-unsurfaced.mjs --lens markets
```
→ `markets: 0/22 macros never referenced in the frontend`

Cross-checked by direct grep of every macro name against
`app/lenses/markets/page.tsx` + `components/markets/*.tsx` — all 22 have
exactly one call site, matching the component breakdown above.

## Classification: all 22 macros are DESIGNED

Every macro is reached through bespoke, domain-appropriate UI (options-chain
table with Δ/Γ/ν columns and strike ladder, CME futures board with tick/margin
columns, FX grid with pip value, bid/ask depth columns, a real alert-rule
builder, a lightweight-charts price pane with multi-ticker comparison, a full
prediction-market browse/create/bet/order-book/resolve/leaderboard flow) — not
a generic macro-button wall, not a raw JSON-paste form, not a
`<UniversalActions>`/`<LensFeaturePanel>` body. No macro is
GENERIC-STRIP-ONLY or UNSURFACED.

`node scripts/grade-ux-polish.mjs --honest` (result reverted after read —
`audit/` is a transient regenerated artifact per repo convention):
```
{"lens":"markets","tier":"polished","fileCount":4,"totalLoc":2200,
 "pageLoc":234,"bespokeComponentLoc":1966,"maxBespokeComponentLoc":956,
 "bespokeRatio":0.894,"importsGenericTrio":false,"usesGenericBody":false,
 "hasMacroButtonWall":true,"hasInlineActionWall":false,"hasLoading":true,
 "hasEmptyState":true,"hasErrorUI":true,"hasAria":true,
 "hasNativeButtons":true,"hasKeyboardHandlers":true,"hasResponsive":true,
 "hasAnimation":true,"hasToasts":false,"hasAltOnImages":true,
 "divAsButtons":0,"inlineHex":0,"pillarsPresent":5,"antiPatterns":0,
 "isGenericScaffold":false,"honestCapped":false}
```
Already `tier: "polished"`, `isGenericScaffold: false` — no generic-scaffold
signature found (the `hasMacroButtonWall: true` flag reflects the
alert-create/order-place/limit-order action buttons, which sit inside real
bespoke panels, not a substitute for them).

## Fabrication check

```
grep -niE "Math\.random|MOCK|mock|fake|lorem|hardcoded|dummy|sample data|TODO|FIXME|stub" \
  components/markets/*.tsx app/lenses/markets/page.tsx
```
→ two benign hits only: a doc comment ("Every value rendered comes from a
real macro response — no mock data") and an `sr-only` accessibility-pattern
placeholder note common to every rebuilt lens's boilerplate footer. No
fabrication signatures anywhere in the rendered UI.

Field-shape audit (the #1 recurring bug class in this program):
- `MarketsWorkbench.tsx` reads `r.data.result?.<field>` directly against the
  raw `api.post('/api/lens/run', …)` response. Traced the server's
  `_unwrapLensEnvelope` (`server.js:39499`) + route handler
  (`server.js:39596-39598`): a macro's own `{ok, result}` is peeled once
  server-side before the route re-wraps as `{ok:true, result:<peeled>}` — so
  `r.data.result.chain` / `.contracts` / `.quotes` / `.alerts` are exactly
  right. No mismatch.
- `PredictionMarkets.tsx` uses `lensRun()` (`lib/api/client.ts:352`), whose
  documented while-loop unwraps "single OR double" `{ok,result}` nesting —
  traced through the same server-side single-peel and confirmed
  `d.result.market` / `.positions` / `.leaderboard` / etc. land correctly.
- `MarketsQuoteDetail.tsx`'s local `callMacro()` helper independently
  re-derives the same unwrap contract (checks whether `data.result` itself
  has an `ok` key before returning) — also correct for both `market` and
  `markets` domain calls.

No hardcoded price/quote data anywhere: futures `tickSize`/`tickValue`/
`multiplier`/`initialMargin` are static CME contract specifications (exchange
constants, not fabricated prices); all traded prices, bid/ask, greeks inputs
(spot/IV are explicit user-supplied calculator inputs, matching the macro's
own required-input validation), and OHLCV bars come from a live Yahoo Finance
fetch or the real per-user prediction-market pool state.

## Adjacent system on the same page (left alone, with reason)

`app/lenses/markets/page.tsx`'s top section ("Spectator Markets" header,
markets list with YES/NO buttons, "Your Positions" list) wraps the **`betting`
domain**, not `markets`. `betting` is registered inline in `server.js`
(`register("betting", "open_market"/"place_bet"/"resolve_market"/
"list_open"/"my_positions", ...)`, backed by `server/lib/betting-markets.js`
— a real, DB-backed (`prediction_markets`/`market_positions`/
`sparks_balances` tables), parimutuel, SPARKS-denominated spectator-wagering
substrate tied to emergent world outcomes (faction wars, deity pilgrimages,
drift events). This is **out of the assigned scope** (the task scoped to the
22 macros in `server/domains/markets.js`) and was not modified. Verified its
field shapes (`world_id`, `question`, `resolution_kind`, `pool_yes_sparks`,
`pool_no_sparks`, `opened_at`, `closes_at` for markets; `market_id`, `side`,
`stake_sparks`, `payout_sparks`, `question`, `status`, `resolved_outcome` for
positions) match the page's `Market`/`Position` TypeScript interfaces exactly
— no fabrication or shape mismatch found here either.

One real observation, **not fixed** (out of scope): `betting.open_market` and
`betting.resolve_market` have **zero callers** anywhere in the codebase —
not the frontend, not any heartbeat/emergent module. The lib's own comment
("Intentionally not user-resolved — substrate is the oracle… manual: admin
resolves via CLI") suggests these were designed as an ops/CLI surface rather
than end-user UI, which would make this a documented-by-design gap rather
than a defect — but it's also plausible no substrate-driven auto-open/resolve
was ever wired up, leaving every `betting` market permanently un-openable and
un-resolvable outside a raw macro call. This is a `betting`-domain
finding, not a `markets`-domain one; flagging it for whoever owns that
substrate rather than fixing it here.

## What changed

**Nothing.** Every one of the 22 `markets` macros already has a real,
bespoke, domain-appropriate UI caller; no fabricated data, no field-shape
mismatches, no generic-scaffold pattern. This is the rare case in the Wave 3
sweep where the lens was already fully built to the "full app" bar before
this pass started.

## Verification

- `node scripts/lens-unsurfaced.mjs --lens markets` → `0/22 macros never
  referenced in the frontend`.
- `cd server && node --test tests/markets-domain-parity.test.js
  tests/depth/markets-behavior.test.js` → **40/40 pass**, unmodified.
- `cd concord-frontend && npx eslint app/lenses/markets/page.tsx
  components/markets/*.tsx` → clean, zero output.
- `cd concord-frontend && npx tsc --noEmit` → zero errors in any
  `markets`-related file (the 6 pre-existing repo-wide errors are in
  `components/ethics/DecisionToolkit.tsx` and `components/events/EventOps.tsx`,
  unrelated, pre-existing, not touched).
- `node scripts/verify-lens-backends.mjs` →
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (markets counted as WIRED).
- `node scripts/grade-ux-polish.mjs --honest` → markets `tier: "polished"`,
  `isGenericScaffold: false` (see JSON above); `audit/ux-polish-honest*`
  reverted via `git checkout` after reading (transient regenerated artifact).
- No backend file was touched, so `node --check server/domains/markets.js`
  was run anyway as a sanity check → clean.

## Left alone, with reason

- **All 22 `markets` macros / all 3 components** — already real, already
  correctly wired to bespoke UI, no fabrication signatures, no field-shape
  bugs found on close audit of the double/triple-unwrap envelope contract.
- **The `betting`-domain spectator-markets section** atop the same page —
  real, DB-backed, correctly wired for the read/bet paths it does have (list,
  bet, positions); out of scope (different domain file, different task
  boundary) — not modified. See "Adjacent system" above for the one open
  question (`open_market`/`resolve_market` callers) worth a separate look by
  whoever owns `server/lib/betting-markets.js`.

## Genuinely missing

None found within the assigned `markets`-domain scope.
