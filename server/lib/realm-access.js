// server/lib/realm-access.js
//
// Concordia Phase 4 — opinion-driven realm access.
//
// A realm has a ruling faction (realms.faction_id). Its guards are
// NPCs in that faction with archetype='guard' (or 'warden'). When a
// player approaches the realm border:
//   - If the aggregate guard opinion of the player is below -50,
//     entry is refused (greeting, market access, scheme recruitment).
//   - If the aggregate is below -80 OR a realm_exiles row exists,
//     they're treated as exiled — position updates inside the realm's
//     bounds are blocked.
//
// We compute the aggregate as a simple mean of character_opinions
// rows. If no guards exist for the realm, the aggregate defaults to
// 0 (neutral — pre-Phase-4 access unchanged).
//
// `canEnterRealm(db, userId, realmId)` is the single entry point. It
// returns { ok, action, aggregate, exiled, expires_at? } where action
// is one of 'welcome' | 'suspicious' | 'refused' | 'exiled'.
//
// Position-update guard: callers (the cityPresence socket handler in
// server.js + /cityPresence route) call `assertCanMoveTo(db, userId,
// worldId, { x, z })` which walks realm_territories → regions to find
// which realm the position is in, then checks realm_exiles. If exiled,
// the move is refused. Position-update guard is best-effort: missing
// territory data falls through to allow.

import logger from "../logger.js";

const REFUSED_AGGREGATE  = -50;
const EXILED_AGGREGATE   = -80;
const DEFAULT_EXILE_DAYS = 30;

const GUARD_ARCHETYPES = ["guard", "warden", "captain"];

/**
 * Compute aggregate guard opinion of the player for a given realm.
 * Returns 0 when there are no guards (graceful default to neutral).
 */
export function aggregateGuardOpinion(db, userId, realmId) {
  if (!db || !userId || !realmId) return 0;
  try {
    const realm = db.prepare(`SELECT faction_id FROM realms WHERE id = ?`).get(realmId);
    if (!realm?.faction_id) return 0;
    const placeholders = GUARD_ARCHETYPES.map(() => "?").join(",");
    const row = db.prepare(`
      SELECT AVG(co.score) AS avg_score, COUNT(*) AS n
      FROM character_opinions co
      JOIN world_npcs wn ON wn.id = co.npc_id
      WHERE wn.faction = ?
        AND wn.archetype IN (${placeholders})
        AND co.target_kind = 'player' AND co.target_id = ?
        AND COALESCE(wn.is_dead, 0) = 0
    `).get(realm.faction_id, ...GUARD_ARCHETYPES, userId);
    if (!row || !row.n) return 0;
    return Math.round(Number(row.avg_score) || 0);
  } catch {
    return 0;
  }
}

/**
 * Read the active exile row for (realm_id, user_id), or null. An
 * expired or pardoned row counts as null. Renews are caller's job.
 */
export function activeExile(db, realmId, userId) {
  if (!db || !realmId || !userId) return null;
  try {
    const row = db.prepare(`
      SELECT realm_id, user_id, reason, exiled_at, expires_at, pardoned_at
      FROM realm_exiles
      WHERE realm_id = ? AND user_id = ?
    `).get(realmId, userId);
    if (!row) return null;
    if (row.pardoned_at) return null;
    if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) return null;
    return row;
  } catch {
    return null;
  }
}

/**
 * Insert/upsert an exile. Used by access checks when the aggregate
 * opinion drops below EXILED_AGGREGATE. Idempotent on (realm_id,
 * user_id) — replaces previous exile reason/dates.
 */
export function recordExile(db, realmId, userId, { reason = "opinion_below_threshold", expiresInDays = DEFAULT_EXILE_DAYS } = {}) {
  if (!db || !realmId || !userId) return { ok: false, reason: "missing_inputs" };
  const expiresAt = expiresInDays ? Math.floor(Date.now() / 1000) + expiresInDays * 86400 : null;
  try {
    db.prepare(`
      INSERT INTO realm_exiles (realm_id, user_id, reason, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(realm_id, user_id) DO UPDATE
        SET reason = excluded.reason,
            expires_at = excluded.expires_at,
            pardoned_at = NULL,
            pardoned_by = NULL,
            exiled_at = unixepoch()
    `).run(realmId, userId, reason, expiresAt);
    return { ok: true, action: "exiled", realmId, userId, expiresAt };
  } catch (err) {
    try { logger.warn?.("realm_exile_failed", { realmId, userId, error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "insert_failed" };
  }
}

/** Pardon a user (clears active exile). */
export function pardonExile(db, realmId, userId, pardonedBy = null) {
  if (!db || !realmId || !userId) return { ok: false, reason: "missing_inputs" };
  try {
    const r = db.prepare(`
      UPDATE realm_exiles
      SET pardoned_at = unixepoch(), pardoned_by = ?
      WHERE realm_id = ? AND user_id = ? AND pardoned_at IS NULL
    `).run(pardonedBy || "system", realmId, userId);
    return { ok: true, changed: r.changes };
  } catch {
    return { ok: false, reason: "update_failed" };
  }
}

/**
 * Main entry point. Returns one of four `action` values:
 *   'welcome'    aggregate ≥ 0     — full access
 *   'neutral'    -50 < agg < 0     — entry allowed, suspicion in dialogue
 *   'suspicious' -80 < agg ≤ -50   — refused entry but not exiled
 *   'refused'    not (yet) exiled but below threshold
 *   'exiled'     active exile row present
 */
export function canEnterRealm(db, userId, realmId) {
  if (!db || !userId || !realmId) return { ok: false, reason: "missing_inputs" };
  const exile = activeExile(db, realmId, userId);
  if (exile) {
    return { ok: true, action: "exiled", aggregate: null, exiled: true, expires_at: exile.expires_at };
  }
  const agg = aggregateGuardOpinion(db, userId, realmId);
  if (agg <= EXILED_AGGREGATE) {
    // Auto-promote a deep-negative aggregate into an exile row so
    // subsequent reads cheap-out + the player can be pardoned.
    recordExile(db, realmId, userId, { reason: "aggregate_collapse" });
    return { ok: true, action: "exiled", aggregate: agg, exiled: true };
  }
  if (agg <= REFUSED_AGGREGATE) {
    return { ok: true, action: "suspicious", aggregate: agg, exiled: false };
  }
  if (agg < 0) {
    return { ok: true, action: "neutral", aggregate: agg, exiled: false };
  }
  return { ok: true, action: "welcome", aggregate: agg, exiled: false };
}

/**
 * Find which realm contains a (worldId, x, z) point by checking the
 * realm_territories → regions join. Returns realmId or null.
 *
 * This depends on `regions` (the world subdivision table). On a
 * minimal build without that table, the function returns null and
 * callers fall through to allow.
 */
export function findRealmAt(db, worldId, x, z) {
  if (!db || !worldId || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  try {
    // Resolve via procgen_regions if present (Phase 5e). Otherwise fall
    // through to null. We could chain in authored territories from a
    // future world-region table; for Phase 4 the region check is
    // best-effort.
    const r = db.prepare(`
      SELECT pr.id AS region_id, kt.kingdom_id AS realm_id
      FROM procgen_regions pr
      JOIN realm_territories kt ON kt.region_id = pr.id
      WHERE pr.world_id = ?
        AND ? BETWEEN pr.anchor_x - pr.radius_m AND pr.anchor_x + pr.radius_m
        AND ? BETWEEN pr.anchor_z - pr.radius_m AND pr.anchor_z + pr.radius_m
      LIMIT 1
    `).get(worldId, x, z);
    return r?.realm_id || null;
  } catch {
    return null;
  }
}

/**
 * Position-update gate. Returns { ok: true } if movement is allowed,
 * { ok: false, reason: 'exiled', realmId } if the position falls
 * inside a realm where the user is exiled. Missing-territory data
 * falls through to allow.
 */
export function assertCanMoveTo(db, userId, worldId, position) {
  if (!db || !userId || !worldId || !position) return { ok: true, allowed: true };
  const realmId = findRealmAt(db, worldId, position.x, position.z);
  if (!realmId) return { ok: true, allowed: true, realmId: null };
  const exile = activeExile(db, realmId, userId);
  if (exile) return { ok: false, reason: "exiled", realmId, expires_at: exile.expires_at };
  return { ok: true, allowed: true, realmId };
}

/** List a user's active exiles across all realms. */
export function listExilesForUser(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT realm_id, reason, exiled_at, expires_at
      FROM realm_exiles
      WHERE user_id = ? AND pardoned_at IS NULL
        AND (expires_at IS NULL OR expires_at > unixepoch())
      ORDER BY exiled_at DESC LIMIT 50
    `).all(userId);
  } catch {
    return [];
  }
}

export const REALM_ACCESS_CONSTANTS = Object.freeze({
  REFUSED_AGGREGATE,
  EXILED_AGGREGATE,
  DEFAULT_EXILE_DAYS,
  GUARD_ARCHETYPES,
});
