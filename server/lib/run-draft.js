// server/lib/run-draft.js
//
// F4.1 — shared in-run draft engine. Generalises horde's deterministic
// pick-1-of-3 boon draft so roguelite / extraction / horde share one engine.
// Unlike horde's descriptive strings ("all damage +25%"), every boon here has a
// STRUCTURED effect that actually applies, and getRunModifiers accumulates the
// picks into a live modifier bundle the run reads — plus synergy combos when
// tagged boons stack.
//
// Deterministic roll (sha1-seeded by run + pick-count) so a re-roll on the same
// step returns the same set — fair RNG, no save-scumming.

import crypto from "node:crypto";

// Structured boon pool. effect: { stat, value }. synergy tags drive combos.
export const DRAFT_POOL = Object.freeze([
  { id: "blade_storm",    name: "Blade Storm",    effect: { stat: "damageMult", value: 0.25 }, tags: ["offense"] },
  { id: "hot_blooded",    name: "Hot Blooded",    effect: { stat: "attackSpeedMult", value: 0.20 }, tags: ["offense", "speed"] },
  { id: "ember_lash",     name: "Ember Lash",     effect: { stat: "fireDotPerHit", value: 4 }, tags: ["offense", "fire"] },
  { id: "inferno_core",   name: "Inferno Core",   effect: { stat: "fireDotPerHit", value: 6 }, tags: ["fire"] },
  { id: "crit_oath",      name: "Crit Oath",      effect: { stat: "critChance", value: 0.10 }, tags: ["offense", "crit"] },
  { id: "deadeye",        name: "Deadeye",        effect: { stat: "critDamageMult", value: 0.35 }, tags: ["crit"] },
  { id: "iron_hide",      name: "Iron Hide",      effect: { stat: "maxHpFlat", value: 30 }, tags: ["defense"] },
  { id: "thorned_aura",   name: "Thorned Aura",   effect: { stat: "reflectPct", value: 0.15 }, tags: ["defense"] },
  { id: "swift_recovery", name: "Swift Recovery", effect: { stat: "regenPerSec", value: 5 }, tags: ["defense", "sustain"] },
  { id: "lifesteal",      name: "Lifesteal",      effect: { stat: "lifestealPct", value: 0.08 }, tags: ["sustain", "offense"] },
  { id: "magnet_charm",   name: "Magnet Charm",   effect: { stat: "pickupRadiusMult", value: 0.5 }, tags: ["utility"] },
  { id: "fleet_foot",     name: "Fleet Foot",     effect: { stat: "moveSpeedMult", value: 0.15 }, tags: ["speed", "utility"] },
]);

const POOL_BY_ID = new Map(DRAFT_POOL.map((b) => [b.id, b]));

// Synergy combos: when the player holds ALL `requires` boons, a bonus applies.
export const SYNERGIES = Object.freeze([
  { id: "inferno",   name: "Inferno",   requires: ["ember_lash", "inferno_core"], bonus: { stat: "fireDotPerHit", value: 6 } },
  { id: "assassin",  name: "Assassin",  requires: ["crit_oath", "deadeye"],       bonus: { stat: "critDamageMult", value: 0.25 } },
  { id: "berserker", name: "Berserker", requires: ["blade_storm", "lifesteal"],   bonus: { stat: "damageMult", value: 0.15 } },
  { id: "juggernaut",name: "Juggernaut",requires: ["iron_hide", "thorned_aura"],  bonus: { stat: "reflectPct", value: 0.10 } },
]);

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name); }
  catch { return false; }
}

/** Picks already taken for a run (array of pick ids). */
export function pickedFor(db, runKind, runId) {
  if (!db || !tableExists(db, "run_draft_picks")) return [];
  try {
    return db.prepare(`SELECT pick_id FROM run_draft_picks WHERE run_kind = ? AND run_id = ?`)
      .all(runKind, runId).map((r) => r.pick_id);
  } catch { return []; }
}

/**
 * Deterministic draft offering: `count` boons not yet picked, seeded by
 * (runId + picks-so-far) so a re-roll on the same step is stable.
 */
export function rollDraft(db, runKind, runId, count = 3) {
  const picked = pickedFor(db, runKind, runId);
  const available = DRAFT_POOL.filter((b) => !picked.includes(b.id));
  if (available.length === 0) return [];
  const seed = crypto.createHash("sha1").update(`${runId}:${picked.length}`).digest("hex").slice(0, 8);
  const sorted = [...available].sort((a, b) => {
    const ha = parseInt(crypto.createHash("sha1").update(a.id + seed).digest("hex").slice(0, 6), 16);
    const hb = parseInt(crypto.createHash("sha1").update(b.id + seed).digest("hex").slice(0, 6), 16);
    return ha - hb;
  });
  return sorted.slice(0, Math.max(1, count));
}

/** Record a pick. Validates the boon exists + isn't already taken. */
export function recordPick(db, { runKind, runId, userId, pickId }) {
  if (!db || !runKind || !runId || !userId || !pickId) return { ok: false, reason: "missing_inputs" };
  if (!tableExists(db, "run_draft_picks")) return { ok: false, reason: "no_table" };
  if (!POOL_BY_ID.has(pickId)) return { ok: false, reason: "unknown_boon" };
  if (pickedFor(db, runKind, runId).includes(pickId)) return { ok: false, reason: "already_picked" };
  db.prepare(`
    INSERT INTO run_draft_picks (run_kind, run_id, user_id, pick_id) VALUES (?, ?, ?, ?)
  `).run(runKind, runId, userId, pickId);
  return { ok: true, pickId, boon: POOL_BY_ID.get(pickId) };
}

/**
 * Accumulate a run's picks into a live modifier bundle (+ active synergies).
 * Returns { modifiers:{stat:total}, picks:[...], synergies:[{id,name}] }.
 */
export function getRunModifiers(db, runKind, runId) {
  const picked = pickedFor(db, runKind, runId);
  const modifiers = {};
  for (const id of picked) {
    const boon = POOL_BY_ID.get(id);
    if (!boon?.effect) continue;
    modifiers[boon.effect.stat] = (modifiers[boon.effect.stat] || 0) + boon.effect.value;
  }
  // Synergy bonuses.
  const synergies = [];
  for (const syn of SYNERGIES) {
    if (syn.requires.every((r) => picked.includes(r))) {
      modifiers[syn.bonus.stat] = (modifiers[syn.bonus.stat] || 0) + syn.bonus.value;
      synergies.push({ id: syn.id, name: syn.name });
    }
  }
  // round float stats
  for (const k of Object.keys(modifiers)) modifiers[k] = Math.round(modifiers[k] * 1000) / 1000;
  return { modifiers, picks: picked, synergies };
}

export { POOL_BY_ID };
