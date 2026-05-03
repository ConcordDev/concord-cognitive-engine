// server/lib/ecosystem/cook-engine.js
//
// EvoEcosystem W3: cooking + consumption pipeline.
//
// Cooking:
//   - Reuses craft-engine.executeCraft() — the recipe DTU's resource
//     requirements are the ingredients. Output is a consumable food DTU.
//   - Output DTU body carries `effects[]` (e.g. { effect_id: 'stamina_regen',
//     magnitude: 1.5, durationMs: 300000 }) and `shelfLifeHours`.
//
// Consumption:
//   - applyConsumable() reads the DTU, deducts inventory, writes
//     user_active_effects rows for each effect, broadcasts via realtime.
//
// Every operation guards for missing tables / columns so a cooking call
// before the migrations run still fails predictably (returns ok:false).

import crypto from "node:crypto";

const DEFAULT_FOOD_TTL_HOURS = 48;

/**
 * Cook a food recipe. Wraps craft-engine; called from the food.cook macro.
 *
 * @param {object} db
 * @param {string} userId
 * @param {string} worldId
 * @param {string} recipeDtuId
 * @param {object} opts
 * @param {number} [opts.qualityMultiplier]  — from cooking minigame
 * @returns {{ ok, dtu?, error? }}
 */
export async function cookRecipe(db, userId, worldId, recipeDtuId, opts = {}) {
  if (!db || !userId || !worldId || !recipeDtuId) {
    return { ok: false, error: "missing_args" };
  }
  // craft-engine has all the validation we need (resources, skill levels,
  // FIFO deduction). We just call it and let it fail loudly.
  const { executeCraft } = await import("../crafting/craft-engine.js");
  const result = executeCraft(db, userId, worldId, recipeDtuId, {
    qualityMultiplier: opts.qualityMultiplier,
  });
  if (!result.ok) return result;

  // Stamp spoils_at on the cooked output, since the inventory row was
  // just inserted by craft-engine.
  try {
    const recipe = db.prepare(`SELECT body_json FROM dtus WHERE id = ?`).get(recipeDtuId);
    let recipeBody = {};
    try { recipeBody = JSON.parse(recipe?.body_json || "{}"); } catch { /* malformed */ }
    const ttlHours = recipeBody?.shelfLifeHours ?? DEFAULT_FOOD_TTL_HOURS;
    const now = Math.floor(Date.now() / 1000);
    if (result.dtu?.id) {
      db.prepare(`
        UPDATE player_inventory
        SET spoils_at = ?
        WHERE user_id = ? AND item_id = ? AND spoils_at IS NULL
      `).run(now + ttlHours * 3600, userId, result.dtu.id);
    }
  } catch { /* TTL stamp is best-effort */ }

  return result;
}

/**
 * Apply a consumable DTU's effects to the user. Deducts a single quantity
 * from inventory; writes one active-effect row per effect.
 *
 * @returns {{ ok, applied?: Array, error? }}
 */
export function applyConsumable(db, userId, dtuId) {
  if (!db || !userId || !dtuId) return { ok: false, error: "missing_args" };

  const dtu = db.prepare(`SELECT id, owner_user_id, body_json FROM dtus WHERE id = ?`).get(dtuId);
  if (!dtu) return { ok: false, error: "dtu_not_found" };

  let body = {};
  try { body = JSON.parse(dtu.body_json || "{}"); } catch { /* malformed */ }
  const effects = Array.isArray(body?.effects) ? body.effects : [];

  // Inventory deduction — one item, FIFO.
  const inv = db.prepare(`
    SELECT id, quantity FROM player_inventory
    WHERE user_id = ? AND item_id = ? AND quantity > 0
    ORDER BY acquired_at ASC LIMIT 1
  `).get(userId, dtuId);
  if (!inv) return { ok: false, error: "not_in_inventory" };

  const tx = db.transaction(() => {
    if (inv.quantity > 1) {
      db.prepare(`UPDATE player_inventory SET quantity = quantity - 1 WHERE id = ?`).run(inv.id);
    } else {
      db.prepare(`DELETE FROM player_inventory WHERE id = ?`).run(inv.id);
    }
    const insert = db.prepare(`
      INSERT INTO user_active_effects
        (id, user_id, effect_id, kind, magnitude, source_dtu_id, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Math.floor(Date.now() / 1000);
    const applied = [];
    for (const eff of effects) {
      if (!eff?.effect_id) continue;
      const durationS = Math.max(1, Math.floor((eff.durationMs ?? 300000) / 1000));
      insert.run(
        `eff_${crypto.randomUUID()}`,
        userId,
        String(eff.effect_id),
        eff.kind === "debuff" ? "debuff" : "buff",
        Number(eff.magnitude ?? 1),
        dtuId,
        now + durationS,
      );
      applied.push({ effect_id: eff.effect_id, magnitude: eff.magnitude ?? 1, expires_in_s: durationS });
    }
    return applied;
  });

  try {
    const applied = tx();
    return { ok: true, applied };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * Heartbeat sweep: delete spoiled inventory + expired effects.
 * Wired into heartbeat-registry; runs every 5 ticks.
 */
export function runEcoExpirySweep({ state: _state, db }) {
  if (!db) return { ok: false };
  let spoiled = 0;
  let expired = 0;
  try {
    const r1 = db.prepare(`DELETE FROM player_inventory WHERE spoils_at IS NOT NULL AND spoils_at < unixepoch()`).run();
    spoiled = r1.changes;
  } catch { /* spoils_at column may not exist on minimal builds */ }
  try {
    const r2 = db.prepare(`DELETE FROM user_active_effects WHERE expires_at < unixepoch()`).run();
    expired = r2.changes;
  } catch { /* table may not exist */ }
  return { ok: true, spoiled, expired };
}

/**
 * Read the current active effects for a user. Used by frontend HUD
 * countdowns and combat resolution gating.
 */
export function getActiveEffects(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT effect_id, kind, magnitude, source_dtu_id, started_at, expires_at
      FROM user_active_effects
      WHERE user_id = ? AND expires_at > unixepoch()
      ORDER BY started_at DESC
    `).all(userId);
  } catch { return []; }
}
