// server/lib/item-affixes.js
//
// F2.1 — item affixes. Rolled prefix/suffix stat modifiers on equippable items,
// read by the combat damage calc so gear genuinely changes a hit (ARPG day-1
// dopamine). Deterministic given an rng; pure aggregation so it's testable and
// the same numbers apply server-authoritatively.
//
// Affix model: each affix has a slot (prefix|suffix), a stat it modifies, an
// optional element, and a tiered value range. Rarity gates how many affixes
// roll and at what tier. Real stat effects (no flavor-only affixes):
//   enchantmentBonus → flat damage added in computeDamage (attackerStats)
//   element bonus    → extra damage when the cast element matches
//   resist           → damage reduction when worn (defender side, future-read)
//   vitality         → max-HP bonus (read by the bars/character path)

const PREFIXES = [
  { id: "keen",     stat: "enchantmentBonus", label: "Keen",     tiers: [[2, 4], [4, 7], [7, 11]] },
  { id: "brutal",   stat: "enchantmentBonus", label: "Brutal",   tiers: [[3, 6], [6, 10], [10, 16]] },
  { id: "flaming",  stat: "element", element: "fire",      label: "Flaming",  tiers: [[3, 5], [5, 9], [9, 14]] },
  { id: "frozen",   stat: "element", element: "ice",       label: "Frozen",   tiers: [[3, 5], [5, 9], [9, 14]] },
  { id: "shocking", stat: "element", element: "lightning", label: "Shocking", tiers: [[3, 5], [5, 9], [9, 14]] },
  { id: "venomous", stat: "element", element: "poison",    label: "Venomous", tiers: [[2, 4], [4, 7], [7, 11]] },
];

const SUFFIXES = [
  { id: "of_power",   stat: "enchantmentBonus", label: "of Power",   tiers: [[2, 4], [4, 8], [8, 13]] },
  { id: "of_warding", stat: "resist",           label: "of Warding", tiers: [[0.03, 0.05], [0.05, 0.09], [0.09, 0.14]] },
  { id: "of_the_bear", stat: "vitality",        label: "of the Bear", tiers: [[8, 15], [15, 28], [28, 45]] },
  { id: "of_fury",    stat: "enchantmentBonus", label: "of Fury",    tiers: [[3, 5], [5, 9], [9, 15]] },
];

// rarity → { affixCount, maxTierIndex }
const RARITY_RULES = {
  common:    { count: 0, tier: 0 },
  uncommon:  { count: 1, tier: 0 },
  rare:      { count: 2, tier: 1 },
  epic:      { count: 3, tier: 2 },
  legendary: { count: 4, tier: 2 },
};

function rollIn([min, max], rng) {
  const v = min + (max - min) * rng();
  // integer stats round; fractional (resist) keep 2dp
  return max <= 1 ? Math.round(v * 100) / 100 : Math.round(v);
}

function pick(arr, rng) { return arr[Math.floor(rng() * arr.length)]; }

/**
 * Roll affixes for an item of a given rarity. Returns an array of
 * { id, slot, stat, element?, value, label } — at most one per distinct id.
 * Deterministic given `rng`.
 */
export function rollAffixes(rarity = "common", rng = Math.random) {
  const rule = RARITY_RULES[rarity] || RARITY_RULES.common;
  if (rule.count <= 0) return [];
  const out = [];
  const usedIds = new Set();
  // Alternate prefix/suffix, prefixes first.
  for (let i = 0; i < rule.count; i++) {
    const fromPrefix = i % 2 === 0;
    const pool = fromPrefix ? PREFIXES : SUFFIXES;
    let def = pick(pool, rng);
    let guard = 0;
    while (usedIds.has(def.id) && guard++ < 8) def = pick(pool, rng);
    if (usedIds.has(def.id)) continue;
    usedIds.add(def.id);
    const tierIdx = Math.min(rule.tier, def.tiers.length - 1);
    out.push({
      id: def.id,
      slot: fromPrefix ? "prefix" : "suffix",
      stat: def.stat,
      element: def.element || null,
      value: rollIn(def.tiers[tierIdx], rng),
      label: def.label,
      tier: tierIdx + 1,
    });
  }
  return out;
}

// A broken item (durability 0 with a max set) contributes NOTHING until
// repaired — this is the load-bearing "broken gear is dead weight" rule.
// Items with a NULL max_durability are indestructible and always count.
function gearIsBroken(item) {
  if (!item) return false;
  const max = item.max_durability;
  if (max === null || max === undefined) return false;
  return Number(item.current_durability) === 0;
}

function parseAffixes(item) {
  if (!item) return [];
  if (gearIsBroken(item)) return []; // broken gear → no affix benefit
  const raw = item.affixes_json;
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; }
  catch { return []; }
}

/**
 * Aggregate combat bonuses from a loadout's equipped items' affixes.
 * Returns { enchantmentBonus, elementBonus:{fire,ice,...}, resist, vitality }.
 * A loadout is the shape getLoadout() returns (slots → inventory rows).
 */
export function equippedAffixBonuses(loadout) {
  const totals = { enchantmentBonus: 0, elementBonus: {}, resist: 0, vitality: 0 };
  if (!loadout) return totals;
  const slots = ["rightHand", "leftHand", "head", "body", "accessory"];
  for (const slot of slots) {
    for (const aff of parseAffixes(loadout[slot])) {
      const v = Number(aff.value) || 0;
      if (aff.stat === "enchantmentBonus") totals.enchantmentBonus += v;
      else if (aff.stat === "element" && aff.element) totals.elementBonus[aff.element] = (totals.elementBonus[aff.element] || 0) + v;
      else if (aff.stat === "resist") totals.resist += v;
      else if (aff.stat === "vitality") totals.vitality += v;
    }
  }
  totals.enchantmentBonus = Math.round(totals.enchantmentBonus * 100) / 100;
  return totals;
}

/**
 * The flat enchantment bonus a player's equipped gear adds to a cast of
 * `element` (generic enchant + matching element affixes). The combat route
 * folds this into attackerStats.enchantmentBonus.
 */
export function combatEnchantmentFor(loadout, element = "none") {
  const b = equippedAffixBonuses(loadout);
  return b.enchantmentBonus + (element && element !== "none" ? (b.elementBonus[element] || 0) : 0);
}

export { PREFIXES, SUFFIXES, RARITY_RULES };
