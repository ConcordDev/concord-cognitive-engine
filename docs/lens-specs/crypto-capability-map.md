# Crypto Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/crypto.js` (2378 LOC) — 61 macro registrations via
> `grep -c 'registerLensAction("crypto"' server/domains/crypto.js`.
> Frontend audited by reading `app/lenses/crypto/page.tsx` (1711 LOC) in
> full and spot-checking all 15 `components/crypto/*.tsx` files
> (~4100 LOC) for the specific defect classes this program tracks
> (fabricated numeric data, fake success-on-failure, decorative
> interactions with no state change).

## Backend surface — 61 macros, all real

Portfolio analysis, token search/candles, swap quote+routing, price
alerts CRUD+check, token allowances+revoke, address book, holdings
add/list/sell, transactions, recurring buys (DCA), NFTs, watchlist, tax
reports, AI portfolio insight, wallet CRUD, send, limit orders, portfolio
snapshot/history, market overview, feed.

## Reference app

Coinbase (+ MetaMask Portfolio for on-chain) — the terminal/finance
identity is the correct read here (this program's Section 3 "Finance —
terminal identity"): dense dark background, `font-mono` right-aligned
numerals, live tick/delta color coding.

## Audit result: no real defects found; identity already correctly applied

`grep -c "font-mono"` returns 111 hits and `text-right|tabular-nums`
returns 39 across the page + components — the finance-terminal identity
(monospace, right-aligned numerals) is already broadly and consistently
applied, not a generic dashboard wearing a crypto skin.

Spot-checked every `catch` block in `page.tsx` (11 total) for the "fake
success on failure" anti-pattern this program's rubric names explicitly
(CLAUDE.md §3, the Studio DAW / Council-lens precedents) — every one
either surfaces a real error toast or silently reconciles via `refetch()`
against the real backend state; none shows a success message inside a
catch block. `handleEarn`/`handleSpend` ("Manual earn" / test-fund top-up)
are honestly labeled practice-wallet actions in a simulated portfolio tool
(the lens's own scope, per the pre-existing `docs/lens-specs/crypto.md`:
"Content fills via free public APIs... by design"), not a claim of real
money movement.

`grep -rn "Math.random"` across the lens returns no matches. No hardcoded
numeric stat found presented as live/measured data.

## 1.5 Reference-parity checklist

| # | Item (Coinbase) | Disposition |
|---|---|---|
| 1 | Portfolio holdings + summary | ALREADY REAL |
| 2 | Live price chart (candles) | ALREADY REAL — `token-candles` |
| 3 | Swap / DEX-style routing | ALREADY REAL — `swap-quote`/`route` |
| 4 | Send / multi-wallet management | ALREADY REAL |
| 5 | Price alerts | ALREADY REAL — CRUD + check |
| 6 | Token allowance review + revoke (security) | ALREADY REAL |
| 7 | Recurring buys (DCA) | ALREADY REAL |
| 8 | NFT tracking | ALREADY REAL |
| 9 | Tax report generation | ALREADY REAL |
| 10 | AI portfolio insight | ALREADY REAL |
| 11 | Live on-chain balance sync | ALREADY REAL (per prior wave) |
| 12 | Real-time price stream + P&L ticker | ALREADY REAL (per prior wave) |
| 13 | Staking/yield tracking | ALREADY REAL (per prior wave) |
| 14 | Allocation breakdown + rebalancing | ALREADY REAL (per prior wave) |
| 15 | Transaction CSV import | ALREADY REAL (per prior wave) |
| 16 | Cross-chain filtering | ALREADY REAL (per prior wave) |
| 17 | Push alert delivery | ALREADY REAL (per prior wave) |

**Coverage summary:** 17 of 17 checklist items already real. This audit's
incremental contribution is confirming, with direct evidence (grep counts,
full catch-block read), that the finance-terminal visual identity and the
no-air honesty rule are both already correctly and consistently applied —
no changes made this session.

## Files touched

None — audit only, no defects found.
