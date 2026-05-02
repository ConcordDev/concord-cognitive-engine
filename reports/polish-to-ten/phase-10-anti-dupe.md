# Phase 10 — Anti-Duplication Safeguards

## Goal

Catch inventory exploits — item duplication, negative-quantity states, orphan reservations from broken trades — within a heartbeat cycle. Provide an admin queue for human review.

## Pre-implementation discoveries

- `wash_trade_flags` table exists for marketplace fraud detection but doesn't generalize to inventory
- `audit_log` table exists for HTTP request logging but doesn't carry inventory delta info
- `inventory_lock` / `reservation` columns added in Phase 8 (`reserved_until`, `reserved_by`) — the schema-level guard is already in
- No prior inventory anomaly detection scheduler

So this phase adds the **observation layer** on top of the protection that Phase 8 already put in place.

## Changes

### `server/migrations/071_inventory_audit.js` (new)

Two tables:
- `inventory_audit_log` — append-only. id, ts, actor_user_id, from_user_id, to_user_id, item_id, item_name, delta (signed integer), category enum (trade / craft / quest_reward / shop_buy / shop_sell / loot / gift / consume / admin / system / other), ref_id (trade id, quest id, etc), before_qty, after_qty, notes. Indexed on ts, item_id+ts, user pair, ref_id.
- `inventory_anomaly_queue` — open-then-resolve workflow. id, detected_at, kind enum (negative_quantity / orphan_reservation / lineage_break / rapid_duplication / manual_review), user_id, item_id, inventory_id, details_json, status (open/investigating/resolved/dismissed), resolved_at, resolved_by, resolution.

### `server/lib/inventory-audit.js` (new)

Three exports:
- `logInventoryTransfer(db, opts)` — append a single audit row. Used everywhere a `player_inventory` mutation crosses a boundary (trade, craft, quest reward, etc).
- `flagAnomaly(db, kind, opts)` — open a new entry in the anomaly queue. Validates the kind enum at call time.
- `scanForAnomalies(db)` — heartbeat-friendly detection pass. Three queries:
  1. Negative-quantity rows: scan `player_inventory WHERE quantity < 0`. Each one means a bug or an exploit landed.
  2. Orphan reservations: `reserved_until` in the past but still locked. Flags + auto-clears (the lock is harmless to release; trade flow normally clears its own).
  3. Rapid duplication: > 10 positive-delta audit entries for the same `(to_user_id, item_id)` in the last 60s. Catches scripted exploits.

  Idempotent — only flags states without an existing `open` anomaly.

### `server/routes/player-trade.js` (extended)

`_transferItems` now calls `logInventoryTransfer(db, { actorUserId, fromUserId, toUserId, itemId, itemName, delta, category: 'trade', refId: tradeId, beforeQty, afterQty })` for every item movement. Wrapped in try/catch — audit failure never blocks a successful transfer.

### `server/server.js`

Added a new heartbeat block in `governorTick` that runs `scanForAnomalies(db)` every 100th tick (~5 minutes at the default heartbeat interval). Logs counts via `structuredLog("warn", "inventory_anomalies_flagged", ...)` when anything is flagged. Wrapped in try/catch.

## Verification

- `node --check` on all touched server files — clean
- Migration is append-only, idempotent (CREATE TABLE IF NOT EXISTS)
- Manual verification (Phase 20):
  1. Run a complete trade between two users → check `inventory_audit_log` has rows with category='trade' and ref_id = trade id
  2. Inject a negative-quantity row in a dev console → next 100th tick → row appears in `inventory_anomaly_queue` with kind='negative_quantity'
  3. Set `reserved_until` to past timestamp manually → next scan → row appears as kind='orphan_reservation' AND the reservation is auto-cleared
  4. Insert > 10 fake audit rows for same user+item in 60s window → next scan → row appears as kind='rapid_duplication'

## Files touched

| File | Action |
|---|---|
| `server/migrations/071_inventory_audit.js` | created — 2 tables (audit log + anomaly queue) |
| `server/lib/inventory-audit.js` | created — 3 exports (log, flag, scan) |
| `server/routes/player-trade.js` | extended `_transferItems` to log every movement |
| `server/server.js` | heartbeat block to run scanForAnomalies every 100 ticks |

## Notes for downstream phases

- Future: extend other inventory mutation paths (craft engine, quest reward grant, NPC shop) to call `logInventoryTransfer` with their respective categories. The hook is in; the wiring is incremental and low-risk.
- The `lineage_break` anomaly kind is reserved in the schema but not detected yet. It's intended for cases where an item with a DTU lineage trail loses its parent reference — needs the DTU-lineage subsystem to expose its invariants.
- An admin review UI would be a follow-up — for now the queue is queryable via raw SQL or a simple `/api/admin/anomalies` endpoint can be added when needed.

## Block C complete

Phases 8, 9, 10 commit the multiplayer dimension's foundation:
- 8: trade with both-confirm escrow
- 9: party with leader/invite/chat
- 10: audit log + anomaly scanner

The realtime channel established in Phase 3 (`user:${userId}` rooms via `emitToUser`) carries all of it.
