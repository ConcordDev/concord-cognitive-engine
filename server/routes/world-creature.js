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
import { composeDrops, isHybridCorpse } from "../lib/ecosystem/procedural-meat-composer.js";
import { onLootDropped } from "../lib/gameplay-asset-bridge.js";
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

      // Living Society P0.5 — if this creature is a hybrid (has a lineage row),
      // stamp its blueprint + lineage onto the corpse so the butcher composes
      // coherently-named, propertied drops (fixing the empty-loot bug) instead
      // of a stale generic "meat". Guarded for builds without mig 280 / lineage.
      let lineageJson = null;
      let blueprintJson = null;
      try {
        const lin = db.prepare(`
          SELECT child_id, parent_a, parent_b, generation, stability, blueprint, material_profile
          FROM creature_lineage WHERE child_id = ?
        `).get(speciesId);
        if (lin) {
          blueprintJson = lin.blueprint || null;
          lineageJson = JSON.stringify({
            parent_a: lin.parent_a, parent_b: lin.parent_b, generation: lin.generation,
            stability: lin.stability, material_profile: lin.material_profile || null,
          });
        }
      } catch { /* creature_lineage / material_profile absent */ }

      const corpseId = `corpse_${crypto.randomUUID()}`;
      try {
        db.prepare(`
          INSERT INTO creature_corpses
            (id, world_id, species_id, killer_user_id, x, y, z, lineage_json, blueprint_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(corpseId, npc.world_id, speciesId, userId, npc.x, npc.y, npc.z, lineageJson, blueprintJson);
      } catch {
        // mig 280 columns absent — fall back to the legacy corpse insert.
        db.prepare(`
          INSERT INTO creature_corpses
            (id, world_id, species_id, killer_user_id, x, y, z)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(corpseId, npc.world_id, speciesId, userId, npc.x, npc.y, npc.z);
      }

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

      // Living Society P0.5 — derive drops from the (possibly hybrid) creature.
      // A hybrid's species_id is never a loot-table key, so the table path
      // returned [] (the empty-loot bug). When the corpse is a hybrid OR the
      // species has no table, compose named, propertied drops from the blueprint.
      let blueprint = null;
      try { blueprint = corpse.blueprint_json ? JSON.parse(corpse.blueprint_json) : null; } catch { blueprint = null; }
      let lineage = null;
      try { lineage = corpse.lineage_json ? JSON.parse(corpse.lineage_json) : null; } catch { lineage = null; }

      let drops = rollLoot(corpse.species_id, qualityMultiplier);
      if (isHybridCorpse(corpse) || drops.length === 0) {
        drops = composeDrops({ blueprint, lineage, speciesId: corpse.species_id, qualityMultiplier, db });
      }
      // Normalise: rollLoot entries lack item_name/properties.
      drops = drops.map((d) => ({
        item: d.item,
        item_name: d.item_name || String(d.item).replace(/-/g, " "),
        quantity: d.quantity,
        quality: d.quality,
        properties: d.properties || null,
      }));

      const insertItem = db.prepare(`
        INSERT INTO player_inventory
          (id, user_id, item_type, item_id, item_name, quantity, quality, properties_json, spoils_at)
        VALUES (?, ?, 'material', ?, ?, ?, ?, ?, ?)
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
            drop.item_name,
            drop.quantity,
            drop.quality,
            drop.properties ? JSON.stringify(drop.properties) : null,
            spoilsAt,
          );
        }
        db.prepare(`UPDATE creature_corpses SET claimed = 1 WHERE id = ?`).run(corpse.id);
      });

      try { tx(); }
      catch (e) {
        // Fall back through the legacy column shapes when properties_json
        // (mig 278) and/or spoils_at (mig 095) are absent on this build.
        const msg = String(e?.message || "");
        if (msg.includes("properties_json") || msg.includes("spoils_at")) {
          const legacy = db.prepare(`
            INSERT INTO player_inventory
              (id, user_id, item_type, item_id, item_name, quantity, quality)
            VALUES (?, ?, 'material', ?, ?, ?, ?)
          `);
          const tx2 = db.transaction(() => {
            for (const drop of drops) {
              legacy.run(crypto.randomUUID(), userId, drop.item, drop.item_name, drop.quantity, drop.quality);
            }
            db.prepare(`UPDATE creature_corpses SET claimed = 1 WHERE id = ?`).run(corpse.id);
          });
          tx2();
        } else { throw e; }
      }

      // N4-EVO: register each loot drop as an evolvable asset (best-effort,
      // kill-switched). The bridge absorbs its own throws.
      if (process.env.CONCORD_EVO_ASSET_GAMEPLAY !== '0') {
        for (const drop of drops) {
          try {
            onLootDropped(db, {
              lootId: drop.item, killerId: userId, victimId: corpse.species_id,
              label: drop.item_name, payload: drop.properties,
            });
          } catch { /* evo-asset best-effort */ }
        }
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
