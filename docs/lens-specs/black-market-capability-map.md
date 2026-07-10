# Black-Market Lens — Capability Map (Frontend Rebuild Program, Wave 3)

Reproduce the macro list:
`grep -c 'registerLensAction("black-market"' server/domains/black-market.js` → 19

## Reference framing

Confirmed via `content/world/npcs.json` (authored NPC `broker_sael`, tagged
`black_market_fence: true`, "runs the black-market stall for intercepted
Concord Link messages") plus cross-world contraband lore in
`factions.json`/`tunya/lore.json`/`concordia-hub/npcs.json`. This models a
classic gray-market/fence economy (EVE-Online-style contraband interception)
layered onto reputation-gated tiers, auctions, haggling, resale, watchlists,
and a Caesar-cipher decrypt mini-game.

## Audit finding: nothing wrong

All 19 macros registered under the domain string `"black-market"` (hyphenated,
matching `blackMarket` import in `server/domains/index.js`) are real: `listings`
queries the live `creative_artifacts` table; the remaining 17
(`rep-get`, `inventory`, `auction-*`, `haggle*`, `owned-list`, `resale-*`,
`watch-*`, `decrypt-*`) persist to real per-actor state
(`globalThis._concordSTATE.blackMarketLens`), originating entirely from real
params/actor actions — no seed data. `tiers` is a static category/label
config, not a stub.

**No domain-id mismatch.** `UndergroundExchange.tsx:24` sets
`const DOMAIN = 'black-market'` and every one of its 16 `lensRun` calls
(6 read + 10 write) matches a real server registration exactly; grepping
for a no-hyphen `"blackmarket"` registration anywhere in `server/` found
none.

**Architectural note (documented here, not a defect):** the lens page and
`SaelStall.tsx` use a *separate* REST subsystem (`/api/black-market`,
`server/routes/black-market.js` + `server/lib/black-market.js`, table
`black_market_listings`) — by design, per that file's own header comment:
listings are seeded only by real interception events from the walker
journey tick, never player-authored. Only `UndergroundExchange.tsx` uses the
`lensRun('black-market', …)` macro layer. Two independent black-market
subsystems share one domain name and one UI page; worth knowing for anyone
extending either half.

No fabricated data found: prices come from a real server-side `BASE_PRICE`
table or user-set bid/resale values; reputation is computed server-side only;
the one `Math.random()` in the whole surface (`lib/black-market.js:50`) is a
legitimate 60%-surface-probability roll gating whether an already-real
intercepted message becomes a listing — not client-render fabrication.

`node scripts/lens-unsurfaced.mjs --lens black-market`:
```
black-market: 0/19 macros never referenced in the frontend
```
(`--lens blackmarket` correctly returns "No registered macros found" —
confirming the hyphenated spelling is the only one that exists.)

## What this rebuild changed

Nothing. No hyphen mismatch, no fabricated/stub data, no dead macro, no
generic-scaffold defect. Per the Wave 3 mandate, this capability map records
that honest conclusion rather than inventing a diff.

## Verification

- No code changed; existing lint/type/wiring/grader state is unaffected.
- `node scripts/verify-lens-backends.mjs` — `black-market` stays `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `black-market`: `tier: "polished"`, `isGenericScaffold: false`.
