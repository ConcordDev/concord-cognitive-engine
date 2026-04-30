// server/routes/npc-shop.js
// NPC vendor system. NPCs sell physical goods (materials, basic tools) for Sparks only.
// CC is never accepted here — virtual items have no real-world value.
// Mounted at /api/npc-shop.

import { Router } from "express";
import crypto from "crypto";
import { spendSparks, getBalances } from "../lib/currency.js";

// Hard-coded NPC shops. In the future these can be seeded per-world.
const NPC_SHOPS = {
  "merchant_01": {
    name: "Mara the Merchant",
    worldId: "concordia-hub",
    inventory: [
      { id: "stone",       name: "Stone",          price: 2,  quantity: 99, itemType: "material" },
      { id: "wood",        name: "Wood",            price: 3,  quantity: 99, itemType: "material" },
      { id: "clay",        name: "Clay",            price: 2,  quantity: 99, itemType: "material" },
      { id: "sand",        name: "Sand",            price: 1,  quantity: 99, itemType: "material" },
      { id: "coal",        name: "Coal",            price: 5,  quantity: 50, itemType: "material" },
    ],
  },
  "smith_01": {
    name: "Dorin the Smith",
    worldId: "concordia-hub",
    inventory: [
      { id: "iron_ore",    name: "Iron Ore",        price: 12, quantity: 30, itemType: "material" },
      { id: "copper_wire", name: "Copper Wire",     price: 18, quantity: 20, itemType: "material" },
      { id: "steel",       name: "Steel Ingot",     price: 40, quantity: 15, itemType: "material" },
      { id: "rubber",      name: "Rubber",          price: 15, quantity: 20, itemType: "material" },
    ],
  },
  "mystic_01": {
    name: "Selene the Mystic",
    worldId: "concordia-hub",
    inventory: [
      { id: "glass",       name: "Glass Pane",      price: 8,  quantity: 40, itemType: "material" },
      { id: "lens_crystal",name: "Lens Crystal",    price: 80, quantity: 5,  itemType: "material" },
      { id: "mythril_ore", name: "Mythril Ore",     price: 250,quantity: 3,  itemType: "material" },
      { id: "dragon_stone",name: "Dragon Stone",    price: 500,quantity: 1,  itemType: "material" },
    ],
  },
};

export default function createNPCShopRouter({ requireAuth, db }) {
  const router = Router();
  const auth = requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  // GET /api/npc-shop — list all NPC shops
  router.get("/", (_req, res) => {
    const shops = Object.entries(NPC_SHOPS).map(([id, shop]) => ({
      id,
      name: shop.name,
      worldId: shop.worldId,
      itemCount: shop.inventory.length,
    }));
    res.json({ ok: true, shops });
  });

  // GET /api/npc-shop/:npcId — get shop inventory + player's Sparks balance
  router.get("/:npcId", auth, (req, res) => {
    try {
      const shop = NPC_SHOPS[req.params.npcId];
      if (!shop) return res.status(404).json({ ok: false, error: "shop_not_found" });
      const { sparks } = getBalances(db, _userId(req));
      res.json({ ok: true, shop: { ...shop, id: req.params.npcId }, sparks });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  // POST /api/npc-shop/:npcId/buy — purchase an item with Sparks
  router.post("/:npcId/buy", auth, (req, res) => {
    try {
      const userId = _userId(req);
      const shop = NPC_SHOPS[req.params.npcId];
      if (!shop) return res.status(404).json({ ok: false, error: "shop_not_found" });

      const { itemId, quantity = 1 } = req.body;
      if (!itemId || quantity < 1) return res.status(400).json({ ok: false, error: "itemId and quantity required" });

      const item = shop.inventory.find(i => i.id === itemId);
      if (!item) return res.status(404).json({ ok: false, error: "item_not_in_shop" });
      if (quantity > item.quantity) return res.status(400).json({ ok: false, error: "insufficient_stock" });

      const totalCost = item.price * quantity;

      // Spend Sparks (throws if insufficient)
      const newBalance = spendSparks(db, userId, totalCost, `npc_purchase:${itemId}:${quantity}`, shop.worldId);

      // Add to player inventory
      const existing = db.prepare(`SELECT id, quantity FROM player_inventory WHERE user_id = ? AND item_id = ?`).get(userId, itemId);
      if (existing) {
        db.prepare(`UPDATE player_inventory SET quantity = quantity + ? WHERE id = ?`).run(quantity, existing.id);
      } else {
        db.prepare(`
          INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quantity, quality)
          VALUES (?, ?, ?, ?, ?, ?, 50)
        `).run(crypto.randomUUID(), userId, item.itemType, itemId, item.name, quantity);
      }

      res.json({ ok: true, purchased: { itemId, name: item.name, quantity, totalCost }, newSparksBalance: newBalance });
    } catch (err) {
      if (err.message === "insufficient_sparks") {
        return res.status(402).json({ ok: false, error: "insufficient_sparks" });
      }
      res.status(500).json({ ok: false, error: 'An unexpected error occurred' });
    }
  });

  return router;
}
