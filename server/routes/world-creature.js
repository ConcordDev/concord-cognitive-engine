// server/routes/world-creature.js
// EvoEcosystem W2: creature kill + butcher pipeline.
//
// Endpoints:
//   POST /api/world/creature/:npcId/kill        — record a creature death,
//                                                 spawn a corpse row.
//                                                 Bumps ecosystem_score down.
//   POST /api/world/creature/:corpseId/butcher  — claim corpse loot via
//                                                 the loot table; pushes
//                                                 to player_inventory with
//                                                 spoils_at TTL.
//   GET  /api/world/creature/corpses/:worldId   — list active corpses
//                                                 (for client-side markers).

import express from "express";
import crypto from "node:crypto";
import { rollLoot } from "../lib/ecosystem/loot-tables.js";
import { adjust as adjustEco } from "../lib/ecosystem/score-engine.js";
import { checkHostilityAllowed } from "../lib/concordia/neutral-zone.js";
import { isRefused } from "../lib/refusal-field.js";

const RAW_MEAT_TTL_HOURS = 24;
const RAW_FISH_TTL_HOURS = 12;
const HIDE_TTL_HOURS = 168; // hides keep ~1 week

function ttlForItem(item) {
  if (item === "raw-meat") return RAW_MEAT_TTL_HOURS;
  if (item === "raw-fish") return RAW_FISH_TTL_HOURS;
  if (item === "hide" || item === "pelt" || item === "fur" || item === "thick-pelt") return HIDE_TTL_HOURS;
  return null; // no spoilage
}

export default function createWorldCreatureRouter({ db, requireAuth, state }) {
  const router = express.Router();

  // POST /:npcId/kill — record creature death, write corpse row.
  router.post("/:npcId/kill", requireAuth, (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });

      const npc = db.prepare(`SELECT * FROM world_npcs WHERE id = ? AND archetype LIKE 'creature:%'`).get(req.params.npcId);
      if (!npc) return res.status(404).json({ ok: false, error: "creature_not_found" });
      if (npc.is_dead) return res.status(409).json({ ok: false, error: "already_dead" });

      // Great Refusal: hub world is neutral. Concordia must grant an
      // exemption before a player can kill in her territory.
      const hostility = checkHostilityAllowed(state, npc.world_id, userId);
      if (!hostility.allowed) {
        return res.status(403).json({ ok: false, error: hostility.reason });
      }
      // Sovereign's Refusal Field: if death is currently refused for this
      // world, the kill cannot complete.
      if (state && isRefused(state, npc.world_id, "death_suspended")) {
        return res.status(409).json({ ok: false, error: "death_refused_by_sovereign" });
      }

      const speciesId = String(npc.archetype).split(":")[1] || npc.name || "unknown";
      db.prepare(`UPDATE world_npcs SET is_dead = 1 WHERE id = ?`).run(npc.id);

      const corpseId = `corpse_${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO creature_corpses
          (id, world_id, species_id, killer_user_id, x, y, z)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(corpseId, npc.world_id, speciesId, userId, npc.x, npc.y, npc.z);

      // Hunting affects ecosystem_score: -1 base, -3 if the population is
      // already low (overhunt) — Concordia notices.
      try {
        const pop = db.prepare(`
          SELECT current_count, target_count FROM creature_population
          WHERE world_id = ? AND species_id = ?
        `).get(npc.world_id, speciesId);
        const overhunt = pop && pop.current_count < pop.target_count * 0.4;
        adjustEco(db, userId, npc.world_id, { ecosystem_score: overhunt ? -3 : -1 });
      } catch { /* metrics best-effort */ }

      res.json({ ok: true, corpseId, speciesId });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // POST /:corpseId/butcher — roll loot table, deposit to inventory.
  router.post("/:corpseId/butcher", requireAuth, (req, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const qualityMultiplier = Number(req.body?.qualityMultiplier ?? 1.0);

      const corpse = db.prepare(`SELECT * FROM creature_corpses WHERE id = ?`).get(req.params.corpseId);
      if (!corpse) return res.status(404).json({ ok: false, error: "corpse_not_found" });
      if (corpse.claimed) return res.status(409).json({ ok: false, error: "already_claimed" });
      if (corpse.expires_at < Math.floor(Date.now() / 1000)) {
        return res.status(410).json({ ok: false, error: "corpse_expired" });
      }
      // Only the killer can butcher (parity with PvP loot bag rules).
      if (corpse.killer_user_id && corpse.killer_user_id !== userId) {
        return res.status(403).json({ ok: false, error: "not_your_kill" });
      }

      const drops = rollLoot(corpse.species_id, qualityMultiplier);
      const insertItem = db.prepare(`
        INSERT INTO player_inventory
          (id, user_id, item_type, item_id, item_name, quantity, quality, spoils_at)
        VALUES (?, ?, 'material', ?, ?, ?, ?, ?)
      `);

      const tx = db.transaction(() => {
        const now = Math.floor(Date.now() / 1000);
        for (const drop of drops) {
          const ttlHours = ttlForItem(drop.item);
          const spoilsAt = ttlHours ? now + ttlHours * 3600 : null;
          insertItem.run(
            crypto.randomUUID(),
            userId,
            drop.item,
            drop.item.replace(/-/g, " "),
            drop.quantity,
            drop.quality,
            spoilsAt,
          );
        }
        db.prepare(`UPDATE creature_corpses SET claimed = 1 WHERE id = ?`).run(corpse.id);
      });

      try { tx(); }
      catch (e) {
        // If the spoils_at column is missing (migration 095 not yet applied)
        // fall back to the legacy insert without the TTL column.
        if (String(e?.message || "").includes("spoils_at")) {
          const legacy = db.prepare(`
            INSERT INTO player_inventory
              (id, user_id, item_type, item_id, item_name, quantity, quality)
            VALUES (?, ?, 'material', ?, ?, ?, ?)
          `);
          const tx2 = db.transaction(() => {
            for (const drop of drops) {
              legacy.run(crypto.randomUUID(), userId, drop.item, drop.item.replace(/-/g, " "), drop.quantity, drop.quality);
            }
            db.prepare(`UPDATE creature_corpses SET claimed = 1 WHERE id = ?`).run(corpse.id);
          });
          tx2();
        } else { throw e; }
      }

      res.json({ ok: true, drops });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  // GET /corpses/:worldId — active corpses for client markers.
  router.get("/corpses/:worldId", requireAuth, (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT id, world_id, species_id, killer_user_id, x, y, z, expires_at
        FROM creature_corpses
        WHERE world_id = ? AND claimed = 0 AND expires_at > unixepoch()
        ORDER BY created_at DESC
        LIMIT 200
      `).all(req.params.worldId);
      res.json({ ok: true, corpses: rows });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  return router;
}
