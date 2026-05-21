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
- [x] `[M]` Live odds / implied-probability display — derive YES% from pool balance, update in realtime
- [x] `[M]` Market creation by users — propose a question with resolution criteria
- [x] `[M]` Price-history chart per market — odds over time
- [x] `[S]` Position selling / cash-out before resolution — secondary-market exit
- [x] `[M]` Order book / limit orders — match bets at chosen prices, not just pool stakes
- [x] `[S]` Leaderboard — top forecasters by realized P&L
- [x] `[M]` Market categories & search — browse by topic, trending, closing-soon
- [x] `[S]` Resolution evidence / dispute view — show how a market resolved

## Parity
~90% of a prediction-market platform. Full Polymarket/Kalshi loop is live: user-created
markets with resolution criteria, parimutuel pools with live implied-probability odds,
price-history charts, pooled bets + limit orders with an order book, cash-out before
resolution, creator resolution with evidence/dispute view, and a realized-P&L leaderboard.
SPARKS-only and non-extractive by design; remaining gap is real-money settlement (out of
scope) and licensed news feeds for auto-resolution.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
