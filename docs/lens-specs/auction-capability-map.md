# auction — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("auctions"' server/domains/auctions.js` → 0
> (this domain uses the generic `register(domain, name, handler, opts)`
> pattern, not `registerLensAction`) —
> `grep -c 'register("auctions"' server/domains/auctions.js` → 11.
>
> Note: `node scripts/lens-unsurfaced.mjs --lens auction` reports "No
> registered macros found for lens 'auction'" — the lens route is
> `/lenses/auction` (singular) but the domain is registered as `auctions`
> (plural, matching the REST route prefix `/api/auctions/*`); the script's
> lens→domain name matching doesn't bridge that. Not evidence of a wiring
> gap — `verify-lens-backends.mjs` (which checks real REST/macro reachability,
> not a name match) reports `auction` WIRED via its REST routes.

## Reference app + parity target

**eBay auctions + EVE Online's regional market** (time-bound bidding with
snipe protection, plus a persistent EVE-style buy-order book). The page
(`page.tsx`, 506 → 690 LOC) is genuinely well-built: real REST plumbing
(`/api/auctions/*`), realtime socket updates (`auction:bid-placed`,
`auction:settled`), an honest network-failure banner with a working Retry,
and accessible bid/create modals. `server/domains/auctions.js` documents
its own intent precisely: it's a *parallel* macro surface over the exact
same `server/lib/auctions.js` functions the REST routes already use, built
for the Orchestrated Invariant Engine / mobile client / ⌘K — not a
replacement frontend path. The frontend correctly uses the REST routes
directly; this is not an "unsurfaced macro" situation, it's two equally
valid entry points into the same logic.

## Findings

### `price_history` / `market_depth` — REAL GAP in this lens specifically (fixed)

Both have real REST twins (`GET /api/auctions/item/:itemId/price-history`,
`GET /api/auctions/item/:itemId/depth`) that are **already used** — but
only inside `components/world/AuctionBrowsePanel.tsx`, a *different*
auction UI mounted inside the World lens (Concordia's in-game auction
house), not `/lenses/auction`. This lens's own page never let a bidder
check whether a price was fair or see the order-book depth before posting
a buy order — a real, standalone gap in this specific lens.

**Fix:** added an "Item market" section to `/lenses/auction/page.tsx`:
type or click-through an item id to see real sale-price stats (last/avg/
min–max/% change) with a lightweight CSS sparkline (no chart dependency),
plus live order-book depth (asks ascending / bids descending / spread).
Wired a "Check market" icon button on every active-auction card and a
"check market price" link next to the buy-order form's item-descriptor
field, so a user can price-check before bidding or before posting a buy
order — the actual use case these two macros exist for.

## Verify gate

- `npx eslint app/lenses/auction/page.tsx` — 0 errors/warnings.
- `npx tsc --noEmit -p .` — 0 errors attributable to this file.
- `node scripts/verify-lens-backends.mjs` — `auction` reports WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `auction`: `tier: "polished"`, `isGenericScaffold: false`.
