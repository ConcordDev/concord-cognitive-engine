// server/lib/skills/character-level.js
// Character leveling: every skill level-up advances character level by 1.
// Each character level grants 2 upgrade points spendable on any resource bar's max.
// No cap — levels stack indefinitely; each upgrade adds +10 to the chosen bar's max.

import crypto from 'node:crypto';

const UPGRADES_PER_LEVEL = 2;
const UPGRADE_AMOUNT = 10;   // max bar increase per point spent

// ── awardCharacterLevel ───────────────────────────────────────────────────────
/**
 * Called whenever a skill levels up. Increments character_level and adds
 * UPGRADES_PER_LEVEL pending_upgrades to the player's resource bar row.
 * Idempotent: safe to call if bars row doesn't exist yet (creates it).
 *
 * @returns {{ characterLevel: number, pendingUpgrades: number }}
 */
export function awardCharacterLevel(db, userId, worldId) {
  // Ensure bars row exists
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT OR IGNORE INTO player_resource_bars
      (id, user_id, world_id, hp, max_hp, mana, max_mana, stamina, max_stamina,
       bio_power, max_bio_power, perception, max_perception,
       character_level, pending_upgrades, total_upgrades_spent)
    VALUES (?,?,?, 100,100, 100,100, 100,100, 100,100, 100,100, 0,0,0)
  `).run(id, userId, worldId);

  db.prepare(`
    UPDATE player_resource_bars
    SET character_level  = character_level  + 1,
        pending_upgrades = pending_upgrades + ?,
        updated_at       = unixepoch()
    WHERE user_id = ? AND world_id = ?
  `).run(UPGRADES_PER_LEVEL, userId, worldId);

  const row = db.prepare(`
    SELECT character_level, pending_upgrades FROM player_resource_bars
    WHERE user_id = ? AND world_id = ?
  `).get(userId, worldId);

  return {
    characterLevel:  row?.character_level  ?? 1,
    pendingUpgrades: row?.pending_upgrades ?? UPGRADES_PER_LEVEL,
    upgradesAwarded: UPGRADES_PER_LEVEL,
  };
}

// ── spendUpgradePoint ─────────────────────────────────────────────────────────
/**
 * Spend one upgrade point to increase a resource bar's max by UPGRADE_AMOUNT.
 * Also increases the current value by the same amount (you fill to new max instantly).
 *
 * @param {string} barType  'hp'|'mana'|'stamina'|'bio_power'|'perception'
 * @returns {{ ok: boolean, newMax: number, pendingUpgrades: number, reason?: string }}
 */
export function spendUpgradePoint(db, userId, worldId, barType) {
  const VALID_BARS = ['hp', 'mana', 'stamina', 'bio_power', 'perception'];
  if (!VALID_BARS.includes(barType)) {
    return { ok: false, reason: `Invalid bar: '${barType}'. Choose one of: ${VALID_BARS.join(', ')}` };
  }

  const row = db.prepare(`
    // TODO: project explicit columns (auto-fix suggestion)
    SELECT * FROM player_resource_bars WHERE user_id = ? AND world_id = ?
  `).get(userId, worldId);

  if (!row) {
    return { ok: false, reason: 'No character data found — visit a world first' };
  }

  if (row.pending_upgrades <= 0) {
    return { ok: false, reason: 'No upgrade points available — keep leveling up skills' };
  }

  const maxKey  = barType === 'hp' ? 'max_hp'         : `max_${barType}`;
  const currKey = barType === 'hp' ? 'hp'             : barType;
  const currentMax  = row[maxKey]  ?? 100;
  const currentVal  = row[currKey] ?? 100;
  const newMax = currentMax + UPGRADE_AMOUNT;
  const newVal = currentVal + UPGRADE_AMOUNT;  // immediately fill the extra capacity

  db.prepare(`
    UPDATE player_resource_bars
    SET ${maxKey}  = ?,
        ${currKey} = ?,
        pending_upgrades      = pending_upgrades - 1,
        total_upgrades_spent  = total_upgrades_spent + 1,
        updated_at            = unixepoch()
    WHERE user_id = ? AND world_id = ?
  `).run(newMax, newVal, userId, worldId);

  // Log it
  db.prepare(`
    INSERT INTO bar_upgrade_log (id, user_id, world_id, bar_type, amount, character_level_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), userId, worldId, barType, UPGRADE_AMOUNT, row.character_level ?? 0);

  const updated = db.prepare(`
    // TODO: project explicit columns (auto-fix suggestion)
    SELECT * FROM player_resource_bars WHERE user_id = ? AND world_id = ?
  `).get(userId, worldId);

  return {
    ok: true,
    barType,
    newMax,
    newVal,
    pendingUpgrades: updated?.pending_upgrades ?? 0,
    characterLevel:  updated?.character_level  ?? 0,
  };
}

// ── getCharacterProgress ──────────────────────────────────────────────────────
/**
 * Full character level summary: current level, pending upgrades, bar maxes,
 * and upgrade history.
 */
export function getCharacterProgress(db, userId, worldId) {
  const bars = db.prepare(`
    // TODO: project explicit columns (auto-fix suggestion)
    SELECT * FROM player_resource_bars WHERE user_id = ? AND world_id = ?
  `).get(userId, worldId);

  if (!bars) {
    return { characterLevel: 0, pendingUpgrades: 0, bars: null, recentUpgrades: [] };
  }

  const recentUpgrades = db.prepare(`
    SELECT bar_type, amount, character_level_at, created_at
    FROM bar_upgrade_log
    WHERE user_id = ? AND world_id = ?
    ORDER BY created_at DESC LIMIT 20
  `).all(userId, worldId);

  // Lifetime stats from all skill rows
  const skillSummary = db.prepare(`
    SELECT skill_type, MAX(level) as level, SUM(xp) as total_xp
    FROM player_skill_levels WHERE user_id = ? GROUP BY skill_type
  `).all(userId);

  return {
    characterLevel:  bars.character_level  ?? 0,
    pendingUpgrades: bars.pending_upgrades ?? 0,
    totalUpgradesSpent: bars.total_upgrades_spent ?? 0,
    bars: {
      hp:         { current: bars.hp,         max: bars.max_hp         },
      mana:       { current: bars.mana,       max: bars.max_mana       },
      stamina:    { current: bars.stamina,    max: bars.max_stamina    },
      bio_power:  { current: bars.bio_power,  max: bars.max_bio_power  },
      perception: { current: bars.perception, max: bars.max_perception },
    },
    skillSummary,
    recentUpgrades,
  };
}
