# markets — Feature Gap vs Polymarket / Kalshi (prediction markets)

Category leader (2026): Polymarket / Kalshi (prediction / event markets). The lens is a SPARKS-only, non-extractive spectator betting market (no real-money exposure). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `betting.{list_open, place_bet, my_positions}` macros + `server/domains/markets.js` market-data macros (options-chain, futures-board, forex-quotes, depth-of-book, alerts CRUD, quote-history).

## Has (verified in code)
- Open markets list — question, resolution kind, YES/NO SPARKS pools, open/close timestamps
- Place bet — stake SPARKS on a YES/NO side
- My positions — stake, side, payout, resolution status/outcome
- Market-data side: options chain, futures board, forex quotes, depth-of-book, quote history
- Price alerts — create/list/cancel alerts; MarketsWorkbench, quote-card list, quote detail

## Missing — buildable feature backlog
- [ ] `[M]` Live odds / implied-probability display — derive YES% from pool balance, update in realtime
- [ ] `[M]` Market creation by users — propose a question with resolution criteria
- [ ] `[M]` Price-history chart per market — odds over time
- [ ] `[S]` Position selling / cash-out before resolution — secondary-market exit
- [ ] `[M]` Order book / limit orders — match bets at chosen prices, not just pool stakes
- [ ] `[S]` Leaderboard — top forecasters by realized P&L
- [ ] `[M]` Market categories & search — browse by topic, trending, closing-soon
- [ ] `[S]` Resolution evidence / dispute view — show how a market resolved

## Parity
~40% of a prediction-market platform. Core list→bet→position→resolve loop works on a pooled-stake model, but missing live odds, user-created markets, price-history charts, and cash-out that define Polymarket/Kalshi.
