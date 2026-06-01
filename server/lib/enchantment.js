// server/lib/enchantment.js
//
// G6 — enchantment. Consume a soul gem + an essence to add an affinity-typed
// effect to an existing item. The load-bearing piece the audit found missing is
// the HARD TIER-LOCK: the soul gem's tier CAPS the enchant potency (a petty gem
// can never make a black-tier enchant, no matter the skill/station). The essence
// sets the affinity/effect; resolveCraft drives the roll + soft backfire (a ruined
// enchant shatters the gem + a minor debuff). Reuses the resource catalog + the G1
// station tiers. Kill-switch CONCORD_ENCHANTMENT=0.

import crypto from "node:crypto";
import { resolveCraft } from "./craft-resolve.js";
import { stationQualityFor } from "./crafting/station-tiers.js";

// Soul-gem tier → the potency CEILING it can imbue. THE tier-lock.
export const SOUL_GEM_CAP = Object.freeze({
  petty_soul_gem: 40,
  grand_soul_gem: 75,
  black_soul_gem: 95,
});
const GEM_TIER = Object.freeze({ petty_soul_gem: "petty", grand_soul_gem: "grand", black_soul_gem: "black" });

// essence affinity → the effect it grants.
const AFFINITY_EFFECT = Object.freeze({
  bio: "life_steal", magic: "spell_power", physical: "sharpness", chaos: "volatile_edge", tech: "overclock",
});

export function enchantmentEnabled() {
  return process.env.CONCORD_ENCHANTMENT !== "0";
}

function ownedQty(db, userId, itemId) {
  try { return Number(db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM player_inventory WHERE user_id=? AND item_id=?").get(userId, itemId)?.n) || 0; }
  catch { return 0; }
}
function consumeOne(db, userId, itemId) {
  const slot = db.prepare("SELECT id, quantity FROM player_inventory WHERE user_id=? AND item_id=? ORDER BY acquired_at ASC").get(userId, itemId);
  if (!slot) return false;
  if (slot.quantity <= 1) db.prepare("DELETE FROM player_inventory WHERE id=?").run(slot.id);
  else db.prepare("UPDATE player_inventory SET quantity = quantity - 1 WHERE id=?").run(slot.id);
  return true;
}
function craftingSkill(db, userId) {
  try { return Number(db.prepare("SELECT MAX(level) lvl FROM player_skill_levels WHERE user_id=? AND skill_type IN ('enchanting','crafting','smithing')").get(userId)?.lvl) || 0; }
  catch { return 0; }
}

/**
 * Enchant `itemId` with a gem + essence. The gem tier caps the potency; the
 * essence sets the affinity/effect. Returns { ok, enchantment } / { ok:false } —
 * or a soft failure ({ ok:true, failed:true, debuff }) on a backfire.
 */
export function enchant(db, userId, worldId, { itemId, gemItemId, essenceItemId, buildingId = null } = {}) {
  if (!enchantmentEnabled()) return { ok: false, reason: "disabled" };
  if (!db || !userId || !itemId || !gemItemId || !essenceItemId) return { ok: false, reason: "missing_inputs" };
  if (!(gemItemId in SOUL_GEM_CAP)) return { ok: false, reason: "not_a_soul_gem" };
  if (ownedQty(db, userId, gemItemId) < 1) return { ok: false, reason: "no_gem" };
  if (ownedQty(db, userId, essenceItemId) < 1) return { ok: false, reason: "no_essence" };

  const stationQuality = stationQualityFor(db, worldId, buildingId);
  const resolved = resolveCraft({
    inputs: [{ itemId: gemItemId, qty: 1 }, { itemId: essenceItemId, qty: 1 }],
    recipe: { name: `enchant:${itemId}` },
    playerSkill: craftingSkill(db, userId),
    stationQuality,
    risk: 0.1,
    db,
  });
  const failed = !!resolved.failed;
  const cap = SOUL_GEM_CAP[gemItemId];
  const potency = Math.min(Math.round(resolved.outputPotency), cap); // THE tier-lock
  const affinity = resolved.outputAffinity || "magic";
  const effectId = AFFINITY_EFFECT[affinity] || "empower";

  try {
    db.transaction(() => {
      consumeOne(db, userId, gemItemId);
      consumeOne(db, userId, essenceItemId);
      if (!failed) {
        db.prepare(`
          INSERT INTO item_enchantments (id, user_id, world_id, item_id, affinity, potency, effect_id, gem_tier, essence_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), userId, worldId || null, itemId, affinity, potency, effectId, GEM_TIER[gemItemId], essenceItemId);
      } else if (resolved.debuff?.effect_id) {
        try {
          const d = resolved.debuff;
          const durS = Math.max(1, Math.floor((d.durationMs ?? 60000) / 1000));
          db.prepare(`INSERT INTO user_active_effects (id, user_id, effect_id, magnitude, expires_at, source) VALUES (?, ?, ?, ?, ?, 'enchant_backfire')`)
            .run(crypto.randomUUID(), userId, d.effect_id, d.magnitude, Math.floor(Date.now() / 1000) + durS);
        } catch { /* effects optional */ }
      }
    })();
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }

  if (failed) return { ok: true, failed: true, debuff: resolved.debuff, capped: cap };
  return { ok: true, failed: false, enchantment: { itemId, affinity, potency, effect: effectId, gemTier: GEM_TIER[gemItemId] }, cap };
}

export function listEnchantments(db, userId, itemId) {
  try {
    return db.prepare("SELECT item_id, affinity, potency, effect_id, gem_tier, created_at FROM item_enchantments WHERE user_id=? AND item_id=? ORDER BY created_at DESC")
      .all(userId, itemId);
  } catch { return []; }
}
