// server/lib/item-sets.js
//
// F2.2 — set bonuses. Builds on F2.1 affixes + the equip path. Sets are
// THEME-based (real, not authored placeholders): gear sharing an elemental or
// martial theme forms a set, and wearing 2+ / 4+ pieces grants escalating
// bonuses the combat path reads. set_id is stamped on a drop by its dominant
// affix theme (so a Flaming sword + Flaming armor are both "emberforged"),
// making the system live the moment two themed pieces are equipped — no
// dormant authored-set dependency.

const SET_DEFINITIONS = Object.freeze({
  emberforged: { name: "Emberforged", theme: "fire",      bonuses: { 2: { resist: 0.05 }, 4: { elementDamagePct: 0.10, element: "fire" } } },
  rimewardens: { name: "Rimewarden",  theme: "ice",       bonuses: { 2: { resist: 0.05 }, 4: { elementDamagePct: 0.10, element: "ice" } } },
  stormcallers:{ name: "Stormcaller", theme: "lightning", bonuses: { 2: { resist: 0.05 }, 4: { elementDamagePct: 0.10, element: "lightning" } } },
  ironclad:    { name: "Ironclad",    theme: "might",      bonuses: { 2: { meleeDamagePct: 0.06 }, 4: { meleeDamagePct: 0.14, resist: 0.05 } } },
});

// affix element/id → set theme.
const ELEMENT_TO_SET = { fire: "emberforged", ice: "rimewardens", lightning: "stormcallers" };
const MIGHT_AFFIXES = new Set(["keen", "brutal", "of_power", "of_fury"]);

/**
 * Infer the set_id a dropped item belongs to from its affixes (dominant theme).
 * Returns a set id or null. Deterministic.
 */
export function setIdForAffixes(affixes) {
  if (!Array.isArray(affixes) || affixes.length === 0) return null;
  // First, any elemental affix decides the elemental set.
  for (const a of affixes) {
    if (a.element && ELEMENT_TO_SET[a.element]) return ELEMENT_TO_SET[a.element];
  }
  // Else, a might affix → ironclad.
  for (const a of affixes) {
    if (MIGHT_AFFIXES.has(a.id)) return "ironclad";
  }
  return null;
}

/**
 * Aggregate set bonuses from an equipped loadout. Counts pieces per set_id and
 * applies the highest threshold met (2 → 4). Returns the same combat-bonus
 * shape as talents/affixes: { meleeDamagePct, elementDamagePct:{}, resist }.
 */
export function getEquipmentSetBonuses(loadout) {
  const out = { meleeDamagePct: 0, elementDamagePct: {}, resist: 0, activeSets: [] };
  if (!loadout) return out;
  const slots = ["rightHand", "leftHand", "head", "body", "accessory"];
  const counts = {};
  for (const slot of slots) {
    const item = loadout[slot];
    if (!item) continue;
    // Broken gear (durability 0 with a max set) provides no set-piece benefit
    // until repaired — it stops counting toward set thresholds. NULL max ⇒
    // indestructible, always counts.
    if (item.max_durability !== null && item.max_durability !== undefined
        && Number(item.current_durability) === 0) continue;
    const sid = item.set_id || null;
    if (sid && SET_DEFINITIONS[sid]) counts[sid] = (counts[sid] || 0) + 1;
  }
  for (const [sid, n] of Object.entries(counts)) {
    const def = SET_DEFINITIONS[sid];
    // Apply every threshold the piece-count meets (2 and 4 stack).
    for (const thr of [2, 4]) {
      if (n >= thr && def.bonuses[thr]) {
        const b = def.bonuses[thr];
        if (b.meleeDamagePct) out.meleeDamagePct += b.meleeDamagePct;
        if (b.elementDamagePct && b.element) out.elementDamagePct[b.element] = (out.elementDamagePct[b.element] || 0) + b.elementDamagePct;
        if (b.resist) out.resist += b.resist;
        out.activeSets.push({ setId: sid, name: def.name, pieces: n, threshold: thr });
      }
    }
  }
  return out;
}

/** The damage multiplier + flat the player's active set bonuses add to a cast. */
export function setDamageFor(loadout, element = "none") {
  const b = getEquipmentSetBonuses(loadout);
  const mul = 1 + b.meleeDamagePct + (element && element !== "none" ? (b.elementDamagePct[element] || 0) : 0);
  return { multiplier: Math.round(mul * 1000) / 1000, activeSets: b.activeSets };
}

export { SET_DEFINITIONS };
