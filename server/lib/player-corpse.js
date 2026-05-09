// server/lib/player-corpse.js
//
// Theme deferred (game-feel pass): Dark Souls "shadow corpse" recovery.
//
// On death, dropCorpseOnDeath records a corpse at the death position
// with COIN_LOSS_FRACTION of the player's current Concord Coin balance
// marked as recoverable. The player respawns + must return to recover
// the lost coins. Dying again with an active corpse converts the old
// corpse to "lost" (set lost_at) — only one recoverable corpse per
// player at a time.
//
// Constants:
//   COIN_LOSS_FRACTION = 0.25   (cap on lost coins per death)
//   COIN_LOSS_MAX      = 1000   (hard floor for late-game runaway)
//   RECOVER_RADIUS_M   = 4      (must be within 4m to recover)
//   ACTIVE_TTL_S       = 7d     (auto-mark lost after a week)

import crypto from "node:crypto";

export const COIN_LOSS_FRACTION = 0.25;
export const COIN_LOSS_MAX      = 1000;
export const RECOVER_RADIUS_M   = 4;
export const ACTIVE_TTL_S       = 7 * 86400;

/**
 * Drop a corpse for `userId` at `position`. If they had an active
 * corpse already, mark that one as lost (Dark Souls rule). The new
 * corpse holds COIN_LOSS_FRACTION of their wallet (capped). Idempotent
 * within the same tick — the caller protects against double-fire.
 *
 * Returns { ok, corpse?, coinsLost?, replacedLost?, reason? }.
 */
export function dropCorpseOnDeath(db, opts) {
  if (!db || !opts) return { ok: false, reason: "no_input" };
  const { userId, worldId, position, cause = "combat" } = opts;
  if (!userId || !worldId || !position) return { ok: false, reason: "missing_fields" };
  const x = Number(position.x);
  const y = Number(position.y ?? 0);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: "bad_position" };

  // Fetch wallet balance. Concord Coin balances live in
  // user_wallets.concord_coins; fall back gracefully if absent so this
  // still works on test deployments.
  let balance = 0;
  try {
    const w = db.prepare(`SELECT concord_coins FROM user_wallets WHERE user_id = ?`).get(userId);
    balance = Math.max(0, Number(w?.concord_coins ?? 0));
  } catch { /* no wallets — coins lost = 0 */ }

  const coinsLost = Math.min(
    COIN_LOSS_MAX,
    Math.floor(balance * COIN_LOSS_FRACTION),
  );

  // Mark prior active corpse for this player as lost.
  let replacedLost = 0;
  try {
    const r = db.prepare(`
      UPDATE player_corpses
         SET lost_at = unixepoch()
       WHERE user_id = ? AND world_id = ?
         AND recovered_at IS NULL AND lost_at IS NULL
    `).run(userId, worldId);
    replacedLost = r.changes;
  } catch { /* table missing on minimal builds */ }

  const id = `corpse_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO player_corpses
        (id, world_id, user_id, x, y, z, coins_held, cause)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, worldId, userId, x, y, z, coinsLost, cause);
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }

  // Debit the wallet (best-effort — economy invariants: never go
  // negative; never modify if balance lookup failed).
  if (coinsLost > 0) {
    try {
      db.prepare(`
        UPDATE user_wallets SET concord_coins = MAX(0, concord_coins - ?)
         WHERE user_id = ?
      `).run(coinsLost, userId);
    } catch { /* wallet write best-effort */ }
  }

  // Realtime fan-out — let the player's client mark the spot.
  try {
    const io = globalThis?.__CONCORD_REALTIME__?.io;
    io?.to(`world:${worldId}`).emit("player:corpse-dropped", {
      id, worldId, userId, x, y, z, coinsLost, cause,
    });
  } catch { /* emit best-effort */ }

  return {
    ok: true,
    corpse: { id, worldId, userId, x, y, z, coinsLost, cause, createdAt: Math.floor(Date.now() / 1000) },
    coinsLost,
    replacedLost,
  };
}

/** List active (not recovered, not lost) corpses for a player in a world. */
export function activeCorpsesFor(db, opts) {
  if (!db || !opts) return [];
  const { userId, worldId, limit = 10 } = opts;
  if (!userId || !worldId) return [];
  try {
    return db.prepare(`
      SELECT id, world_id, user_id, x, y, z, coins_held, cause, created_at
        FROM player_corpses
       WHERE user_id = ? AND world_id = ?
         AND recovered_at IS NULL AND lost_at IS NULL
       ORDER BY created_at DESC
       LIMIT ?
    `).all(userId, worldId, limit);
  } catch { return []; }
}

/**
 * Recover a corpse. Player must be within RECOVER_RADIUS_M of the
 * corpse position; lost / already-recovered corpses are rejected.
 * On success, credits coins back to the wallet and marks recovered_at.
 */
export function recoverCorpse(db, opts) {
  if (!db || !opts) return { ok: false, reason: "no_input" };
  const { userId, corpseId, position } = opts;
  if (!userId || !corpseId || !position) return { ok: false, reason: "missing_fields" };
  let row;
  try {
    row = db.prepare(`SELECT * FROM player_corpses WHERE id = ?`).get(corpseId);
  } catch { return { ok: false, reason: "no_table" }; }
  if (!row) return { ok: false, reason: "not_found" };
  if (row.user_id !== userId) return { ok: false, reason: "not_yours" };
  if (row.recovered_at) return { ok: false, reason: "already_recovered" };
  if (row.lost_at) return { ok: false, reason: "lost" };

  const px = Number(position.x);
  const pz = Number(position.z);
  if (!Number.isFinite(px) || !Number.isFinite(pz)) return { ok: false, reason: "bad_position" };
  const d = Math.hypot(Number(row.x) - px, Number(row.z) - pz);
  if (d > RECOVER_RADIUS_M) {
    return { ok: false, reason: "out_of_range", distance: d, required: RECOVER_RADIUS_M };
  }

  const coins = Number(row.coins_held) || 0;
  try {
    const tx = db.transaction(() => {
      db.prepare(`UPDATE player_corpses SET recovered_at = unixepoch() WHERE id = ?`).run(corpseId);
      if (coins > 0) {
        db.prepare(`
          INSERT INTO user_wallets (user_id, concord_coins)
          VALUES (?, ?)
          ON CONFLICT(user_id) DO UPDATE SET concord_coins = concord_coins + excluded.concord_coins
        `).run(userId, coins);
      }
    });
    tx();
  } catch (err) {
    return { ok: false, reason: "recover_failed", error: err?.message };
  }

  try {
    const io = globalThis?.__CONCORD_REALTIME__?.io;
    io?.to(`world:${row.world_id}`).emit("player:corpse-recovered", {
      corpseId, worldId: row.world_id, userId, coinsReturned: coins,
    });
  } catch { /* emit best-effort */ }

  return { ok: true, coinsReturned: coins };
}

/** Sweep: any corpse older than ACTIVE_TTL_S and still active becomes lost. */
export function sweepStaleCorpses(db) {
  if (!db) return 0;
  try {
    const r = db.prepare(`
      UPDATE player_corpses
         SET lost_at = unixepoch()
       WHERE recovered_at IS NULL AND lost_at IS NULL
         AND created_at < unixepoch() - ?
    `).run(ACTIVE_TTL_S);
    return r.changes;
  } catch { return 0; }
}
