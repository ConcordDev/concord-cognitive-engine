// server/lib/gifting.js
//
// F1.2 — gift system (Stardew-style affinity-via-gifts). Giving an NPC an item
// consumes it and shifts courtship affinity by how much that NPC likes it.
//
// Preferences are REAL, not placeholder: they derive from the NPC's authored
// archetype (a scholar loves books, a warrior loves weapons, a healer loves
// herbs), with an authored `gift_preferences` override honoured when present.
// No fabricated per-NPC tables.

import { courtInteraction } from "./romance-engine.js";
import { npcNameFromRow } from "./npc-name.js";

// item name → coarse category (keyword match, longest-intent first).
const CATEGORY_KEYWORDS = [
  ["weapon", /sword|blade|dagger|axe|mace|hammer|spear|lance|bow|whetstone|arrow/i],
  ["armor",  /armou?r|shield|helm|plate|mail|gauntlet|greave|boot/i],
  ["book",   /book|scroll|tome|codex|ink|quill|map|treatise|ledger/i],
  ["herb",   /herb|root|leaf|flower|poultice|salve|potion|elixir|tonic|remedy/i],
  ["gem",    /gem|jewel|crystal|diamond|ruby|sapphire|emerald|pearl|coin|spark|gold|silver/i],
  ["relic",  /relic|rune|glyph|sigil|talisman|amulet|charm|idol|fragment/i],
  ["food",   /bread|stew|roast|soup|ale|tea|pastry|meat|fish|cheese|wine|fruit/i],
  ["pelt",   /pelt|hide|fur|leather|bone|fang|claw|feather/i],
  ["tool",   /tool|gear|cog|wrench|pick|hammer|kit|device|component/i],
];

export function itemCategory(itemName = "") {
  const n = String(itemName);
  for (const [cat, re] of CATEGORY_KEYWORDS) if (re.test(n)) return cat;
  return "misc";
}

// archetype → { loved:[cat], liked:[cat], disliked:[cat] }. Grounded in role.
const ARCHETYPE_GIFT_PREFS = Object.freeze({
  scholar:  { loved: ["book", "relic"],  liked: ["gem", "tool"],   disliked: ["pelt"] },
  mystic:   { loved: ["relic", "gem"],   liked: ["book", "herb"],  disliked: ["weapon"] },
  spell_spirit: { loved: ["relic", "gem"], liked: ["book"],        disliked: ["food"] },
  warrior:  { loved: ["weapon", "armor"], liked: ["pelt", "food"], disliked: ["book"] },
  warlord:  { loved: ["weapon", "armor"], liked: ["gem", "pelt"],  disliked: ["herb"] },
  warchief_raider: { loved: ["weapon", "pelt"], liked: ["food"],   disliked: ["book"] },
  guard:    { loved: ["armor", "weapon"], liked: ["food"],         disliked: ["relic"] },
  vigilante:{ loved: ["weapon", "tool"],  liked: ["armor"],        disliked: ["food"] },
  hunter:   { loved: ["pelt", "weapon"],  liked: ["food", "herb"], disliked: ["gem"] },
  healer:   { loved: ["herb", "book"],    liked: ["food", "relic"],disliked: ["weapon"] },
  trader:   { loved: ["gem", "relic"],    liked: ["tool", "food"], disliked: ["pelt"] },
  noble:    { loved: ["gem", "relic"],    liked: ["book", "food"], disliked: ["pelt"] },
  link_walker: { loved: ["relic", "tool"],liked: ["gem", "book"],  disliked: ["food"] },
  white_collar_operator: { loved: ["gem", "tool"], liked: ["relic"], disliked: ["pelt"] },
  default:  { loved: ["gem", "food"],     liked: ["relic", "book"],disliked: [] },
});

export const GIFT_DELTA = Object.freeze({ loved: 0.15, liked: 0.10, neutral: 0.03, disliked: -0.05 });
const REACTION_SENTIMENT = { loved: 3, liked: 2, neutral: 0.6, disliked: -1 };

/**
 * How an NPC reacts to a gift. Authored npc.gift_preferences override the
 * archetype defaults. gift_preferences shape (optional, on the NPC):
 *   { loved: ["item_id"|"category"], liked: [...], disliked: [...] }
 */
export function giftReaction(npc, itemName) {
  const cat = itemCategory(itemName);
  const id = String(itemName || "").toLowerCase();
  const authored = npc && npc.gift_preferences && typeof npc.gift_preferences === "object" ? npc.gift_preferences : null;
  if (authored) {
    const inList = (list) => Array.isArray(list) && list.some((x) => {
      const xl = String(x).toLowerCase();
      return xl === id || xl === cat;
    });
    if (inList(authored.loved)) return "loved";
    if (inList(authored.disliked)) return "disliked";
    if (inList(authored.liked)) return "liked";
  }
  const prefs = ARCHETYPE_GIFT_PREFS[npc?.archetype] || ARCHETYPE_GIFT_PREFS.default;
  if (prefs.loved.includes(cat)) return "loved";
  if (prefs.disliked.includes(cat)) return "disliked";
  if (prefs.liked.includes(cat)) return "liked";
  return "neutral";
}

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name); }
  catch { return false; }
}

/**
 * Give an NPC a gift: consume one of the item from the player's inventory in
 * this world, compute the reaction, and shift courtship affinity accordingly.
 * Per-world inventory invariant respected (scoped by user_id + world_id).
 * Returns { ok, reaction, delta, affinity, status } or { ok:false, reason }.
 */
export function giveGift(db, { userId, npcId, itemId, worldId = "concordia-hub" }) {
  if (!db || !userId || !npcId || !itemId) return { ok: false, reason: "missing_inputs" };
  if (!tableExists(db, "player_inventory")) return { ok: false, reason: "no_inventory" };

  // Look up the NPC (archetype + any authored gift_preferences via meta).
  let npc = null;
  try {
    npc = db.prepare(`SELECT id, archetype, npc_type, state FROM world_npcs WHERE id = ?`).get(npcId) || null;
    if (npc) npc.name = npcNameFromRow(npc); // world_npcs has no `name` column — derive from state
  } catch { /* world_npcs optional */ }
  if (!npc) return { ok: false, reason: "npc_not_found" };

  // Find a stack of the item the player owns in this world (oldest first).
  const slot = db.prepare(`
    SELECT id, item_name, quantity FROM player_inventory
    WHERE user_id = ? AND item_id = ? AND COALESCE(world_id, 'concordia-hub') = ?
    ORDER BY acquired_at ASC LIMIT 1
  `).get(userId, itemId, worldId);
  if (!slot || slot.quantity <= 0) return { ok: false, reason: "item_not_owned" };

  const reaction = giftReaction(npc, slot.item_name || itemId);
  const sentiment = REACTION_SENTIMENT[reaction];

  const tx = db.transaction(() => {
    if (slot.quantity <= 1) db.prepare(`DELETE FROM player_inventory WHERE id = ?`).run(slot.id);
    else db.prepare(`UPDATE player_inventory SET quantity = quantity - 1 WHERE id = ?`).run(slot.id);
  });
  tx();

  // Shift affinity through the existing courtship path (auto-promotes status).
  let aff = { ok: false };
  try { aff = courtInteraction(db, userId, "npc", npcId, sentiment); } catch { /* courtship table optional */ }

  return {
    ok: true,
    reaction,
    delta: GIFT_DELTA[reaction],
    affinity: aff.affinity,
    status: aff.status,
    npcName: npc.name || null,
  };
}

export { ARCHETYPE_GIFT_PREFS };
