// server/lib/entity-power.js
//
// WS1 — Absolute power becomes mechanically real.
//
// Today an NPC's `level` is cosmetic: getOrCreateNPCResistances hard-defaults
// HP to 100 and the NPC→player path computes damage as `5 + criminal_rep*10`,
// ignoring level/skill/evolution entirely. A "level 80" frontier wolf is
// therefore mechanically identical to a level-1 hub rabbit, which makes the
// place-based danger gradient and the outward-migration engine visually true
// but mechanically empty.
//
// This module derives an entity's combat strength from its GROWN level/skill/
// evolution and turns that into HP + attack stats — the single highest-leverage
// fix in the living-world plan. It ships GATED: with the kill-switch off
// (default) every helper returns the legacy values, so existing combat balance
// and tests are untouched until an operator flips CONCORD_ABSOLUTE_POWER on.
//
// Skill > level stays the rule: this scales NON-player entities so the world's
// gradient bites. The player damage formula is deliberately untouched.

function envNum(name, dflt, { min = 0, max = Infinity } = {}) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= min && v <= max ? v : dflt;
}

// ── Kill-switch + dials ─────────────────────────────────────────────────────
/**
 * Absolute-power model is ON by default — the living world is the default
 * experience. Set CONCORD_ABSOLUTE_POWER=0 (or false/off/no) to fall back to the
 * legacy flat-100-HP / criminal-rep damage model.
 */
export function absolutePowerEnabled() {
  const v = String(process.env.CONCORD_ABSOLUTE_POWER ?? "").toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "no");
}

export const POWER_DIALS = Object.freeze({
  baseHp: envNum("CONCORD_NPC_BASE_HP", 100, { min: 1 }),           // legacy default
  hpPerLevel: envNum("CONCORD_NPC_HP_PER_LEVEL", 0.12, { min: 0 }), // +12% base HP / level
  basePower: envNum("CONCORD_NPC_BASE_POWER", 5, { min: 0 }),       // legacy basePower
  powerPerLevel: envNum("CONCORD_NPC_POWER_PER_LEVEL", 0.65, { min: 0 }),
  // Anti-cheat / anti-misconfig: NPC outgoing damage is capped just like the
  // player path. cap = min(hardCap, scaled basePower * critMult).
  damageHardCap: envNum("CONCORD_NPC_DAMAGE_HARD_CAP", 500, { min: 1 }),
  damageCritMult: envNum("CONCORD_NPC_DAMAGE_CRIT_MULT", 3, { min: 1 }),
});

// ── E1 (Phase E §0 — "the one law": power must never outrun stakes) ─────────
// RELATIVE scaling, not 1:1 (the Oblivion-glass-armor failure). The player
// should feel godlike vs the COMMON world (trash gets curb-stomped — the isekai
// power fantasy is real and good), while NAMED/authored rivals + bosses stay a
// credible threat so the stakes layer survives. Bands are the research-decided
// defaults (4 of 5 angles corroborated this): common 70–85% of player tier,
// named/boss 100–110%. Gated by CONCORD_RELATIVE_SCALING (default OFF — the
// living-world absolute model stays the default; flipping this on is the
// playtest-driven tuning step, mirroring CONCORD_ABSOLUTE_POWER's handling).
export function relativeScalingEnabled() {
  const v = String(process.env.CONCORD_RELATIVE_SCALING ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

export const RELATIVE_DIALS = Object.freeze({
  commonLo: envNum("CONCORD_REL_COMMON_LO", 0.70, { min: 0, max: 2 }),
  commonHi: envNum("CONCORD_REL_COMMON_HI", 0.85, { min: 0, max: 2 }),
  namedLo:  envNum("CONCORD_REL_NAMED_LO", 1.00, { min: 0, max: 3 }),
  namedHi:  envNum("CONCORD_REL_NAMED_HI", 1.10, { min: 0, max: 3 }),
});

/**
 * The player's current combat level — MAX grown skill level across
 * `player_skill_levels` (mirrors getEntityCombatLevel for NPCs). Falls back to
 * 1 on minimal builds / no skills. Bounded + crash-safe.
 */
export function getPlayerCombatLevel(db, userId) {
  if (!db || !userId) return 1;
  try {
    if (tableExists(db, "player_skill_levels")) {
      const row = db.prepare("SELECT MAX(level) AS lvl FROM player_skill_levels WHERE user_id = ?").get(userId);
      if (row && Number.isFinite(row.lvl) && row.lvl > 0) return row.lvl;
    }
  } catch { /* degrade to 1 */ }
  return 1;
}

/**
 * Apply relative scaling to an entity's own (absolute) combat level given the
 * player's level. Pure + deterministic.
 *   - common: clamp DOWN to the band ceiling (player*commonHi) so a leveled
 *     player genuinely outgrows trash — but never below the entity's own level
 *     if that's already under the ceiling (we only cap, never inflate trash).
 *   - named/boss: floor UP to the player's band (player*(namedLo..namedHi) mid)
 *     so a named rival is always a credible threat — but keep the entity's own
 *     grown level if it's *already* higher (an over-leveled boss stays scary).
 * No-op (returns npcLevel) when CONCORD_RELATIVE_SCALING is off.
 */
export function relativeScaledLevel(npcLevel, playerLevel, { named = false } = {}) {
  const own = Math.max(1, Number(npcLevel) || 1);
  if (!relativeScalingEnabled()) return own;
  const pl = Math.max(1, Number(playerLevel) || 1);
  if (named) {
    const target = Math.round(pl * ((RELATIVE_DIALS.namedLo + RELATIVE_DIALS.namedHi) / 2));
    return Math.max(own, target);
  }
  const ceiling = Math.round(pl * RELATIVE_DIALS.commonHi);
  return Math.min(own, Math.max(1, ceiling));
}

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name); }
  catch { return false; }
}

/**
 * The canonical "how strong is this entity right now" measure: the max grown
 * skill level from `npc_skills`, plus a small bonus for applied skill-evolution
 * revisions (lineage depth). Falls back to `world_npcs.level`, then 1. Bounded
 * + crash-safe so minimal builds degrade to level 1 (legacy behaviour).
 *
 * Note this reads GROWN strength (npc_skills), keeping skill > level the rule —
 * an NPC that has trained its skills reads stronger than one that merely has a
 * high nominal `world_npcs.level`.
 */
export function getEntityCombatLevel(db, npcId) {
  if (!db || !npcId) return 1;
  let base = 1;
  try {
    if (tableExists(db, "npc_skills")) {
      const row = db.prepare("SELECT MAX(level) AS lvl FROM npc_skills WHERE npc_id = ?").get(npcId);
      if (row && Number.isFinite(row.lvl) && row.lvl > 0) base = row.lvl;
    }
    if (base <= 1 && tableExists(db, "world_npcs")) {
      const row = db.prepare("SELECT level FROM world_npcs WHERE id = ?").get(npcId);
      if (row && Number.isFinite(row.level) && row.level > base) base = row.level;
    }
  } catch { /* degrade to 1 */ }

  let revBonus = 0;
  try {
    if (tableExists(db, "skill_revisions")) {
      const row = db.prepare(
        "SELECT COUNT(*) AS n FROM skill_revisions WHERE author_kind = 'npc' AND author_id = ? AND status = 'applied'"
      ).get(npcId);
      // Each two applied revisions is worth ~1 extra effective level (capped).
      revBonus = Math.min(50, Math.floor((row?.n || 0) / 2));
    }
  } catch { /* no revisions table */ }

  return Math.max(1, base + revBonus);
}

/**
 * Max HP for an NPC of the given combat level. With the flag off, returns the
 * legacy flat base (100). With it on, HP scales with level so frontier
 * creatures are genuine bullet-sponges relative to hub fauna.
 */
export function npcMaxHpForLevel(level, baseHp = POWER_DIALS.baseHp) {
  const b = Number(baseHp) > 0 ? Number(baseHp) : POWER_DIALS.baseHp;
  if (!absolutePowerEnabled()) return b;
  const lvl = Math.max(1, Number(level) || 1);
  return Math.round(b * (1 + lvl * POWER_DIALS.hpPerLevel));
}

/**
 * Attacker stats (for computeDamage) for an NPC of the given combat level +
 * element. With the flag off, returns the legacy `{ skillLevel: 5, basePower:
 * 5 + criminalRep*10 }` shape so behaviour is byte-for-byte unchanged. With it
 * on, basePower + skillLevel both scale with level, making the NPC's raw damage
 * climb ~linearly with how far out (and how grown) it is.
 */
export function npcAttackStats(level, element = "physical", { criminalRep = 0 } = {}) {
  if (!absolutePowerEnabled()) {
    return { skillLevel: 5, element, basePower: 5 + (Number(criminalRep) || 0) * 10, enchantmentBonus: 0, worldMultiplier: 1 };
  }
  const lvl = Math.max(1, Number(level) || 1);
  const basePower = POWER_DIALS.basePower + lvl * POWER_DIALS.powerPerLevel + (Number(criminalRep) || 0) * 2;
  return { skillLevel: lvl, element, basePower, enchantmentBonus: 0, worldMultiplier: 1 };
}

/**
 * Cap an NPC's outgoing final damage. Mirrors the player-side _validateDamageCap
 * so a misconfigured dial (or a future exploit) can't let an NPC one-shot
 * across the map. cap = min(hardCap, scaledBasePower * critMult). No-op when the
 * flag is off (legacy path was already small).
 */
export function capNpcDamage(finalDamage, attackerStats) {
  const dmg = Number(finalDamage) || 0;
  if (!absolutePowerEnabled()) return dmg;
  const basePower = Number(attackerStats?.basePower) || POWER_DIALS.basePower;
  const cap = Math.min(POWER_DIALS.damageHardCap, basePower * POWER_DIALS.damageCritMult);
  return Math.min(dmg, cap);
}
