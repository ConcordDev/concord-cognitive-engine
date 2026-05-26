// server/lib/bestiary.js
//
// Wave 2 / T1.2. Per-player creature discovery log. Mirrors the pattern
// from server/lib/secrets.js — recordSighting upserts a row, getDiscoveries
// returns the player's collection, getStats summarises kinds.

import crypto from "crypto";

const VALID_KINDS = new Set(["hybrid", "authored", "tamed", "bred"]);
const SIGHTING_DEBOUNCE_S = 60;  // re-sighting the same species within 60s
                                 // bumps `last_seen_at` but not the counter,
                                 // mirrors the heartbeat-friendly throttle
                                 // we use elsewhere.

/**
 * Record that `userId` saw / tamed / bred a creature. Idempotent on
 * (user_id, world_id, kind, species_ref). Subsequent calls bump
 * `sightings` (unless within the 60s debounce window) and
 * `last_seen_at`. Returns { ok, kind, sightings, firstSeenAt }.
 */
export function recordSighting(db, userId, { worldId, kind, speciesRef, meta = null } = {}) {
  if (!db || !userId || !worldId || !speciesRef) return { ok: false, reason: "invalid_args" };
  if (!VALID_KINDS.has(kind)) return { ok: false, reason: "invalid_kind" };

  try {
    const existing = db.prepare(`
      SELECT id, sightings, first_seen_at, last_seen_at
      FROM player_creature_discoveries
      WHERE user_id = ? AND world_id = ? AND kind = ? AND species_ref = ?
    `).get(userId, worldId, kind, speciesRef);

    const now = Math.floor(Date.now() / 1000);

    if (!existing) {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO player_creature_discoveries
          (id, user_id, world_id, kind, species_ref, first_seen_at, last_seen_at, sightings, meta_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(id, userId, worldId, kind, speciesRef, now, now, meta ? JSON.stringify(meta) : null);
      return { ok: true, kind, sightings: 1, firstSeenAt: now, isNew: true };
    }

    // Debounce: bump only if outside the 60s window.
    const withinDebounce = (now - existing.last_seen_at) < SIGHTING_DEBOUNCE_S;
    if (withinDebounce) {
      db.prepare(`UPDATE player_creature_discoveries SET last_seen_at = ? WHERE id = ?`)
        .run(now, existing.id);
      return { ok: true, kind, sightings: existing.sightings, firstSeenAt: existing.first_seen_at, isNew: false, debounced: true };
    }

    const newSightings = (existing.sightings ?? 0) + 1;
    db.prepare(`
      UPDATE player_creature_discoveries
      SET sightings = ?, last_seen_at = ?
      WHERE id = ?
    `).run(newSightings, now, existing.id);

    return { ok: true, kind, sightings: newSightings, firstSeenAt: existing.first_seen_at, isNew: false };
  } catch (err) {
    return { ok: false, reason: "db_error", message: err?.message };
  }
}

/**
 * Read the player's bestiary, optionally filtered by kind. Returns rows
 * in last_seen_at DESC order so the most-recent encounters surface first.
 */
export function getDiscoveries(db, userId, { worldId = null, kind = null, limit = 200 } = {}) {
  if (!db || !userId) return [];
  try {
    const clauses = ["user_id = ?"];
    const args = [userId];
    if (worldId) { clauses.push("world_id = ?"); args.push(worldId); }
    if (kind)    { clauses.push("kind = ?");     args.push(kind); }
    args.push(limit);
    const rows = db.prepare(`
      SELECT id, world_id, kind, species_ref, first_seen_at, last_seen_at,
             sightings, meta_json
      FROM player_creature_discoveries
      WHERE ${clauses.join(" AND ")}
      ORDER BY last_seen_at DESC
      LIMIT ?
    `).all(...args);
    return rows.map((r) => ({
      ...r,
      meta: r.meta_json ? _tryParseJSON(r.meta_json) : null,
    }));
  } catch {
    return [];
  }
}

/**
 * Aggregate counts per kind for a player. Used by the bestiary panel
 * header (e.g. "12 Discovered · 3 Tamed · 1 Bred").
 */
export function getStats(db, userId, { worldId = null } = {}) {
  if (!db || !userId) return { hybrid: 0, authored: 0, tamed: 0, bred: 0, total: 0 };
  try {
    const clauses = ["user_id = ?"];
    const args = [userId];
    if (worldId) { clauses.push("world_id = ?"); args.push(worldId); }
    const rows = db.prepare(`
      SELECT kind, COUNT(*) AS n
      FROM player_creature_discoveries
      WHERE ${clauses.join(" AND ")}
      GROUP BY kind
    `).all(...args);
    const out = { hybrid: 0, authored: 0, tamed: 0, bred: 0, total: 0 };
    for (const r of rows) {
      if (r.kind in out) out[r.kind] = r.n;
      out.total += r.n;
    }
    return out;
  } catch {
    return { hybrid: 0, authored: 0, tamed: 0, bred: 0, total: 0 };
  }
}

function _tryParseJSON(s) {
  try { return JSON.parse(s); } catch { return null; }
}
