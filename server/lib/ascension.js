// server/lib/ascension.js
//
// D30 — endgame paragon/ascension. Once a skill caps (level 100), the XP that
// was previously discarded feeds an account-wide ascension track. Each
// ascension level grants 1 point; points buy small permanent bonuses across a
// long-tail node set — a reason to keep playing at day 30. Bonuses fold into
// combat (like talents/affixes/sets) and other systems read the utility nodes.
//
// Deliberately flat (no prereqs) + long-tail (high maxRanks, tiny per-rank) so
// it never trivialises and always gives "one more level" pull.

const ASCENSION_XP_PER_LEVEL = 500; // overflow XP per ascension level

export const ASCENSION_NODES = Object.freeze({
  paragon_might:   { id: "paragon_might",   name: "Paragon: Might",   maxRank: 50, perRank: { stat: "meleeDamagePct", value: 0.004 } },   // → +20% at 50
  paragon_arcane:  { id: "paragon_arcane",  name: "Paragon: Arcane",  maxRank: 50, perRank: { stat: "allElementPct", value: 0.004 } },   // → +20% all elements
  paragon_vigor:   { id: "paragon_vigor",   name: "Paragon: Vigor",   maxRank: 50, perRank: { stat: "vitalityFlat", value: 5 } },          // → +250 max-HP
  paragon_fortune: { id: "paragon_fortune", name: "Paragon: Fortune", maxRank: 50, perRank: { stat: "xpGainPct", value: 0.005 } },         // → +25% xp gain
  paragon_harvest: { id: "paragon_harvest", name: "Paragon: Harvest", maxRank: 50, perRank: { stat: "gatherYieldPct", value: 0.006 } },    // → +30% gather
});

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name); }
  catch { return false; }
}
function ensureRow(db, userId) {
  db.prepare(`INSERT INTO player_ascension (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING`).run(userId);
}

/**
 * Feed overflow XP into the ascension track. Returns { leveled, levelsGained,
 * level, pointsAwarded }. Called from the skill-cap overflow site.
 */
export function gainAscensionXp(db, userId, xpGain) {
  if (!db || !userId || !tableExists(db, "player_ascension")) return { ok: false };
  const amt = Math.max(0, Math.floor(Number(xpGain) || 0));
  if (amt <= 0) return { ok: true, leveled: false, levelsGained: 0 };
  ensureRow(db, userId);
  const row = db.prepare(`SELECT level, xp FROM player_ascension WHERE user_id = ?`).get(userId);
  let level = row.level || 0;
  let xp = (row.xp || 0) + amt;
  let levelsGained = 0;
  while (xp >= ASCENSION_XP_PER_LEVEL) {
    xp -= ASCENSION_XP_PER_LEVEL;
    level += 1;
    levelsGained += 1;
  }
  db.prepare(`
    UPDATE player_ascension
    SET level = ?, xp = ?, points_available = points_available + ?, points_earned = points_earned + ?, updated_at = unixepoch()
    WHERE user_id = ?
  `).run(level, xp, levelsGained, levelsGained, userId);
  return { ok: true, leveled: levelsGained > 0, levelsGained, level, pointsAwarded: levelsGained };
}

export function getAscension(db, userId) {
  const empty = { level: 0, xp: 0, xpPerLevel: ASCENSION_XP_PER_LEVEL, available: 0, earned: 0, spent: 0, allocations: {}, nodes: ASCENSION_NODES };
  if (!db || !userId || !tableExists(db, "player_ascension")) return empty;
  ensureRow(db, userId);
  const p = db.prepare(`SELECT level, xp, points_available, points_earned, points_spent FROM player_ascension WHERE user_id = ?`).get(userId) || {};
  const rows = db.prepare(`SELECT node_id, rank FROM player_ascension_allocations WHERE user_id = ? AND rank > 0`).all(userId);
  const allocations = {};
  for (const r of rows) allocations[r.node_id] = r.rank;
  return {
    level: p.level || 0, xp: p.xp || 0, xpPerLevel: ASCENSION_XP_PER_LEVEL,
    available: p.points_available || 0, earned: p.points_earned || 0, spent: p.points_spent || 0,
    allocations, nodes: ASCENSION_NODES,
  };
}

export function spendAscensionPoint(db, userId, nodeId) {
  if (!db || !userId || !nodeId || !tableExists(db, "player_ascension")) return { ok: false, reason: "unavailable" };
  const node = ASCENSION_NODES[nodeId];
  if (!node) return { ok: false, reason: "unknown_node" };
  ensureRow(db, userId);
  const p = db.prepare(`SELECT points_available FROM player_ascension WHERE user_id = ?`).get(userId);
  if (!p || p.points_available <= 0) return { ok: false, reason: "no_points" };
  const cur = db.prepare(`SELECT rank FROM player_ascension_allocations WHERE user_id = ? AND node_id = ?`).get(userId, nodeId);
  const rank = cur?.rank || 0;
  if (rank >= node.maxRank) return { ok: false, reason: "max_rank" };
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO player_ascension_allocations (user_id, node_id, rank) VALUES (?, ?, 1)
      ON CONFLICT(user_id, node_id) DO UPDATE SET rank = rank + 1, updated_at = unixepoch()
    `).run(userId, nodeId);
    db.prepare(`
      UPDATE player_ascension SET points_available = points_available - 1, points_spent = points_spent + 1, updated_at = unixepoch()
      WHERE user_id = ?
    `).run(userId);
  });
  tx();
  return { ok: true, nodeId, newRank: rank + 1, remaining: p.points_available - 1 };
}

/** Account-wide bonuses from allocated ascension nodes. */
export function ascensionBonuses(db, userId) {
  const out = { meleeDamagePct: 0, allElementPct: 0, vitalityFlat: 0, xpGainPct: 0, gatherYieldPct: 0 };
  if (!db || !userId || !tableExists(db, "player_ascension_allocations")) return out;
  let rows = [];
  try { rows = db.prepare(`SELECT node_id, rank FROM player_ascension_allocations WHERE user_id = ? AND rank > 0`).all(userId); }
  catch { return out; }
  for (const { node_id, rank } of rows) {
    const node = ASCENSION_NODES[node_id];
    if (!node?.perRank) continue;
    const { stat, value } = node.perRank;
    if (stat in out) out[stat] += value * rank;
  }
  out.meleeDamagePct = Math.round(out.meleeDamagePct * 1000) / 1000;
  out.allElementPct = Math.round(out.allElementPct * 1000) / 1000;
  return out;
}

/** Combat damage multiplier from ascension (melee + all-element apply to any cast). */
export function ascensionDamageMultiplier(db, userId, element = "none") {
  const b = ascensionBonuses(db, userId);
  const elemPart = element && element !== "none" ? b.allElementPct : 0;
  return Math.round((1 + b.meleeDamagePct + elemPart) * 1000) / 1000;
}

export { ASCENSION_XP_PER_LEVEL };
