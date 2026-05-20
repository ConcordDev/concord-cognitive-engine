# crypto — Feature Completeness Spec

Rival app(s): Coinbase, MetaMask, CoinGecko
Sources:
- https://www.coinbase.com/ (portfolio, trade, send/receive, recurring buys, staking)
- https://help.coinbase.com/ (advanced trade — limit/market orders)
- https://metamask.io/ (wallet, send, swap, token approvals, multiple accounts)
- https://www.coingecko.com/ (market data — trending, gainers/losers, global cap)

## Features

### Portfolio
- [x] Holdings with FIFO cost-basis lots (macro: crypto.holdings-add / holdings-list)
- [x] FIFO sell with realized P&L (macro: crypto.holdings-sell)
- [x] Portfolio summary — value, unrealized/realized P&L, by-chain split (macro: crypto.portfolio-summary)
- [x] Portfolio value snapshots over time (macro: crypto.portfolio-snapshot)
- [x] Portfolio performance history + best/worst day (macro: crypto.portfolio-history)
- [x] Multiple wallets / accounts — hot / hardware / exchange / watch-only (macro: crypto.wallet-*)
- [x] Holdings scoped + filterable per wallet (macro: crypto.holdings-add walletId / holdings-list walletId)
- [x] AI portfolio insight (macro: crypto.ai-portfolio-insight)
- [x] Multi-chain dashboard summary (macro: crypto.dashboard-summary)

### Trade
- [x] Swap quote + multi-hop route (macro: crypto.swap-quote / swap-route)
- [x] Limit orders — create / list / cancel (macro: crypto.order-*)
- [x] Order fill engine — fills limit orders when live price crosses (macro: crypto.orders-check)
- [x] Recurring buys / DCA — create / toggle / run-due (macro: crypto.recurring-buys-*)

### Send & receive
- [x] Send crypto — FIFO-debits holdings, records a send transaction (macro: crypto.send)
- [x] Receive — address QR (frontend QRCodeReceive)
- [x] Address book — save / list / delete (macro: crypto.address-book-*)
- [⚠] Broadcast a real on-chain transaction — BOUNDARY: needs a signing key + RPC
  node; substitute: portfolio-accurate send/receive ledger with address book

### Market data
- [x] Token search + paginated browse — CoinGecko-backed (macro: crypto.search-tokens)
- [x] OHLCV candles (macro: crypto.token-candles)
- [x] Market overview — trending, top gainers / losers, global market cap (macro: crypto.market-overview)
- [x] Watchlist — add / remove / list with live prices (macro: crypto.watchlist-*)
- [x] Price alerts — create / list / delete / check (macro: crypto.price-alerts-*)

### DeFi
- [x] Staking — stake / unstake / positions / record rewards (macro: crypto.staking-*)
- [x] Token approvals / allowances review (macro: crypto.token-allowances)
- [x] Revoke an allowance (macro: crypto.revoke-allowance)
- [x] Gas estimation (macro: crypto.estimateGas)

### NFTs
- [x] NFT collection — add / list / delete (macro: crypto.nfts-*)

### Transactions & tax
- [x] Transaction history with filters (macro: crypto.transactions-list)
- [x] Record an arbitrary transaction (macro: crypto.transactions-record)
- [x] Tax report — realized gains, income, capital-gains summary (macro: crypto.tax-report)

### Analysis
- [x] Portfolio analysis — allocation, concentration, risk (macro: crypto.portfolioAnalysis)
- [x] Transaction verification (macro: crypto.verifyTransaction)
- [x] On-chain pattern detection (macro: crypto.detectPatterns)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Broadcast a real on-chain transaction | signing key + RPC node + custody | portfolio-accurate send/receive ledger + address book; swaps & orders settle against live CoinGecko prices |

## Verification log
- 2026-05-20: Backend — 53 macros; `node --check` clean. Live CoinGecko prices for
  holdings / portfolio / orders / market overview.
- 2026-05-20: Tests — `tests/crypto-domain-parity.test.js` 53/53 green (wallets CRUD
  + wallet-scoped holdings, send FIFO debit + insufficient/no-address rejections,
  limit order create/cancel + buy/sell fill engine, portfolio snapshot + history,
  market-overview network-error path).
- 2026-05-20: Frontend — Trade (limit orders + fill check), Market (trending /
  gainers / losers / global cap), Wallets & Send, and a Performance card on the
  Portfolio tab; `npx tsc --noEmit` exit 0.
- 2026-05-20: `npm run score-lenses` → crypto 7/7 PASS.
