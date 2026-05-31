// server/lib/companions.js
//
// Pet / companion engine. Tame, deploy, dismiss, level. Distinct from
// the creature_bonds romantic/breeding system — companions track
// allegiance from creature to player owner.
//
// Tame attempt success is gated by:
//   1. Bond level (player → creature) must clear `BOND_THRESHOLD`
//      (default 100), set in migration 083 + creature-crossbreeding.js
//   2. A roll vs (bond - threshold) / threshold biased by lure rarity
//   3. A skill check on the player's `tame_skill` (in dtus skill substrate)
//
// Bond is accumulated via `recordEncounter` from creature-crossbreeding —
// every co-located tick, every shared-threat fight, raises the player's
// bond with the creature. The Palworld-Pokemon-Digimon-Ark hybrid
// requires no balls or capture devices; you build trust over time.
//
// Companions persist across worlds via `world_id` column. A companion
// not in the player's current world is "stabled" — visible in roster
// but undeployable until travel.

import crypto from "crypto";
import { recordEncounter, getBond } from "./creature-crossbreeding.js";
import { markCompanionMountableForHybrid } from "./ecosystem/mount-eligibility.js";

const TAME_BOND_THRESHOLD     = 100;
const TAME_BASE_SUCCESS_RATE  = 0.25;
const TAME_LURE_BONUS         = 0.20;
const COMPANION_XP_PER_ASSIST = 10;
const COMPANION_XP_PER_KILL   = 35;
const COMPANION_LEVEL_CURVE   = (level) => 100 * level * level; // L1→100xp, L2→400, L3→900...

/**
 * Attempt to tame a creature. Bond must already be above threshold (built
 * up via co-location encounters); the attempt rolls success based on bond
 * margin + optional lure item bonus + player's tame_skill.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.ownerId
 * @param {string} opts.creatureId
 * @param {string} [opts.creatureName='Companion']
 * @param {string} [opts.worldId='concordia-hub']
 * @param {object|null} [opts.lureItem]    — { rarity: 'common'|'rare'|'legendary' }
 * @param {number} [opts.tameSkill=0]      — 0..200 skill level
 * @returns {{ ok: boolean, companionId?: string, reason?: string, successProbability?: number }}
 */
export function attemptTame(db, {
  ownerId, creatureId, creatureName = "Companion", worldId = "concordia-hub",
  lureItem = null, tameSkill = 0,
} = {}) {
  if (!db) return { ok: false, reason: "db_required" };
  if (!ownerId || !creatureId) return { ok: false, reason: "missing_ids" };

  // Already owned?
  const existing = db.prepare(
    `SELECT id FROM player_companions WHERE owner_id = ? AND creature_id = ?`,
  ).get(ownerId, creatureId);
  if (existing) return { ok: false, reason: "already_owned", companionId: existing.id };

  // Bond gate. Without enough trust the attempt fails immediately —
  // creature flees rather than fighting. This is the key design move:
  // taming is patience-gated, not throw-a-ball-gated.
  // getBond returns a numeric scalar (not a row).
  const currentBond = Number(getBond(db, ownerId, creatureId)) || 0;
  if (currentBond < TAME_BOND_THRESHOLD) {
    return { ok: false, reason: "bond_too_low", current: currentBond, required: TAME_BOND_THRESHOLD };
  }

  // Roll
  const bondMargin = (currentBond - TAME_BOND_THRESHOLD) / TAME_BOND_THRESHOLD; // 0..N
  const lureBonus  = lureItem
    ? lureItem.rarity === "legendary" ? 0.40
      : lureItem.rarity === "rare"      ? 0.25
      : TAME_LURE_BONUS
    : 0;
  const skillBonus = Math.min(0.30, Number(tameSkill) / 600);
  const probability = Math.min(0.95, TAME_BASE_SUCCESS_RATE + bondMargin * 0.30 + lureBonus + skillBonus);
  const roll = Math.random();
  if (roll > probability) {
    return { ok: false, reason: "creature_resisted", successProbability: probability, roll };
  }

  // Mint companion
  const id = `cmp_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12)}`;
  try {
    db.prepare(`
      INSERT INTO player_companions
        (id, owner_id, creature_id, name, tame_bond, loyalty, world_id, last_action_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
    `).run(id, ownerId, creatureId, String(creatureName).slice(0, 60), currentBond, 50, worldId);
  } catch (e) {
    return { ok: false, reason: e.message };
  }

  // Wave 7a glue #6 — if the tamed creature is a bred hybrid of a rideable
  // body plan, flag it mount_eligible immediately (closing tame→breed→mount).
  // Best-effort: a non-hybrid creature is a no-op.
  try { markCompanionMountableForHybrid(db, id, creatureId); } catch { /* eligibility best-effort */ }

  return { ok: true, companionId: id, successProbability: probability };
}

/**
 * Increment owner↔creature bond from a co-location / shared-threat tick.
 * Wraps recordEncounter from creature-crossbreeding so taming reuses the
 * same affinity ledger crossbreeding uses.
 */
export function recordTameInteraction(db, ownerId, creatureId, { sameEnvironment = true, sharedThreat = false, environment = null } = {}) {
  if (!db || !ownerId || !creatureId) return null;
  try {
    return recordEncounter(db, {
      aId: ownerId,
      bId: creatureId,
      worldA: null,
      worldB: null,
      environment,
      sameEnvironmentBonus: sameEnvironment,
      sharedThreatBonus: sharedThreat,
    });
  } catch { return null; }
}

export function deployCompanion(db, ownerId, companionId, worldId = "concordia-hub") {
  if (!db) return { ok: false, reason: "db_required" };
  // Only one deployed companion per owner+world for v1 — keeps the world
  // legible and doesn't flood AvatarSystem3D with auto-followers.
  db.prepare(`
    UPDATE player_companions SET deployed = 0
    WHERE owner_id = ? AND world_id = ? AND deployed = 1
  `).run(ownerId, worldId);
  const r = db.prepare(`
    UPDATE player_companions SET deployed = 1, world_id = ?, last_action_at = unixepoch()
    WHERE id = ? AND owner_id = ?
  `).run(worldId, companionId, ownerId);
  if (r.changes === 0) return { ok: false, reason: "not_owned_or_not_found" };
  return { ok: true };
}

export function dismissCompanion(db, ownerId, companionId) {
  const r = db.prepare(`
    UPDATE player_companions SET deployed = 0, last_action_at = unixepoch()
    WHERE id = ? AND owner_id = ?
  `).run(companionId, ownerId);
  if (r.changes === 0) return { ok: false, reason: "not_owned_or_not_found" };
  return { ok: true };
}

export function renameCompanion(db, ownerId, companionId, name) {
  const safe = String(name || "").slice(0, 60).trim();
  if (!safe) return { ok: false, reason: "name_required" };
  const r = db.prepare(`UPDATE player_companions SET name = ? WHERE id = ? AND owner_id = ?`)
    .run(safe, companionId, ownerId);
  if (r.changes === 0) return { ok: false, reason: "not_owned_or_not_found" };
  return { ok: true };
}

export function listCompanions(db, ownerId, { worldId = null, deployedOnly = false } = {}) {
  if (!db || !ownerId) return [];
  let sql = `SELECT * FROM player_companions WHERE owner_id = ?`;
  const params = [ownerId];
  if (worldId) { sql += " AND world_id = ?"; params.push(worldId); }
  if (deployedOnly) { sql += " AND deployed = 1"; }
  sql += " ORDER BY level DESC, caught_at ASC";
  try { return db.prepare(sql).all(...params); }
  catch { return []; }
}

/**
 * Award XP from a combat assist. Called server-side from the combat:hit
 * handler when a player's deployed companion is within range of the
 * action. Levels follow `100 * level^2` curve.
 */
export function levelUpCompanion(db, companionId, xpGained) {
  if (!Number.isFinite(xpGained) || xpGained <= 0) return { ok: false };
  const c = db.prepare(`SELECT level, xp FROM player_companions WHERE id = ?`).get(companionId);
  if (!c) return { ok: false, reason: "not_found" };
  const newXp = c.xp + Math.round(xpGained);
  let newLevel = c.level;
  while (newXp >= COMPANION_LEVEL_CURVE(newLevel + 1)) newLevel += 1;
  const leveledUp = newLevel > c.level;
  db.prepare(`UPDATE player_companions SET xp = ?, level = ? WHERE id = ?`)
    .run(newXp, newLevel, companionId);
  return { ok: true, leveledUp, newLevel, newXp };
}

/**
 * Award assist XP to all the deployed companions of a player who scored
 * a combat hit. Called from server.js combat:hit handler.
 *
 * @returns {Array<{ companionId, leveledUp, newLevel }>}
 */
export function awardAssistXP(db, ownerId, { kill = false, assist = true } = {}) {
  const companions = listCompanions(db, ownerId, { deployedOnly: true });
  const out = [];
  for (const c of companions) {
    const xp = (kill ? COMPANION_XP_PER_KILL : 0) + (assist ? COMPANION_XP_PER_ASSIST : 0);
    if (xp <= 0) continue;
    const r = levelUpCompanion(db, c.id, xp);
    if (r.ok) out.push({ companionId: c.id, leveledUp: !!r.leveledUp, newLevel: r.newLevel });
  }
  return out;
}

export {
  TAME_BOND_THRESHOLD,
  TAME_BASE_SUCCESS_RATE,
  COMPANION_XP_PER_ASSIST,
  COMPANION_XP_PER_KILL,
  COMPANION_LEVEL_CURVE,
};
