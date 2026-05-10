// server/lib/npc-opinions.js
//
// Sprint C / Track A2 — per-character signed opinion (-100..+100) with
// discrete kind labels and family/ally cascade.
//
// `npc_grudges` is for hostile-only feelings; opinions are symmetric and
// cover the full friend/foe spectrum. Both tables coexist:
//   - grudges remain the authoritative "lasting wound" record (used by
//     dialogue prompts via narrative-bridge#composeAsymmetryContext)
//   - opinions are the day-to-day rapport that responds to many small
//     events (combat near, faction quest completion, trades, decrees,
//     scheme exposure, decree popularity)
//
// Track D (kingdoms) reads loyalty by querying opinions where
// target_kind='kingdom' OR target_kind='npc' AND target_id is the ruler.

import logger from "../logger.js";

const SCORE_CLAMP = (v) => Math.max(-100, Math.min(100, Math.round(v)));

const KIND_FROM_SCORE = (score) => {
  if (score >=  70) return "admires";
  if (score >=  30) return "likes";
  if (score >=  10) return "respects";
  if (score >  -10) return "neutral";
  if (score >  -30) return "wary";
  if (score >  -50) return "envies";
  if (score >  -75) return "fears";
  return "hates";
};

function ensureRow(db, npcId, targetKind, targetId) {
  db.prepare(`
    INSERT INTO character_opinions (npc_id, target_kind, target_id, score, kind)
    VALUES (?, ?, ?, 0, 'neutral')
    ON CONFLICT(npc_id, target_kind, target_id) DO NOTHING
  `).run(npcId, targetKind, targetId);
}

/**
 * Apply a delta to an opinion row. Inserts at 0/neutral first if missing.
 * Recomputes kind from score after applying.
 */
export function recordOpinionEvent(db, { npcId, targetKind, targetId }, delta, reason = null) {
  if (!db || !npcId || !targetKind || !targetId) return { ok: false, reason: "missing_inputs" };
  if (!Number.isFinite(delta) || delta === 0) return { ok: true, action: "noop" };
  ensureRow(db, npcId, targetKind, targetId);
  const before = db.prepare(`
    SELECT score FROM character_opinions WHERE npc_id = ? AND target_kind = ? AND target_id = ?
  `).get(npcId, targetKind, targetId);
  const next = SCORE_CLAMP((before?.score ?? 0) + delta);
  const kind = KIND_FROM_SCORE(next);
  db.prepare(`
    UPDATE character_opinions
    SET score = ?, kind = ?, top_reason = COALESCE(?, top_reason), last_event_at = unixepoch(), updated_at = unixepoch()
    WHERE npc_id = ? AND target_kind = ? AND target_id = ?
  `).run(next, kind, reason ? String(reason).slice(0, 120) : null, npcId, targetKind, targetId);
  return { ok: true, action: "updated", score: next, kind, delta };
}

export function getOpinion(db, npcId, targetKind, targetId) {
  if (!db || !npcId || !targetKind || !targetId) return null;
  return db.prepare(`
    SELECT npc_id, target_kind, target_id, score, kind, top_reason, last_event_at
    FROM character_opinions WHERE npc_id = ? AND target_kind = ? AND target_id = ?
  `).get(npcId, targetKind, targetId) || null;
}

/**
 * Cascade an opinion delta to the deceased NPC's heirs (50%) and same-faction
 * NPCs (25%). Used by combat path on NPC kill: the player gets -40 with the
 * direct kin and -10 ripple across the faction.
 *
 * Heirs come from npc_inheritance_links (migration 133) — best-effort: if
 * the table is missing, only the faction cascade runs.
 */
export function cascadeFamilyAndAlly(db, deceasedNpcId, targetKind, targetId, baseDelta, reason) {
  if (!db || !deceasedNpcId || !baseDelta) return { heirs: 0, faction: 0 };

  let heirs = 0;
  try {
    const heirRows = db.prepare(`
      SELECT heir_npc_id FROM npc_inheritance_links WHERE deceased_npc_id = ?
    `).all(deceasedNpcId);
    const heirDelta = Math.round(baseDelta * 0.5);
    for (const h of heirRows) {
      if (!h.heir_npc_id) continue;
      recordOpinionEvent(db, { npcId: h.heir_npc_id, targetKind, targetId }, heirDelta, reason);
      heirs++;
    }
  } catch { /* npc_inheritance_links absent on minimal builds */ }

  let factionTouched = 0;
  try {
    // Resolve deceased's faction from world_npcs (best-effort); cascade to
    // siblings excluding the deceased.
    const dec = db.prepare(`SELECT faction FROM world_npcs WHERE id = ?`).get(deceasedNpcId);
    if (dec?.faction) {
      const sibs = db.prepare(`
        SELECT id FROM world_npcs WHERE faction = ? AND id != ? AND COALESCE(is_dead, 0) = 0
        LIMIT 50
      `).all(dec.faction, deceasedNpcId);
      const sibDelta = Math.round(baseDelta * 0.25);
      for (const s of sibs) {
        recordOpinionEvent(db, { npcId: s.id, targetKind, targetId }, sibDelta, reason);
        factionTouched++;
      }
    }
  } catch { /* world_npcs absent on minimal builds */ }

  return { heirs, faction: factionTouched };
}

/**
 * Daily decay sweep — runs from npc-routine-cycle. Drifts every opinion
 * toward 0/neutral by its row-specific decay_per_day, but only when
 * last_event_at < now-24h (so churning rapid-fire events don't get
 * decayed away mid-event).
 */
export function decayOpinions(db) {
  if (!db) return { ok: false };
  const r = db.prepare(`
    UPDATE character_opinions
    SET
      score = CASE
        WHEN score > 0 AND last_event_at < (unixepoch() - 86400) THEN MAX(0, score - decay_per_day)
        WHEN score < 0 AND last_event_at < (unixepoch() - 86400) THEN MIN(0, score + decay_per_day)
        ELSE score
      END,
      kind = CASE
        WHEN score > 0 AND last_event_at < (unixepoch() - 86400) THEN
          CASE
            WHEN MAX(0, score - decay_per_day) >= 70 THEN 'admires'
            WHEN MAX(0, score - decay_per_day) >= 30 THEN 'likes'
            WHEN MAX(0, score - decay_per_day) >= 10 THEN 'respects'
            ELSE 'neutral'
          END
        WHEN score < 0 AND last_event_at < (unixepoch() - 86400) THEN
          CASE
            WHEN MIN(0, score + decay_per_day) <= -75 THEN 'fears'
            WHEN MIN(0, score + decay_per_day) <= -50 THEN 'envies'
            WHEN MIN(0, score + decay_per_day) <= -30 THEN 'wary'
            ELSE 'neutral'
          END
        ELSE kind
      END,
      updated_at = unixepoch()
    WHERE last_event_at < (unixepoch() - 86400)
  `).run();
  return { ok: true, touched: r.changes };
}

/**
 * Helper for narrative-bridge: get the freshest opinion of `userId` from
 * `npcId`. Returns null if no row exists. Compose pipeline calls this
 * for the dialogue prompt.
 */
export function opinionOfPlayer(db, npcId, userId) {
  return getOpinion(db, npcId, "player", userId);
}

/**
 * Aggregate citizen opinion for a kingdom — used by Track D2 to compute
 * average loyalty when issuing decrees. Returns { avg, count, low, high }.
 */
export function aggregateOpinionsToTarget(db, targetKind, targetId) {
  if (!db) return { avg: 0, count: 0, low: 0, high: 0 };
  try {
    const r = db.prepare(`
      SELECT AVG(score) AS avg, COUNT(*) AS count, MIN(score) AS low, MAX(score) AS high
      FROM character_opinions WHERE target_kind = ? AND target_id = ?
    `).get(targetKind, targetId);
    return {
      avg: Math.round(r?.avg ?? 0),
      count: r?.count ?? 0,
      low: r?.low ?? 0,
      high: r?.high ?? 0,
    };
  } catch { return { avg: 0, count: 0, low: 0, high: 0 }; }
}

export const OPINION_CONSTANTS = Object.freeze({ KIND_FROM_SCORE });
