// server/lib/faction-reputation.js
//
// Phase U4 — aggregate per-faction reputation derived from
// character_opinions (migration 153, per-NPC) into a player-facing
// faction-tier system.
//
// Tier mapping (score scale −100..+100):
//   -100..-50   hated
//   -49..-15    hostile
//   -14..+14    neutral
//   +15..+39    friendly
//   +40..+74    honored
//   +75..+100   exalted

import logger from "../logger.js";

const TIER_THRESHOLDS = [
  { tier: "hated",    min: -100, max: -50 },
  { tier: "hostile",  min: -49,  max: -15 },
  { tier: "neutral",  min: -14,  max: 14 },
  { tier: "friendly", min: 15,   max: 39 },
  { tier: "honored",  min: 40,   max: 74 },
  { tier: "exalted",  min: 75,   max: 100 },
];

const TIER_NUMERIC = {
  hated: 0, hostile: 1, neutral: 2, friendly: 3, honored: 4, exalted: 5,
};

export function scoreToTier(score) {
  const n = Math.max(-100, Math.min(100, Number(score) || 0));
  for (const t of TIER_THRESHOLDS) {
    if (n >= t.min && n <= t.max) return t.tier;
  }
  return "neutral";
}

export function tierToNumeric(tier) {
  return TIER_NUMERIC[tier] ?? 2;
}

/**
 * Compute fresh reputation by aggregating character_opinions on the fly.
 * Used by the heartbeat refresher + direct lookups when cache is stale.
 *
 * Aggregation: average of all character_opinions rows where the NPC's
 * faction matches and target = the player. NPCs without a known faction
 * are excluded.
 */
export function computeFactionReputation(db, userId, factionId, worldId) {
  if (!db || !userId || !factionId) return { score: 0, tier: "neutral", opinionCount: 0 };
  try {
    const row = db.prepare(`
      SELECT AVG(co.score) AS avgScore, COUNT(*) AS n
      FROM character_opinions co
      LEFT JOIN world_npcs n ON n.id = co.npc_id
      WHERE co.target_kind = 'player'
        AND co.target_id = ?
        AND COALESCE(n.faction, '') = ?
        AND (? IS NULL OR n.world_id = ?)
    `).get(userId, factionId, worldId || null, worldId || null);
    const score = Number(row?.avgScore) || 0;
    const opinionCount = Number(row?.n) || 0;
    return { score, tier: scoreToTier(score), opinionCount };
  } catch (err) {
    logger.debug?.("faction-reputation", "compute_failed", { error: err?.message });
    return { score: 0, tier: "neutral", opinionCount: 0 };
  }
}

/**
 * Lookup via the cache. Falls back to computeFactionReputation if no
 * cache entry exists yet.
 */
export function getFactionReputation(db, userId, factionId, worldId) {
  if (!db || !userId || !factionId) return { score: 0, tier: "neutral", opinionCount: 0 };
  try {
    const row = db.prepare(`
      SELECT score, tier, opinion_count AS opinionCount, updated_at AS updatedAt
      FROM player_faction_reputation_cache
      WHERE user_id = ? AND faction_id = ? AND world_id = ?
    `).get(userId, factionId, worldId || "concordia-hub");
    if (row) return row;
  } catch { /* cache table may not exist */ }
  return computeFactionReputation(db, userId, factionId, worldId);
}

/** Returns the full matrix — every faction the player has any opinion in. */
export function getAllReputations(db, userId, worldId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT faction_id AS factionId, world_id AS worldId, score, tier,
             opinion_count AS opinionCount, updated_at AS updatedAt
      FROM player_faction_reputation_cache
      WHERE user_id = ? AND (? IS NULL OR world_id = ?)
      ORDER BY score DESC
    `).all(userId, worldId || null, worldId || null);
  } catch {
    return [];
  }
}

/**
 * Refresh cache. Called by the faction-rep-cache-refresh heartbeat
 * (frequency 60 = ~15min). Recomputes every (user, world, faction)
 * tuple that has any character_opinions entry.
 */
export function refreshFactionReputationCache(db, opts = {}) {
  if (!db) return { refreshed: 0 };
  const limit = Math.min(Math.max(1, opts.limit || 500), 5000);
  let refreshed = 0;
  try {
    // Discover (user, world, faction) tuples that need recompute.
    const tuples = db.prepare(`
      SELECT DISTINCT co.target_id AS userId, n.world_id AS worldId, n.faction AS factionId
      FROM character_opinions co
      JOIN world_npcs n ON n.id = co.npc_id
      WHERE co.target_kind = 'player'
        AND n.faction IS NOT NULL
        AND n.faction != ''
      LIMIT ?
    `).all(limit);
    for (const t of tuples) {
      const r = computeFactionReputation(db, t.userId, t.factionId, t.worldId);
      try {
        db.prepare(`
          INSERT INTO player_faction_reputation_cache
            (user_id, world_id, faction_id, score, tier, opinion_count, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, unixepoch())
          ON CONFLICT(user_id, world_id, faction_id) DO UPDATE SET
            score = excluded.score,
            tier = excluded.tier,
            opinion_count = excluded.opinion_count,
            updated_at = excluded.updated_at
        `).run(t.userId, t.worldId, t.factionId, r.score, r.tier, r.opinionCount);
        refreshed++;
      } catch { /* per-row error tolerated */ }
    }
  } catch (err) {
    logger.warn?.("faction-reputation", "refresh_failed", { error: err?.message });
  }
  return { refreshed };
}

/**
 * Reputation gate — returns true if user's tier ≥ requiredTier.
 * Used by dialogue branch gates and loops.json#factionGates.
 */
export function hasReputationTier(db, userId, factionId, worldId, requiredTier) {
  const rep = getFactionReputation(db, userId, factionId, worldId);
  return tierToNumeric(rep.tier) >= tierToNumeric(requiredTier);
}
