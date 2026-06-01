// server/domains/enchantment.js — G6 enchant macros. Consume a soul gem + essence
// to imbue an item; the gem tier caps the power. See lib/enchantment.js.

import { enchant, listEnchantments, enchantmentEnabled } from "../lib/enchantment.js";

export default function registerEnchantmentMacros(register) {
  register("enchantment", "enchant", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    if (!enchantmentEnabled()) return { ok: false, reason: "disabled" };
    return enchant(db, userId, input.worldId, {
      itemId: input.itemId, gemItemId: input.gemItemId, essenceItemId: input.essenceItemId, buildingId: input.buildingId,
    });
  }, { note: "Enchant an item with a soul gem + essence; the gem tier caps the potency." });

  register("enchantment", "list", (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input.itemId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, enchantments: listEnchantments(db, userId, input.itemId) };
  }, { note: "List the enchantments on one of the player's items." });
}
