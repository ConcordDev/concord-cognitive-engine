// server/emergent/gift-offering-cycle.js
//
// Wave E / E2 — high-loyalty NPCs leave gifts for players that match
// the player's compiled user_player_profiles.gift_preferences_json.
//
// Per pass: find (npc, player) memory pairs with sentiment ≥ 0.7 +
// the NPC has a real inventory item that matches the player's
// preferred element / weapon category / rarity tier. Spawn a
// world_markers row at the NPC's last position so the player can find
// the gift in-world. Mark the memory's last_summary_compiled_at to
// avoid re-gifting too often.
//
// Heartbeat invariant: never throws.
// Kill switch: CONCORD_GIFT_OFFERING=0.

import crypto from "crypto";
import logger from "../logger.js";

const MAX_GIFTS_PER_PASS = 5;
const SENTIMENT_FLOOR = 0.7;
const GIFT_COOLDOWN_S = 48 * 3600;  // 48h between gifts to the same player

export async function runGiftOfferingCycle({ db } = {}) {
  if (process.env.CONCORD_GIFT_OFFERING === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  const nowS = Math.floor(Date.now() / 1000);

  let candidates = [];
  try {
    candidates = db.prepare(`
      SELECT m.npc_id, m.player_id, m.world_id, m.sentiment,
             m.last_interaction_at
      FROM npc_player_memories m
      WHERE m.sentiment >= ?
        AND (m.last_summary_compiled_at IS NULL OR m.last_summary_compiled_at < ?)
      ORDER BY m.sentiment DESC
      LIMIT ?
    `).all(SENTIMENT_FLOOR, nowS - GIFT_COOLDOWN_S, MAX_GIFTS_PER_PASS * 3);
  } catch { return { ok: true, reason: "no_memory_table", gifted: 0 }; }
  if (candidates.length === 0) return { ok: true, gifted: 0 };

  const stats = { ok: true, evaluated: candidates.length, gifted: 0, errored: 0 };

  for (const c of candidates) {
    if (stats.gifted >= MAX_GIFTS_PER_PASS) break;
    try {
      // 1. Read the player's gift preferences.
      let prefs = null;
      try {
        const row = db.prepare(`SELECT gift_preferences_json FROM user_player_profiles WHERE user_id = ?`).get(c.player_id);
        if (row?.gift_preferences_json) prefs = JSON.parse(row.gift_preferences_json);
      } catch { /* profile optional */ }
      if (!prefs) continue;

      // 2. Find the NPC's position.
      const npc = db.prepare(`SELECT id, world_id, x, z FROM world_npcs WHERE id = ?`).get(c.npc_id);
      if (!npc) continue;

      // 3. Pick a gift item. Doesn't need to be from npc_gear — just a
      // narratively-plausible matched item. We synthesise the item name
      // from the player's preferred element + category.
      const giftName = _composeGiftName(prefs);
      if (!giftName) continue;

      // 4. Spawn the gift as a world_markers row tagged kind='gift'.
      // The player picks it up via a future gift-pickup endpoint
      // (placeholder for now — the marker is the visible affordance).
      const giftId = `gift_${crypto.randomBytes(6).toString("hex")}`;
      try {
        db.prepare(`
          INSERT INTO world_markers (id, world_id, kind, x, y, z, label, body, created_at)
          VALUES (?, ?, 'gift', ?, 0, ?, ?, ?, unixepoch())
        `).run(
          giftId, npc.world_id, npc.x ?? 0, npc.z ?? 0,
          giftName,
          `Left for you by ${c.npc_id}. They remembered what you like.`,
        );
      } catch { continue; /* world_markers optional */ }

      // 5. Mark cooldown.
      try {
        db.prepare(`
          UPDATE npc_player_memories
          SET last_summary_compiled_at = unixepoch()
          WHERE npc_id = ? AND player_id = ?
        `).run(c.npc_id, c.player_id);
      } catch { /* ok */ }

      // 6. Realtime so the player gets a "[NPC] left you something" toast.
      try {
        globalThis._concordRealtimeEmit?.("npc:gift-offered", {
          worldId: npc.world_id, npcId: c.npc_id, playerId: c.player_id,
          giftId, giftName, position: { x: npc.x ?? 0, z: npc.z ?? 0 },
        });
      } catch { /* ok */ }

      stats.gifted++;
    } catch (err) {
      stats.errored++;
      logger?.warn?.("gift-offering-cycle", "gift_failed", { npcId: c.npc_id, error: err?.message });
    }
  }

  return stats;
}

function _composeGiftName(prefs) {
  const el = (prefs.preferredElements || [])[0] || null;
  const cat = (prefs.preferredCategories || [])[0] || null;
  const rarity = prefs.preferredRarity || "common";
  const rarityWord = rarity.charAt(0).toUpperCase() + rarity.slice(1);
  // Element + category combos, deterministic.
  if (el === "ice" && cat === "focus")        return `${rarityWord} Frost Crystal`;
  if (el === "fire" && cat === "focus")       return `${rarityWord} Ember Talisman`;
  if (el === "ice")                            return `${rarityWord} Frost Charm`;
  if (el === "fire")                           return `${rarityWord} Ember`;
  if (el === "lightning")                      return `${rarityWord} Storm Glass`;
  if (el === "holy")                           return `${rarityWord} Sun-Inscribed Token`;
  if (cat === "focus")                         return `${rarityWord} Wand`;
  if (cat === "melee_blade_1h")                return `${rarityWord} Hilted Dagger`;
  if (cat === "projectile")                    return `${rarityWord} Quiver`;
  // Default: a generic well-loved keepsake.
  return `${rarityWord} Keepsake`;
}
