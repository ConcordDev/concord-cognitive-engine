// server/lib/talents.js
//
// F2.3 — player talent tree. Real combat/utility nodes with gameplay effects
// the combat path reads (mirrors the affix-aggregation pattern). Players earn 1
// point per level and spend into ranked nodes gated by prerequisites.
//
// Effects are real numbers, not flavor:
//   meleeDamagePct / elementDamagePct → multiply finalDamage by element class
//   flatPower      → flat enchantment-style add
//   resistPct      → damage taken reduction (defender-side, future-read)
//   staminaRegenPct / vitalityFlat    → bars/character path
// Each node: { id, name, branch, maxRank, requires?, perRank:{stat, value, element?} }.

export const TALENT_TREE = Object.freeze({
  // ── Might branch (melee/physical) ──────────────────────────────────────
  bladework:   { id: "bladework",   name: "Bladework",     branch: "might",  maxRank: 3, perRank: { stat: "meleeDamagePct", value: 0.04 } },
  heavy_hands: { id: "heavy_hands", name: "Heavy Hands",   branch: "might",  maxRank: 2, requires: { bladework: 2 }, perRank: { stat: "flatPower", value: 3 } },
  executioner: { id: "executioner", name: "Executioner",   branch: "might",  maxRank: 1, requires: { heavy_hands: 2 }, perRank: { stat: "meleeDamagePct", value: 0.08 } },
  // ── Arcane branch (elemental) ──────────────────────────────────────────
  fire_focus:  { id: "fire_focus",  name: "Fire Focus",    branch: "arcane", maxRank: 3, perRank: { stat: "elementDamagePct", value: 0.05, element: "fire" } },
  frost_focus: { id: "frost_focus", name: "Frost Focus",   branch: "arcane", maxRank: 3, perRank: { stat: "elementDamagePct", value: 0.05, element: "ice" } },
  storm_focus: { id: "storm_focus", name: "Storm Focus",   branch: "arcane", maxRank: 3, perRank: { stat: "elementDamagePct", value: 0.05, element: "lightning" } },
  arcane_mastery: { id: "arcane_mastery", name: "Arcane Mastery", branch: "arcane", maxRank: 1, requires: { fire_focus: 3 }, perRank: { stat: "flatPower", value: 6 } },
  // ── Fortitude branch (survival) ────────────────────────────────────────
  ironhide:    { id: "ironhide",    name: "Ironhide",      branch: "fortitude", maxRank: 3, perRank: { stat: "resistPct", value: 0.03 } },
  vigor:       { id: "vigor",       name: "Vigor",         branch: "fortitude", maxRank: 3, perRank: { stat: "vitalityFlat", value: 15 } },
  second_wind: { id: "second_wind", name: "Second Wind",   branch: "fortitude", maxRank: 2, requires: { vigor: 2 }, perRank: { stat: "staminaRegenPct", value: 0.1 } },
});

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name); }
  catch { return false; }
}

function ensurePointsRow(db, userId) {
  db.prepare(`INSERT INTO player_talent_points (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING`).run(userId);
}

/** Award talent points (called from the level-up hook). */
export function grantTalentPoints(db, userId, n = 1) {
  if (!db || !userId || !tableExists(db, "player_talent_points")) return { ok: false };
  const amt = Math.max(0, Math.floor(Number(n) || 0));
  if (amt <= 0) return { ok: true, granted: 0 };
  ensurePointsRow(db, userId);
  db.prepare(`
    UPDATE player_talent_points
    SET available = available + ?, earned = earned + ?, updated_at = unixepoch()
    WHERE user_id = ?
  `).run(amt, amt, userId);
  return { ok: true, granted: amt };
}

/** Full talent state for a user: points + allocations + the tree. */
export function getTalents(db, userId) {
  const empty = { available: 0, earned: 0, spent: 0, allocations: {}, tree: TALENT_TREE };
  if (!db || !userId || !tableExists(db, "player_talent_points")) return empty;
  ensurePointsRow(db, userId);
  const pts = db.prepare(`SELECT available, earned, spent FROM player_talent_points WHERE user_id = ?`).get(userId) || {};
  const rows = db.prepare(`SELECT talent_id, rank FROM player_talent_allocations WHERE user_id = ? AND rank > 0`).all(userId);
  const allocations = {};
  for (const r of rows) allocations[r.talent_id] = r.rank;
  return { available: pts.available || 0, earned: pts.earned || 0, spent: pts.spent || 0, allocations, tree: TALENT_TREE };
}

function currentRank(db, userId, talentId) {
  const r = db.prepare(`SELECT rank FROM player_talent_allocations WHERE user_id = ? AND talent_id = ?`).get(userId, talentId);
  return r?.rank || 0;
}

/** Spend one point into a talent. Validates available > 0, rank < max, prereqs. */
export function spendTalentPoint(db, userId, talentId) {
  if (!db || !userId || !talentId || !tableExists(db, "player_talent_points")) return { ok: false, reason: "unavailable" };
  const node = TALENT_TREE[talentId];
  if (!node) return { ok: false, reason: "unknown_talent" };
  ensurePointsRow(db, userId);
  const pts = db.prepare(`SELECT available FROM player_talent_points WHERE user_id = ?`).get(userId);
  if (!pts || pts.available <= 0) return { ok: false, reason: "no_points" };
  const rank = currentRank(db, userId, talentId);
  if (rank >= node.maxRank) return { ok: false, reason: "max_rank" };
  // Prerequisites.
  if (node.requires) {
    for (const [reqId, reqRank] of Object.entries(node.requires)) {
      if (currentRank(db, userId, reqId) < reqRank) {
        return { ok: false, reason: "prereq_unmet", needs: { [reqId]: reqRank } };
      }
    }
  }
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO player_talent_allocations (user_id, talent_id, rank) VALUES (?, ?, 1)
      ON CONFLICT(user_id, talent_id) DO UPDATE SET rank = rank + 1, updated_at = unixepoch()
    `).run(userId, talentId);
    db.prepare(`
      UPDATE player_talent_points SET available = available - 1, spent = spent + 1, updated_at = unixepoch()
      WHERE user_id = ?
    `).run(userId);
  });
  tx();
  return { ok: true, talentId, newRank: rank + 1, remaining: pts.available - 1 };
}

/**
 * Aggregate the combat-relevant effects of a user's allocated talents. The
 * combat route folds these into the damage computation (like affixes).
 * Returns { meleeDamagePct, elementDamagePct:{...}, flatPower, resistPct,
 * vitalityFlat, staminaRegenPct }.
 */
export function talentCombatBonuses(db, userId) {
  const out = { meleeDamagePct: 0, elementDamagePct: {}, flatPower: 0, resistPct: 0, vitalityFlat: 0, staminaRegenPct: 0 };
  if (!db || !userId || !tableExists(db, "player_talent_allocations")) return out;
  let rows = [];
  try { rows = db.prepare(`SELECT talent_id, rank FROM player_talent_allocations WHERE user_id = ? AND rank > 0`).all(userId); }
  catch { return out; }
  for (const { talent_id, rank } of rows) {
    const node = TALENT_TREE[talent_id];
    if (!node?.perRank) continue;
    const { stat, value, element } = node.perRank;
    const total = value * rank;
    if (stat === "elementDamagePct" && element) out.elementDamagePct[element] = (out.elementDamagePct[element] || 0) + total;
    else if (stat in out) out[stat] += total;
  }
  return out;
}

/** The multiplicative + flat damage bonus the player's talents add to a cast. */
export function talentDamageFor(db, userId, element = "none") {
  const b = talentCombatBonuses(db, userId);
  const pctMul = 1 + b.meleeDamagePct + (element && element !== "none" ? (b.elementDamagePct[element] || 0) : 0);
  return { multiplier: Math.round(pctMul * 1000) / 1000, flatPower: b.flatPower };
}
