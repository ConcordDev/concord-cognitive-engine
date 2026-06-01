// server/lib/combat/damage-calculator.js
// Elemental and physical damage calculation with resistance factors.

import crypto from 'node:crypto';
import { npcMaxHpForLevel } from '../entity-power.js';

// ── Resistance columns on entities ────────────────────────────────────────────
// NPC resistances are stored as fire_resistance, ice_resistance, etc. (0-1 scale)
// Player resistances come from equipped armor DTU stats (resistance_element fields)

// Default archetype resistances for NPCs (applied on first hit if not set)
const ARCHETYPE_RESISTANCES = {
  guard:      { physical_resistance: 0.2 },
  soldier:    { physical_resistance: 0.15 },
  bandit:     { physical_resistance: 0.05 },
  mage:       { fire_resistance: 0.1, ice_resistance: 0.1, lightning_resistance: 0.1 },
  priest:     { bio_resistance: 0.2 },
  dragon:     { fire_resistance: 0.9, physical_resistance: 0.3 },
  golem:      { physical_resistance: 0.5, lightning_resistance: -0.5 },  // negative = weakness
  undead:     { physical_resistance: 0.2, poison_resistance: 1.0, bio_resistance: 0.5 },
  elemental:  { fire_resistance: 0.5, ice_resistance: -0.5 },
};

// ── Status effect thresholds ──────────────────────────────────────────────────
// probability that a hit applies a status effect based on stack count
const STATUS_THRESHOLDS = {
  burn:     { element: 'fire',      trigger_pct: 0.25 },
  freeze:   { element: 'ice',       trigger_pct: 0.20 },
  paralyze: { element: 'lightning', trigger_pct: 0.15 },
  poison:   { element: 'poison',    trigger_pct: 0.30 },
  weaken:   { element: 'bio',       trigger_pct: 0.20 },
  disrupt:  { element: 'energy',    trigger_pct: 0.25 },
};

// ── computeDamage ─────────────────────────────────────────────────────────────
/**
 * Compute final damage from an attack, factoring in elemental and physical resistances.
 *
 * @param {object} attackerStats
 *   { skillLevel: number, element: string, basePower: number, enchantmentBonus: number,
 *     worldMultiplier: number }
 * @param {object} defenderStats
 *   { fire_resistance, ice_resistance, lightning_resistance, physical_resistance,
 *     poison_resistance, bio_resistance, energy_resistance, current_hp, max_hp,
 *     status_effects: string[] }
 * @param {object} skillSpec  (from skill DTU data)
 *   { aoe_radius, range, status_effects: string[], cooldown_ms }
 * @returns {{ rawDamage, resistancePct, finalDamage, statusEffectsApplied: string[], kill: boolean }}
 */
export function computeDamage(attackerStats, defenderStats, skillSpec = {}) {
  const {
    skillLevel = 1,
    element = 'none',
    basePower = 5,
    enchantmentBonus = 0,
    worldMultiplier = 1.0,
  } = attackerStats;

  // ── Raw damage ────────────────────────────────────────────────────────────
  const rawDamage = (basePower + skillLevel * 0.5 + enchantmentBonus) * worldMultiplier;

  // ── Resistance ────────────────────────────────────────────────────────────
  const resKey = element === 'none' ? 'physical_resistance' : `${element}_resistance`;
  const baseRes = defenderStats[resKey] ?? 0;

  // Status effects can modify resistance (burn stacks reduce ice resistance, etc.)
  const activeEffects = _parseJson(defenderStats.status_effects, []);
  let res = baseRes;
  if (element === 'ice' && activeEffects.includes('burn')) res = Math.max(0, res - 0.3);
  if (element === 'fire' && activeEffects.includes('freeze')) res = Math.max(0, res - 0.3);

  // Clamp resistance: resistances >1 mean immunity, negative = weakness
  const cappedRes = Math.min(1.0, Math.max(-1.0, res));
  const resistancePct = cappedRes;

  // ── Final damage ──────────────────────────────────────────────────────────
  const finalDamage = Math.max(0, rawDamage * (1 - cappedRes));
  const currentHp = defenderStats.current_hp ?? defenderStats.max_hp ?? 100;
  const kill = finalDamage >= currentHp;

  // ── Status effects ────────────────────────────────────────────────────────
  const statusEffectsApplied = [];
  const specEffects = Array.isArray(skillSpec.status_effects) ? skillSpec.status_effects : [];
  for (const effect of specEffects) {
    const config = STATUS_THRESHOLDS[effect];
    if (!config) continue;
    if (config.element !== element && element !== 'none') continue;
    // Already immune or has effect → skip
    const immuneKey = `${element}_resistance`;
    if ((defenderStats[immuneKey] ?? 0) >= 1.0) continue;
    if (activeEffects.includes(effect)) continue;
    // Probabilistic trigger
    if (Math.random() < config.trigger_pct) statusEffectsApplied.push(effect);
  }

  return {
    rawDamage: Math.round(rawDamage * 10) / 10,
    resistancePct,
    finalDamage: Math.round(finalDamage * 10) / 10,
    statusEffectsApplied,
    kill,
  };
}

// ── applyDamage ───────────────────────────────────────────────────────────────
/**
 * Apply computed damage to a database entity (NPC or player resource bars).
 * Returns the persisted damage_events row id.
 */
export function applyDamageToNPC(db, worldId, attackerId, attackerType, npcId, damageResult, meta = {}) {
  const id = crypto.randomUUID();
  const { finalDamage, rawDamage, resistancePct, statusEffectsApplied, kill } = damageResult;

  db.prepare(`
    INSERT INTO damage_events
      (id, world_id, attacker_id, attacker_type, target_id, target_type,
       skill_dtu_id, item_dtu_id, element, raw_damage, resistance_pct, final_damage,
       bar_used, bar_cost, status_effects, kill)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, worldId, attackerId, attackerType, npcId, 'npc',
    meta.skill_dtu_id || null, meta.item_dtu_id || null,
    meta.element || 'none',
    rawDamage, resistancePct, finalDamage,
    meta.bar_used || null, meta.bar_cost || 0,
    JSON.stringify(statusEffectsApplied), kill ? 1 : 0,
  );

  // Deduct HP from NPC
  const npc = db.prepare('SELECT current_hp, status_effects FROM world_npcs WHERE id = ?').get(npcId);
  if (npc) {
    const newHp = Math.max(0, (npc.current_hp ?? 100) - finalDamage);
    const effects = _parseJson(npc.status_effects, []);
    const mergedEffects = [...new Set([...effects, ...statusEffectsApplied])];
    db.prepare(`
      UPDATE world_npcs SET current_hp = ?, status_effects = ? WHERE id = ?
    `).run(newHp, JSON.stringify(mergedEffects), npcId);
  }

  return { eventId: id, kill };
}

export function applyDamageToPlayer(db, worldId, attackerId, attackerType, userId, damageResult, meta = {}) {
  const id = crypto.randomUUID();
  const { finalDamage, rawDamage, resistancePct, statusEffectsApplied, kill } = damageResult;

  db.prepare(`
    INSERT INTO damage_events
      (id, world_id, attacker_id, attacker_type, target_id, target_type,
       skill_dtu_id, item_dtu_id, element, raw_damage, resistance_pct, final_damage,
       bar_used, bar_cost, status_effects, kill)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, worldId, attackerId, attackerType, userId, 'player',
    meta.skill_dtu_id || null, meta.item_dtu_id || null,
    meta.element || 'none',
    rawDamage, resistancePct, finalDamage,
    meta.bar_used || null, meta.bar_cost || 0,
    JSON.stringify(statusEffectsApplied), kill ? 1 : 0,
  );

  // Deduct from player resource bars
  const bars = db.prepare(`
    SELECT * FROM player_resource_bars WHERE user_id = ? AND world_id = ?
  `).get(userId, worldId);
  if (bars) {
    const newHp = Math.max(0, bars.hp - finalDamage);
    db.prepare(`
      UPDATE player_resource_bars SET hp = ?, updated_at = unixepoch() WHERE user_id = ? AND world_id = ?
    `).run(newHp, userId, worldId);
  }

  return { eventId: id, kill };
}

// ── getOrCreateNPCResistances ─────────────────────────────────────────────────
/**
 * Fetch NPC resistance stats; seed archetype defaults if not yet set.
 */
export function getOrCreateNPCResistances(db, npcId) {
  const npc = db.prepare(`
    SELECT id, archetype, level, fire_resistance, ice_resistance, lightning_resistance,
           physical_resistance, poison_resistance, bio_resistance, energy_resistance,
           max_hp, current_hp, status_effects
    FROM world_npcs WHERE id = ?
  `).get(npcId);
  if (!npc) return null;

  // If no resistance is set yet, seed from archetype defaults
  if (npc.fire_resistance === null || npc.fire_resistance === undefined) {
    const defaults = ARCHETYPE_RESISTANCES[npc.archetype] || {};
    // WS1: HP scales with grown level when CONCORD_ABSOLUTE_POWER is on; falls
    // back to the legacy flat 100 when the flag is off. Only seeds the pool the
    // first time (COALESCE preserves any already-set HP).
    const seedHp = npcMaxHpForLevel(npc.level ?? 1);
    db.prepare(`
      UPDATE world_npcs SET
        fire_resistance      = ?,
        ice_resistance       = ?,
        lightning_resistance = ?,
        physical_resistance  = ?,
        poison_resistance    = ?,
        bio_resistance       = ?,
        energy_resistance    = ?,
        max_hp               = COALESCE(max_hp, ?),
        current_hp           = COALESCE(current_hp, ?)
      WHERE id = ?
    `).run(
      defaults.fire_resistance      ?? 0,
      defaults.ice_resistance       ?? 0,
      defaults.lightning_resistance ?? 0,
      defaults.physical_resistance  ?? 0,
      defaults.poison_resistance    ?? 0,
      defaults.bio_resistance       ?? 0,
      defaults.energy_resistance    ?? 0,
      seedHp,
      seedHp,
      npcId,
    );
    return { ...npc, ...defaults, max_hp: npc.max_hp ?? seedHp, current_hp: npc.current_hp ?? seedHp };
  }

  return npc;
}

// ── getOrInitPlayerBars ───────────────────────────────────────────────────────
export function getOrInitPlayerBars(db, userId, worldId) {
  let bars = db.prepare(`
    SELECT * FROM player_resource_bars WHERE user_id = ? AND world_id = ?
  `).get(userId, worldId);

  if (!bars) {
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT OR IGNORE INTO player_resource_bars
        (id, user_id, world_id, hp, max_hp, mana, max_mana, stamina, max_stamina,
         bio_power, max_bio_power, perception, max_perception)
      VALUES (?,?,?, 100,100, 100,100, 100,100, 100,100, 100,100)
    `).run(id, userId, worldId);
    bars = db.prepare('SELECT * FROM player_resource_bars WHERE id = ?').get(id);
  }

  return bars;
}

// ── consumeResourceBar ────────────────────────────────────────────────────────
/**
 * Deduct resource bar cost. Returns { ok, bars, reason? }
 */
// SECURITY (playtest #L2): barType is interpolated into the UPDATE SET clause
// below, and better-sqlite3 does NOT parameterize identifiers. barType comes from
// a user/LLM-authored skill DTU's `data.resource_bar`, so it MUST be whitelisted
// against the real deductible columns first — otherwise a crafted value injects
// the SET clause (`mana = 99999, stamina = 99999` → free-resource cheat) or an
// unknown one crashes the cast with `no such column`.
const RESOURCE_BAR_COLUMNS = new Set(["hp", "mana", "stamina", "bio_power", "perception"]);

export function consumeResourceBar(db, userId, worldId, barType, cost) {
  const bars = getOrInitPlayerBars(db, userId, worldId);
  if (!RESOURCE_BAR_COLUMNS.has(barType)) {
    return { ok: false, bars, reason: `invalid_resource_bar:${barType}` };
  }
  const current = bars[barType] ?? 0;

  if (current < cost) {
    return { ok: false, bars, reason: `Not enough ${barType} (have ${current.toFixed(1)}, need ${cost})` };
  }

  db.prepare(`
    UPDATE player_resource_bars SET ${barType} = ${barType} - ?, updated_at = unixepoch()
    WHERE user_id = ? AND world_id = ?
  `).run(cost, userId, worldId);

  return { ok: true, bars: { ...bars, [barType]: current - cost } };
}

// ── regenerateResourceBars ────────────────────────────────────────────────────
const REGEN_RATES = {
  mana:       2.0,  // per second
  stamina:    3.0,
  bio_power:  1.5,
  perception: 2.5,
  hp:         0.5,
};

export function regenerateResourceBars(db, userId, worldId) {
  const bars = getOrInitPlayerBars(db, userId, worldId);
  const now = Math.floor(Date.now() / 1000);
  const elapsed = Math.min(300, now - (bars.last_regen_at ?? now));  // cap at 5 minutes
  if (elapsed <= 0) return bars;

  const updates = {};
  for (const [bar, rate] of Object.entries(REGEN_RATES)) {
    const maxKey = bar === 'hp' ? 'max_hp' : `max_${bar}`;
    const max = bars[maxKey] ?? 100;
    const current = bars[bar] ?? 0;
    updates[bar] = Math.min(max, current + rate * elapsed);
  }

  db.prepare(`
    UPDATE player_resource_bars SET
      hp = ?, mana = ?, stamina = ?, bio_power = ?, perception = ?,
      last_regen_at = ?, updated_at = unixepoch()
    WHERE user_id = ? AND world_id = ?
  `).run(
    updates.hp, updates.mana, updates.stamina, updates.bio_power, updates.perception,
    now, userId, worldId,
  );

  return { ...bars, ...updates, last_regen_at: now };
}

// ── checkCrossSkillUnlock ─────────────────────────────────────────────────────
/**
 * Check if a player meets the prerequisites for a cross-skill unlock.
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} crossSkillType  e.g. 'fire_martial'
 * @returns {{ eligible: boolean, missing: { skill_type, required, actual }[] }}
 */
export function checkCrossSkillUnlock(db, userId, crossSkillType) {
  const reqs = db.prepare(`
    SELECT requires_skill, min_level FROM skill_cross_requirements WHERE skill_type = ?
  `).all(crossSkillType);

  if (reqs.length === 0) {
    return { eligible: false, missing: [{ skill_type: crossSkillType, required: '?', actual: 0 }] };
  }

  const missing = [];
  for (const req of reqs) {
    const skill = db.prepare(`
      SELECT MAX(level) as level FROM player_skill_levels WHERE user_id = ? AND skill_type = ?
    `).get(userId, req.requires_skill);
    const actual = skill?.level ?? 0;
    if (actual < req.min_level) {
      missing.push({ skill_type: req.requires_skill, required: req.min_level, actual });
    }
  }

  return { eligible: missing.length === 0, missing };
}

// ── Internal helpers ──────────────────────────────────────────────────────────
function _parseJson(val, fallback) {
  if (!val) return fallback;
  try { return typeof val === 'string' ? JSON.parse(val) : val; }
  catch { return fallback; }
}
