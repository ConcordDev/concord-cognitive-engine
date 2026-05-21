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
- [ ] `[S]` Bidding / auction on rare intercepts instead of fixed price
- [ ] `[M]` Reputation-gated inventory (higher rep unlocks shadow-tier listings)
- [ ] `[S]` Haggle / negotiate dialogue with the fence NPC
- [ ] `[M]` Player-to-player resale of purchased intercepts
- [ ] `[S]` Watchlist / alert when a matching intercept appears
- [ ] `[S]` Decryption mini-game for shadow-tier messages

## Parity
~60% of an in-game grey-market stall. Functionally complete for its narrow purpose — browse, tier-price, buy, reveal, reputation — but lacks the auction/haggle/resale depth that would make the economy feel alive.
