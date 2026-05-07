// server/routes/player-inventory.js
// Player physical inventory (items in player_inventory table).
// Distinct from /api/inventory (codebase inventory scanner).

import crypto from "crypto";
import { Router } from "express";
import { getItemEffectiveness, effectivenessLabel, listPlayerKnowledge, learnSchematic } from "../lib/item-knowledge.js";

export default function createPlayerInventoryRouter({ requireAuth, db }) {
  const router = Router();

  // GET /api/player-inventory?worldId=… — list current player's items in
  // a specific world. world_id was added to player_inventory in
  // migration 101 so a player's inventory follows them per world rather
  // than spilling across all worlds. Defaults to the canonical hub when
  // the caller doesn't specify (legacy clients).
  router.get("/", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const worldId = String(req.query.worldId || "concordia-hub");
      const items  = db.prepare(
        'SELECT * FROM player_inventory WHERE user_id = ? AND world_id = ? ORDER BY acquired_at DESC'
      ).all(userId, worldId);

      const playerSkills = _getPlayerSkills(db, userId);
      const enriched = items.map(item => {
        const eff = getItemEffectiveness(db, userId, item.schema_id ?? null, item.item_type, playerSkills);
        return {
          ...item,
          effectiveness:      eff.effectiveness,
          effectivenessLabel: effectivenessLabel(eff),
          hasKnowledge:       eff.hasKnowledge,
        };
      });

      res.json({ ok: true, items: enriched, worldId });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/player-inventory/:userId?worldId=…  — admin/debug: another
  // player's items. World scope optional; without it, returns ALL of
  // their items across worlds (admin debugging).
  router.get("/:userId", requireAuth, (req, res) => {
    try {
      const worldId = req.query.worldId ? String(req.query.worldId) : null;
      const items = worldId
        ? db.prepare('SELECT * FROM player_inventory WHERE user_id = ? AND world_id = ? ORDER BY acquired_at DESC').all(req.params.userId, worldId)
        : db.prepare('SELECT * FROM player_inventory WHERE user_id = ? ORDER BY acquired_at DESC').all(req.params.userId);
      res.json({ ok: true, items, worldId: worldId || null });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/player-inventory/use  — use / consume an item; returns effectiveness
  router.post("/use", requireAuth, (req, res) => {
    try {
      const userId = req.user.id;
      const { itemId } = req.body;

      const item = db.prepare(
        'SELECT * FROM player_inventory WHERE id = ? AND user_id = ?'
      ).get(itemId, userId);
      if (!item) return res.status(404).json({ ok: false, error: 'item_not_found' });

      const playerSkills = _getPlayerSkills(db, userId);
      const eff = getItemEffectiveness(db, userId, item.schema_id ?? null, item.item_type, playerSkills);

      // Consumable items decrement on use
      if (item.item_type === 'consumable') {
        if (item.quantity > 1) {
          db.prepare('UPDATE player_inventory SET quantity = quantity - 1 WHERE id = ?').run(item.id);
        } else {
          db.prepare('DELETE FROM player_inventory WHERE id = ?').run(item.id);
        }
      }

      res.json({
        ok:                 true,
        itemId,
        itemName:           item.item_name,
        effectiveness:      eff.effectiveness,
        effectivenessLabel: effectivenessLabel(eff),
        hasKnowledge:       eff.hasKnowledge,
        explanation:        eff.explanation,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/player-inventory/knowledge  — list all schematics this player knows
  router.get("/knowledge", requireAuth, (req, res) => {
    try {
      res.json({ ok: true, knowledge: listPlayerKnowledge(db, req.user.id) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // POST /api/player-inventory/knowledge/learn  — consume a schematic item to learn it
  router.post("/knowledge/learn", requireAuth, (req, res) => {
    try {
      const { schemaId, itemType, itemName } = req.body;
      if (!schemaId) return res.status(400).json({ ok: false, error: 'schemaId required' });

      // Player must possess the schematic
      const hasSchematic = db.prepare(
        "SELECT id FROM player_inventory WHERE user_id = ? AND item_type = 'schematic' AND schema_id = ?"
      ).get(req.user.id, schemaId);
      if (!hasSchematic) {
        return res.status(403).json({ ok: false, error: 'schematic_not_in_inventory' });
      }

      const learned = learnSchematic(db, req.user.id, schemaId, itemType ?? 'item', itemName ?? 'Unknown', 'schematic_found');
      if (!learned) return res.json({ ok: true, alreadyKnown: true });

      // Consume the schematic on learn
      db.prepare('DELETE FROM player_inventory WHERE id = ?').run(hasSchematic.id);

      res.json({ ok: true, learned: true, schemaId, itemName });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _getPlayerSkills(db, userId) {
  try {
    const skills = db.prepare(
      "SELECT type, skill_level FROM dtus WHERE owner_id = ? AND type = 'skill' AND owner_type = 'user'"
    ).all(userId);
    const map = {};
    for (const s of skills) map[s.type] = Math.round(s.skill_level ?? 0);
    return map;
  } catch {
    return {};
  }
}
