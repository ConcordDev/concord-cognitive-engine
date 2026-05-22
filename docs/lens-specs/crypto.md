# crypto — Feature Gap vs Coinbase

Category leader (2026): Coinbase (+ MetaMask Portfolio for on-chain). Content fills via free public APIs (CoinGecko, DEX aggregators) + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `crypto` domain macros — deep (~60 macros): portfolioAnalysis, search-tokens, token-candles, swap-quote/route, price-alerts CRUD, token-allowances + revoke, address-book, holdings add/list/sell, transactions, recurring-buys, NFTs, watchlist, tax-report, ai-portfolio-insight, wallet CRUD, send, limit orders create/list/cancel, portfolio-snapshot/history, market-overview, feed.

## Has (verified in code)
- 7-tab workspace: Portfolio, Chart, Swap, Activity, Wallets, Alerts, Approvals
- Holdings tracking with add/list/sell, portfolio summary + snapshot history
- Token search, candle charts, market overview, watchlist
- Swap quote + routing (DEX-style); send; limit orders (create/list/cancel/check)
- Multi-wallet management (create/rename/delete); address book
- Price alerts CRUD + check; token allowance review + revoke (security)
- Recurring buys (DCA); NFT tracking; tax-report generation; AI portfolio insight

## Missing — buildable feature backlog
- [x] `[M]` Live on-chain balance sync from a connected wallet address (read-only RPC)
- [x] `[M]` Real-time price websocket streaming with live P&L ticker
- [x] `[S]` Staking / yield position tracking
- [x] `[M]` Portfolio allocation breakdown chart + rebalancing suggestions
- [x] `[S]` Transaction CSV import from exchanges for cost-basis accuracy
- [x] `[S]` Cross-chain / multi-network filtering on holdings and activity
- [x] `[S]` Push price-alert delivery (alerts exist but require a check macro)

## Parity
~95% of Coinbase's feature surface. Swap, limit orders, alerts, allowance revocation, DCA, tax reporting plus live on-chain balance sync, a real-time price stream + P&L ticker, staking/yield tracking, allocation breakdown + rebalancing, transaction CSV import, cross-chain filtering, and push alert delivery all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
