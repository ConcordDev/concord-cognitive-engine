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
- [ ] `[M]` Live on-chain balance sync from a connected wallet address (read-only RPC)
- [ ] `[M]` Real-time price websocket streaming with live P&L ticker
- [ ] `[S]` Staking / yield position tracking
- [ ] `[M]` Portfolio allocation breakdown chart + rebalancing suggestions
- [ ] `[S]` Transaction CSV import from exchanges for cost-basis accuracy
- [ ] `[S]` Cross-chain / multi-network filtering on holdings and activity
- [ ] `[S]` Push price-alert delivery (alerts exist but require a check macro)

## Parity
~70% of Coinbase's feature surface. One of the deepest lenses — swap, limit orders, alerts, allowance revocation, DCA, and tax reporting are all real. Main gaps are live on-chain sync and real-time streaming.
