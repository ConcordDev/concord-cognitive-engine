# black-market — Feature Gap vs (in-game grey-market stall)

Category leader (2026): no direct consumer rival — this is an in-world game feature (Sael's stall: intercepted-message fence). Closest analog is a marketplace/auction screen in an RPG.
Backend: `server/domains/black-market.js` — macros `listings`, `tiers`; backed by intercepted Concord Link messages surfaced by the walker-journey tick; sparks currency only.

## Has (verified in code)
- Sael's stall UI listing intercepted messages with redacted sender/receiver
- Encryption-level price tiers (none/basic/high/shadow)
- Purchase reveals the original payload; sparks currency (no real-money path)
- Fence reputation tracking (buyer_rep, purchases, last trade); rep bumps on buy, drops on failed buy
- Listing expiry (created_at / expires_at)

## Missing — buildable feature backlog
- [x] `[S]` Bidding / auction on rare intercepts instead of fixed price
- [x] `[M]` Reputation-gated inventory (higher rep unlocks shadow-tier listings)
- [x] `[S]` Haggle / negotiate dialogue with the fence NPC
- [x] `[M]` Player-to-player resale of purchased intercepts
- [x] `[S]` Watchlist / alert when a matching intercept appears
- [x] `[S]` Decryption mini-game for shadow-tier messages

## Parity
~95% of an in-game grey-market stall. Browse, tier-price, buy, reveal, reputation, plus live auctions with bidding, reputation-gated inventory, haggle dialogue, player resale, watchlist alerts, and a decryption mini-game all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
