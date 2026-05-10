// server/lib/ecosystem/loot-tables.js
//
// EvoEcosystem: per-species loot tables. Used by W1 fauna-spawner to
// stamp drops onto creature blueprints, and by W2 butcher endpoint to
// roll the actual loot when a corpse is harvested.
//
// Each entry describes a possible drop:
//   { item, qtyRange: [min, max], rarity: 'common'|'uncommon'|'rare', chance: 0..1 }
//
// rarity is folded into the inventory row's quality field. chance is
// rolled per-drop (independent), so a corpse can yield multiple items.

const LOOT = Object.freeze({
  // Standard biome herbivores
  deer: [
    { item: "raw-meat",  qtyRange: [2, 4], rarity: "common",   chance: 1.0 },
    { item: "hide",      qtyRange: [1, 2], rarity: "common",   chance: 1.0 },
    { item: "sinew",     qtyRange: [1, 1], rarity: "uncommon", chance: 0.4 },
    { item: "antler",    qtyRange: [1, 1], rarity: "uncommon", chance: 0.25 },
  ],
  boar: [
    { item: "raw-meat", qtyRange: [3, 5], rarity: "common",   chance: 1.0 },
    { item: "hide",     qtyRange: [1, 2], rarity: "common",   chance: 1.0 },
    { item: "tusk",     qtyRange: [1, 2], rarity: "uncommon", chance: 0.35 },
  ],
  rabbit: [
    { item: "raw-meat", qtyRange: [1, 1], rarity: "common", chance: 1.0 },
    { item: "fur",      qtyRange: [1, 1], rarity: "common", chance: 1.0 },
  ],

  // Predators
  wolf: [
    { item: "raw-meat", qtyRange: [2, 3], rarity: "common",   chance: 0.9 },
    { item: "pelt",     qtyRange: [1, 1], rarity: "uncommon", chance: 0.7 },
    { item: "fang",     qtyRange: [1, 2], rarity: "uncommon", chance: 0.5 },
  ],
  bear: [
    { item: "raw-meat",  qtyRange: [4, 7], rarity: "common",   chance: 1.0 },
    { item: "thick-pelt", qtyRange: [1, 1], rarity: "rare",     chance: 0.6 },
    { item: "claw",       qtyRange: [1, 3], rarity: "uncommon", chance: 0.5 },
  ],

  // Mountain / highland
  goat: [
    { item: "raw-meat", qtyRange: [1, 2], rarity: "common",   chance: 1.0 },
    { item: "horn",     qtyRange: [1, 2], rarity: "uncommon", chance: 0.4 },
  ],
  hawk: [
    { item: "feather",  qtyRange: [1, 3], rarity: "common", chance: 1.0 },
    { item: "talon",    qtyRange: [1, 1], rarity: "uncommon", chance: 0.3 },
  ],

  // Coastal / water
  fish: [
    { item: "raw-fish", qtyRange: [1, 1], rarity: "common", chance: 1.0 },
  ],
  crab: [
    { item: "raw-fish",  qtyRange: [1, 1], rarity: "common", chance: 0.5 },
    { item: "shell",     qtyRange: [1, 2], rarity: "common", chance: 0.9 },
  ],

  // Fey / Concordia-only — these only appear when the world's universe
  // flavor includes 'concordia' or 'fantasy'.
  moonbloom_sprite: [
    { item: "moonbloom",     qtyRange: [1, 2], rarity: "rare", chance: 0.8 },
    { item: "ley-essence",   qtyRange: [1, 1], rarity: "rare", chance: 0.4 },
  ],
  star_seed_kin: [
    { item: "seed-of-stars", qtyRange: [1, 1], rarity: "rare", chance: 0.6 },
  ],
});

/**
 * Roll the loot table for a species. Quality multiplier (from a butcher
 * minigame) scales chance and qtyRange linearly within the [0.5, 2.0] band.
 * @returns {Array<{ item, quantity, quality }>}
 */
export function rollLoot(speciesId, qualityMultiplier = 1.0) {
  const table = LOOT[speciesId];
  if (!table || table.length === 0) return [];
  const q = Math.max(0.5, Math.min(2.0, qualityMultiplier));
  const out = [];
  for (const entry of table) {
    if (Math.random() > entry.chance * q) continue;
    const [min, max] = entry.qtyRange;
    const baseQty = min + Math.floor(Math.random() * (max - min + 1));
    const quantity = Math.max(1, Math.round(baseQty * q));
    out.push({ item: entry.item, quantity, quality: entry.rarity });
  }
  return out;
}

/** Static lookup: which species exist for a (universe, biome) combo. */
const BIOME_SPECIES = Object.freeze({
  standard: {
    plains:    [{ id: "deer",   target: 6, lifestyle: "herbivore" }, { id: "rabbit", target: 8, lifestyle: "herbivore" }],
    forest:    [{ id: "deer",   target: 6, lifestyle: "herbivore" }, { id: "boar",   target: 4, lifestyle: "omnivore"  }, { id: "wolf", target: 2, lifestyle: "carnivore" }],
    highland:  [{ id: "goat",   target: 5, lifestyle: "herbivore" }, { id: "hawk",   target: 3, lifestyle: "carnivore" }],
    mountain:  [{ id: "bear",   target: 1, lifestyle: "carnivore" }, { id: "goat",   target: 3, lifestyle: "herbivore" }],
    // Sprint C / Track C1 — aquatic biome gets procedural marine creatures.
    // topology drives the aquatic-mesh-builder (eel/cephalopod/shark).
    // swim_depth_min/max gate which depths spawn each species.
    water:     [
      { id: "fish",        target: 12, lifestyle: "herbivore", topology: "fish",        swim_depth_min: 0,  swim_depth_max: 8  },
      { id: "crab",        target: 6,  lifestyle: "omnivore",  topology: "fish",        swim_depth_min: 0,  swim_depth_max: 2  },
      { id: "reef_eel",    target: 4,  lifestyle: "carnivore", topology: "eel",         swim_depth_min: 2,  swim_depth_max: 12 },
      { id: "deep_octopus",target: 2,  lifestyle: "carnivore", topology: "cephalopod",  swim_depth_min: 5,  swim_depth_max: 30 },
      { id: "reef_shark",  target: 1,  lifestyle: "carnivore", topology: "shark",       swim_depth_min: 3,  swim_depth_max: 25 },
    ],
  },
  fantasy: {
    forest:    [{ id: "moonbloom_sprite", target: 3, lifestyle: "herbivore" }, { id: "star_seed_kin", target: 2, lifestyle: "herbivore" }],
    highland:  [{ id: "star_seed_kin", target: 2, lifestyle: "herbivore" }],
  },
});

/**
 * Look up species for a biome. universe is the world's universe_type
 * (standard / fantasy / etc.). Falls back to standard if a universe
 * doesn't define species for a biome — every world gets at least the
 * base set.
 */
export function speciesForBiome(universe, biome) {
  const base = BIOME_SPECIES.standard[biome] ?? [];
  const flavor = (BIOME_SPECIES[universe]?.[biome]) ?? [];
  return [...base, ...flavor];
}

export const LOOT_TABLES = LOOT;
