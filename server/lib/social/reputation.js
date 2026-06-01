// server/lib/social/reputation.js
//
// Slice-of-Life SL3 — public/district reputation. Standing per scope is DERIVED
// from the existing consequence stream: the average of the scope's NPCs'
// opinions of the player, minus the weight of their open grudges. So every
// daily-life verb (SL1), gossip hit (SL2), or betrayal already feeds it — no new
// write path. Read by dialogue + soft-gating (the BG3 guardrail). Behind
// CONCORD_REPUTATION. Pure DB; recompute is cheap + idempotent.

export const GRUDGE_WEIGHT = 1.5;       // each open-grudge severity point off the average
export const REPUTATION_FLOOR = -100;
export const REPUTATION_CEIL = 100;

const SCOPE_COL = { faction: "faction", world: "world_id", district: "home_district" };

export function reputationEnabled() { return process.env.CONCORD_REPUTATION !== "0"; }

/**
 * Recompute + persist a player's standing in a scope. standing =
 * avg(NPC opinion of player) − GRUDGE_WEIGHT·Σ(open grudge severity), over the
 * NPCs in that scope; clamped to [-100, 100]. Returns { standing, sampleCount }.
 */
export function recomputeReputation(db, userId, scopeKind, scopeId) {
  if (!db || !userId || !scopeId) return { ok: false, reason: "missing_inputs" };
  const col = SCOPE_COL[scopeKind];
  if (!col) return { ok: false, reason: "bad_scope" };
  let avg = 0, n = 0, sev = 0;
  try {
    const op = db.prepare(`
      SELECT AVG(o.score) AS avg, COUNT(*) AS n
      FROM character_opinions o JOIN world_npcs nn ON nn.id = o.npc_id
      WHERE o.target_kind='player' AND o.target_id=? AND nn.${col}=?
    `).get(String(userId), String(scopeId));
    avg = Number(op?.avg) || 0; n = Number(op?.n) || 0;
    const gr = db.prepare(`
      SELECT COALESCE(SUM(g.severity),0) AS sev
      FROM npc_grudges g JOIN world_npcs nn ON nn.id = g.npc_id
      WHERE g.target_kind='player' AND g.target_id=? AND nn.${col}=?
    `).get(String(userId), String(scopeId));
    sev = Number(gr?.sev) || 0;
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
  const standing = Math.max(REPUTATION_FLOOR, Math.min(REPUTATION_CEIL, avg - GRUDGE_WEIGHT * sev));
  db.prepare(`
    INSERT INTO player_reputation (user_id, scope_kind, scope_id, standing, sample_count, updated_at)
    VALUES (?,?,?,?,?, unixepoch())
    ON CONFLICT(user_id, scope_kind, scope_id) DO UPDATE SET standing=excluded.standing, sample_count=excluded.sample_count, updated_at=unixepoch()
  `).run(String(userId), scopeKind, String(scopeId), standing, n);
  return { ok: true, standing, sampleCount: n };
}

/** Read a player's cached standing in a scope (0 if never computed). */
export function getReputation(db, userId, scopeKind, scopeId) {
  const r = db.prepare(`SELECT standing, sample_count FROM player_reputation WHERE user_id=? AND scope_kind=? AND scope_id=?`)
    .get(String(userId), scopeKind, String(scopeId));
  return r ? { standing: r.standing, sampleCount: r.sample_count } : { standing: 0, sampleCount: 0 };
}

/** Soft gate: is the player's standing in a scope at/above a threshold (vendor pricing, quest access)? */
export function reputationGate(db, userId, scopeKind, scopeId, threshold) {
  return getReputation(db, userId, scopeKind, scopeId).standing >= Number(threshold);
}
