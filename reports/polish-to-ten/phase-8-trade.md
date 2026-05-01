# Phase 8 — Player-to-Player Trade

## Goal

Two players can exchange items and coins atomically with a both-sides-confirm gate, item ownership re-verification at execution time, and anti-spam limits.

## Pre-implementation discoveries (Block C sweep)

The sweep found extensive prior art in the wager system at `server/routes/wagers.js` + migration `051_wagers.js`. The wager flow (propose → 60s window → opponent accepts or expires → escrow lock → resolve → payout) is structurally identical to a trade flow — just with coin amounts instead of item bundles.

This phase is **mostly mirroring the wager pattern**, expanded for:
- Item bundles (not just coin amounts)
- Both sides set offers and toggle Ready (not just opponent accepts)
- Re-verification at execute time (extra paranoia for items, which are easier to dupe than coins)

The Block C sweep also confirmed that:
- `commission-service.js` has a complete escrow state machine if a future trade variant needs platform-fee deduction (this phase's player-to-player trade doesn't take a fee)
- `transfer.js` exists for ledger-based atomic transfers (but the wager flow uses `users.sparks` / `users.concordia_credits` columns directly — simpler, race-safe inside a transaction; same approach used here)
- The `user:${userId}` socket room pattern from Phase 3 is the right delivery channel; added `emitToUser(userId, event, payload)` helper to server.js to make the call site clean

## Changes

### `server/migrations/069_player_trade.js` (new)

- `player_trades` table — id, initiator_id, recipient_id, status (state machine), initiator_offer_json, recipient_offer_json, ready timestamps, completion/cancellation tracking, expires_at
- `player_inventory.reserved_until` and `reserved_by` columns (ALTER TABLE ADD COLUMN, idempotent)
- `player_inventory.soulbound INTEGER NOT NULL DEFAULT 0` — items flagged true cannot be traded
- Status enum: pending / both_offered / initiator_ready / recipient_ready / complete / cancelled / expired
- 5-minute trade lifetime (matches the spec)

### `server/routes/player-trade.js` (new)

Mirrors `wagers.js` factory pattern. Endpoints:
- `GET /api/player-trade` — list active trades for the auth'd user
- `GET /api/player-trade/:id` — single trade detail (participant-only)
- `POST /api/player-trade/initiate` — creates session, anti-spam (max 3 active per user), emits `trade:request` to the recipient
- `POST /api/player-trade/:id/offer` — sets offer; **changing the offer un-readies BOTH sides** (industry standard — Steam, RPGMaker MMORPG plugin); emits `trade:offer_updated` to the other party
- `POST /api/player-trade/:id/ready` — flips ready bit; if both ready, runs `_executeTrade` atomically; emits `trade:other_ready` to the other party (or `trade:complete` to both on success)
- `POST /api/player-trade/:id/cancel` — either party can abort; emits `trade:cancelled` to both

`_executeTrade` runs inside a `db.transaction()`. **Re-verifies ownership at execute time** — if the seller spent an offered item via another route between Ready and execute, the verification fails and the trade is auto-cancelled with `cancel_reason='initiator_verify_failed:...'`. Item rows are either fully transferred (preserves quality + acquired_at lineage) or partially transferred (decrement source, insert new destination row of the partial quantity).

Coin transfers use the same `users.{sparks,concordia_credits}` direct UPDATE pattern as wagers, race-safe because the whole thing runs inside the transaction.

Soulbound items are blocked at `_verifyOfferOwnership`.

### `server/server.js`

- Added `emitToUser(userId, event, payload)` helper that uses the `user:${userId}` room established in Phase 3 (Phase 3 also added the `socket.join` on auth, so this works end-to-end out of the box). Enriches the payload with the same `_seq`, `ts`, `_evt` fields the existing `realtimeEmit` does.
- Mounts `createPlayerTradeRouter` at `/api/player-trade`, passing `requireAuth`, `db`, and `emitToUser`.

### `concord-frontend/components/trade/TradeWindow.tsx` (new)

Two-pane modal — your offer / their offer. State machine reflected in UI:
- Editable when `!myReady && !isComplete`
- Both panes show ready badge
- "Ready" button changes label after click; locks the offer until other side readies or either party changes their offer
- Cancel button hits `/cancel` then closes
- WebSocket subscriptions wire all 4 trade events (`trade:offer_updated`, `trade:other_ready`, `trade:complete`, `trade:cancelled`) via the existing `subscribe()` from `@/lib/realtime/socket`
- Toast on complete + cancel via `useUIStore`

Item picker integration is stubbed with a TODO inside the editable pane — the inventory drag-drop is a follow-up since we don't have a generic inventory picker component yet.

### `concord-frontend/lib/realtime/socket.ts`

`SocketEvent` union extended with the 5 trade events (request, offer_updated, other_ready, complete, cancelled).

## Verification

- `node --check server.js routes/player-trade.js migrations/069_player_trade.js` — all clean
- `npx tsc --noEmit` — no new type errors in touched files
- `npx eslint components/trade/TradeWindow.tsx lib/realtime/socket.ts` — clean
- Manual verification (Phase 20): two browser tabs as different users → user A initiates → B sees `trade:request` toast → both set offers → both Ready → coins / items move atomically → both see `trade:complete` → DB shows status=complete with completed_at populated.

## Files touched

| File | Action |
|---|---|
| `server/migrations/069_player_trade.js` | created — player_trades table + inventory reservation columns + soulbound flag |
| `server/routes/player-trade.js` | created — Express router with 5 endpoints + atomic executor |
| `server/server.js` | added `emitToUser` helper; mounted player-trade router at `/api/player-trade` |
| `concord-frontend/components/trade/TradeWindow.tsx` | created — two-pane offer UI with WebSocket-driven state |
| `concord-frontend/lib/realtime/socket.ts` | extended SocketEvent union with 5 trade events |

## Notes for downstream phases

- Phase 9 (party): `emitToUser` reused for `party:invite`, `party:member_joined`, etc. No new realtime helper needed.
- Phase 10 (anti-dupe): the inventory reservation columns already exist; phase 10 adds the audit log table + scheduled anomaly detection on `player_inventory` (negative quantity, lock orphans).
- Inventory picker UI is the open follow-up. The trade flow works without it — testing requires direct API calls or a dev tool that posts JSON offers — but a proper UI ships with Phase 20 verification + a final inventory-picker subtask.
