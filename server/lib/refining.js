// server/lib/refining.js
//
// G2 — refining chains (ore -> ingot -> alloy). The crafting substrate + the
// resource catalog already have ingots/alloys, but no path minted them. This is
// the thin refine path: it reuses resolveCraft (quality + backfire) and the G1
// station tiers (higher steps require a better forge), and mirrors craft-engine's
// inventory consume/add. Soft failure = mats consumed, no output, a minor debuff
// (never a throw). Kill-switch CONCORD_REFINING=0.

import crypto from "node:crypto";
import { resolveCraft } from "./craft-resolve.js";
import { stationQualityFor } from "./crafting/station-tiers.js";

// from -> the next link in the chain. minStation gates higher tiers behind better
// stations; risk rises with the tier (more value, more chance to ruin the melt).
export const REFINING_CHAINS = Object.freeze({
  iron_ore:    { to: "iron_ingot",  toName: "Iron Ingot",  inputQty: 2, outputQty: 1, minStation: 0,  risk: 0.0 },
  iron_ingot:  { to: "steel_ingot", toName: "Steel Ingot", inputQty: 3, outputQty: 1, minStation: 60, risk: 0.12 },
  steel_ingot: { to: "steel_alloy", toName: "Steel Alloy", inputQty: 4, outputQty: 1, minStation: 80, risk: 0.22 },
});

export function refiningEnabled() {
  return process.env.CONCORD_REFINING !== "0";
}

function craftingSkill(db, userId) {
  try {
    const r = db.prepare(
      "SELECT MAX(level) AS lvl FROM player_skill_levels WHERE user_id = ? AND skill_type IN ('smithing','crafting','refining')"
    ).get(userId);
    return Number(r?.lvl) || 0;
  } catch { return 0; }
}

function ownedQty(db, userId, itemId) {
  try {
    return Number(db.prepare("SELECT COALESCE(SUM(quantity),0) AS n FROM player_inventory WHERE user_id = ? AND item_id = ?").get(userId, itemId)?.n) || 0;
  } catch { return 0; }
}

/**
 * Refine `fromItemId` one step up its chain at the player's station. Returns
 * { ok, refined, outputQty, failed, outputPotency, debuff? } or { ok:false, reason }.
 */
export function refine(db, userId, worldId, fromItemId, { buildingId = null } = {}) {
  if (!refiningEnabled()) return { ok: false, reason: "disabled" };
  if (!db || !userId || !fromItemId) return { ok: false, reason: "missing_inputs" };
  const chain = REFINING_CHAINS[fromItemId];
  if (!chain) return { ok: false, reason: "not_refinable" };

  const stationQuality = stationQualityFor(db, worldId, buildingId);
  if (stationQuality < chain.minStation) {
    return { ok: false, reason: "station_too_basic", required: chain.minStation, have: stationQuality };
  }
  if (ownedQty(db, userId, fromItemId) < chain.inputQty) {
    return { ok: false, reason: "insufficient_materials", need: chain.inputQty };
  }

  const resolved = resolveCraft({
    inputs: [{ itemId: fromItemId, qty: chain.inputQty }],
    recipe: { name: chain.toName },
    playerSkill: craftingSkill(db, userId),
    stationQuality,
    risk: chain.risk,
    db,
  });
  const failed = !!resolved.failed;

  try {
    db.transaction(() => {
      // Consume the input (oldest-first), mirroring craft-engine.
      let remaining = chain.inputQty;
      const slots = db.prepare(
        "SELECT id, quantity FROM player_inventory WHERE user_id = ? AND item_id = ? ORDER BY acquired_at ASC"
      ).all(userId, fromItemId);
      const delSlot = db.prepare("DELETE FROM player_inventory WHERE id = ?");
      const decSlot = db.prepare("UPDATE player_inventory SET quantity = quantity - ? WHERE id = ?");
      for (const slot of slots) {
        if (remaining <= 0) break;
        if (slot.quantity <= remaining) {
          delSlot.run(slot.id);
          remaining -= slot.quantity;
        } else {
          decSlot.run(remaining, slot.id);
          remaining = 0;
        }
      }
      // Mats are consumed either way. Success yields the refined output; a
      // backfire ruins the melt (no output) — the soft failure the spec wants.
      if (!failed) {
        db.prepare(`
          INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality, acquired_at)
          VALUES (?, ?, 'item', ?, ?, ?, 'refined', unixepoch())
        `).run(crypto.randomUUID(), userId, chain.to, chain.toName, chain.outputQty);
      }
      // Soft-fail debuff (guarded — user_active_effects may be absent).
      if (failed && resolved.debuff?.effect_id) {
        try {
          const d = resolved.debuff;
          const durS = Math.max(1, Math.floor((d.durationMs ?? 60000) / 1000));
          db.prepare(`
            INSERT INTO user_active_effects (id, user_id, effect_id, kind, magnitude, source_dtu_id, expires_at)
            VALUES (?, ?, ?, 'debuff', ?, NULL, ?)
          `).run(crypto.randomUUID(), userId, d.effect_id, d.magnitude, Math.floor(Date.now() / 1000) + durS);
        } catch { /* effects optional */ }
      }
    })();
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }

  return {
    ok: true,
    refined: failed ? null : chain.to,
    outputQty: failed ? 0 : chain.outputQty,
    failed,
    outputPotency: resolved.outputPotency,
    stationQuality,
    debuff: failed ? resolved.debuff : null,
  };
}
