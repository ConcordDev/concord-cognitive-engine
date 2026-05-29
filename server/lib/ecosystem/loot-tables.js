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

// F2.1 — equippable drops roll item affixes by rarity.
import { rollAffixes, RARITY_RULES } from "../item-affixes.js";
// F2.2 — a themed drop joins an item set.
import { setIdForAffixes } from "../item-sets.js";

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
  reef_eel: [
    { item: "raw-fish",   qtyRange: [1, 2], rarity: "common",   chance: 1.0 },
    { item: "snake-skin", qtyRange: [1, 1], rarity: "uncommon", chance: 0.6 },
  ],
  deep_octopus: [
    { item: "raw-fish",  qtyRange: [2, 3], rarity: "uncommon", chance: 1.0 },
    { item: "ink-sac",   qtyRange: [1, 1], rarity: "rare",     chance: 0.7 },
  ],
  reef_shark: [
    { item: "raw-fish",  qtyRange: [3, 5], rarity: "common",   chance: 1.0 },
    { item: "fang",      qtyRange: [1, 2], rarity: "uncommon", chance: 0.8 },
    { item: "hide",      qtyRange: [1, 1], rarity: "rare",     chance: 0.4 },
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

  // Arid / desert species — added so worlds with desert regions (Tunya's
  // Bahiij / cactem-strip, lattice-crucible procgen desert, sovereign-ruins
  // dry-tier) don't get crocodile-in-the-desert spawns.
  dust_jackal: [
    { item: "raw-meat", qtyRange: [1, 2], rarity: "common",   chance: 0.8 },
    { item: "pelt",     qtyRange: [1, 1], rarity: "uncommon", chance: 0.5 },
    { item: "fang",     qtyRange: [1, 1], rarity: "uncommon", chance: 0.3 },
  ],
  desert_snake: [
    { item: "raw-meat", qtyRange: [1, 1], rarity: "common",   chance: 0.7 },
    { item: "snake-skin", qtyRange: [1, 1], rarity: "uncommon", chance: 0.9 },
    { item: "venom-sac",  qtyRange: [1, 1], rarity: "rare",     chance: 0.25 },
  ],
  sand_scorpion: [
    { item: "chitin",    qtyRange: [1, 2], rarity: "common",   chance: 1.0 },
    { item: "venom-sac", qtyRange: [1, 1], rarity: "rare",     chance: 0.3 },
  ],
  sandsong_finch: [
    { item: "feather",   qtyRange: [1, 2], rarity: "common", chance: 1.0 },
  ],

  // Tunya-flavor — bloodline-touched fauna unique to the post-arrival world
  sangmoth: [
    { item: "raw-meat",     qtyRange: [1, 2], rarity: "uncommon", chance: 0.8 },
    { item: "ember-scale",  qtyRange: [1, 1], rarity: "rare",     chance: 0.4 },
  ],
  kraal_buck: [
    { item: "raw-meat", qtyRange: [2, 3], rarity: "common",   chance: 1.0 },
    { item: "hide",     qtyRange: [1, 2], rarity: "common",   chance: 1.0 },
    { item: "horn",     qtyRange: [1, 2], rarity: "uncommon", chance: 0.45 },
  ],
  cliff_condor: [
    { item: "feather", qtyRange: [2, 4], rarity: "uncommon", chance: 1.0 },
    { item: "talon",   qtyRange: [1, 1], rarity: "rare",     chance: 0.4 },
  ],

  // Cyber-flavor — urban scavengers and tech-tainted strays
  drone_rat: [
    { item: "raw-meat",     qtyRange: [1, 1], rarity: "common",   chance: 0.8 },
    { item: "scrap-circuit", qtyRange: [1, 2], rarity: "uncommon", chance: 0.6 },
  ],
  wire_corvid: [
    { item: "feather",       qtyRange: [1, 2], rarity: "common",   chance: 1.0 },
    { item: "scrap-circuit", qtyRange: [1, 1], rarity: "uncommon", chance: 0.4 },
  ],

  // Crime-flavor — gritty modern strays
  alley_cat: [
    { item: "raw-meat", qtyRange: [1, 1], rarity: "common", chance: 0.7 },
    { item: "fur",      qtyRange: [1, 1], rarity: "common", chance: 0.9 },
  ],
  dock_rat: [
    { item: "raw-meat", qtyRange: [1, 1], rarity: "common", chance: 0.7 },
    { item: "fur",      qtyRange: [1, 1], rarity: "common", chance: 0.8 },
  ],

  // Superhero-flavor — bio-touched urban variants
  meta_coyote: [
    { item: "raw-meat",   qtyRange: [2, 3], rarity: "common",   chance: 1.0 },
    { item: "pelt",       qtyRange: [1, 1], rarity: "uncommon", chance: 0.6 },
    { item: "meta-essence", qtyRange: [1, 1], rarity: "rare",   chance: 0.3 },
  ],
  plasma_pigeon: [
    { item: "feather",      qtyRange: [1, 2], rarity: "common", chance: 1.0 },
    { item: "meta-essence", qtyRange: [1, 1], rarity: "rare",   chance: 0.15 },
  ],

  // Sovereign-Ruins flavor — half-faded archival fauna
  archive_owl: [
    { item: "feather",     qtyRange: [1, 2], rarity: "common", chance: 1.0 },
    { item: "ley-essence", qtyRange: [1, 1], rarity: "rare",   chance: 0.35 },
  ],
  wraith_deer: [
    { item: "ley-essence", qtyRange: [1, 1], rarity: "rare", chance: 0.7 },
    { item: "antler",      qtyRange: [1, 1], rarity: "uncommon", chance: 0.4 },
  ],

  // Lattice-Crucible flavor — phase-shifting drift-born
  drift_stag: [
    { item: "raw-meat",    qtyRange: [1, 2], rarity: "uncommon", chance: 0.8 },
    { item: "drift-shard", qtyRange: [1, 1], rarity: "rare",     chance: 0.5 },
  ],
  shimmer_finch: [
    { item: "feather",     qtyRange: [1, 2], rarity: "common", chance: 1.0 },
    { item: "drift-shard", qtyRange: [1, 1], rarity: "rare",   chance: 0.2 },
  ],

  // Frontier flavor — mesh-courier and trail fauna
  walker_hound: [
    { item: "raw-meat", qtyRange: [2, 3], rarity: "common",   chance: 0.9 },
    { item: "pelt",     qtyRange: [1, 1], rarity: "uncommon", chance: 0.5 },
  ],
  trail_falcon: [
    { item: "feather", qtyRange: [1, 3], rarity: "common",   chance: 1.0 },
    { item: "talon",   qtyRange: [1, 1], rarity: "uncommon", chance: 0.3 },
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
    const drop = { item: entry.item, quantity, quality: entry.rarity };
    // F2.1 — equippable drops roll affixes by rarity (raw materials don't). The
    // combat damage calc reads these off the equipped weapon.
    if (_isEquippable(entry.item) && RARITY_RULES[entry.rarity] && RARITY_RULES[entry.rarity].count > 0) {
      const affixes = rollAffixes(entry.rarity);
      if (affixes.length) {
        drop.affixes = affixes;
        // F2.2 — a themed piece (by dominant affix) joins a set; 2+/4+ equipped
        // grant set bonuses.
        const sid = setIdForAffixes(affixes);
        if (sid) drop.set_id = sid;
      }
    }
    out.push(drop);
  }
  return out;
}

// Heuristic: is a dropped item an equippable weapon/armor (vs a raw material)?
function _isEquippable(itemName = "") {
  return /sword|blade|dagger|axe|mace|hammer|spear|lance|staff|bow|wand|gun|rifle|pistol|shield|armou?r|helm|helmet|plate|mail|gauntlet|boot|greave|robe|cloak|ring|amulet|talisman|charm/i.test(String(itemName));
}

/** Static lookup: which species exist for a (universe, biome) combo. */
const BIOME_SPECIES = Object.freeze({
  standard: {
    plains:    [{ id: "deer",   target: 6, lifestyle: "herbivore" }, { id: "rabbit", target: 8, lifestyle: "herbivore" }],
    forest:    [{ id: "deer",   target: 6, lifestyle: "herbivore" }, { id: "boar",   target: 4, lifestyle: "omnivore"  }, { id: "wolf", target: 2, lifestyle: "carnivore" }],
    highland:  [{ id: "goat",   target: 5, lifestyle: "herbivore" }, { id: "hawk",   target: 3, lifestyle: "carnivore" }],
    mountain:  [{ id: "bear",   target: 1, lifestyle: "carnivore" }, { id: "goat",   target: 3, lifestyle: "herbivore" }],
    // Arid / desert — NO crocodile-in-the-desert. Snake + scorpion +
    // jackal are the survival-tier carnivores; no large grazers (water
    // scarcity gates herd size).
    arid:      [
      { id: "dust_jackal",   target: 2, lifestyle: "carnivore" },
      { id: "desert_snake",  target: 4, lifestyle: "carnivore" },
      { id: "sand_scorpion", target: 5, lifestyle: "carnivore" },
    ],
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
  // Each canon-world flavor adds thematic species on top of the standard
  // roster — it does NOT remove the base set. speciesForBiome returns
  // [...base, ...flavor]. To prevent a species from appearing in a world,
  // it has to be excluded from `standard` for that biome.
  fantasy: {
    forest:    [{ id: "moonbloom_sprite", target: 3, lifestyle: "herbivore" }, { id: "star_seed_kin", target: 2, lifestyle: "herbivore" }],
    highland:  [{ id: "star_seed_kin", target: 2, lifestyle: "herbivore" }],
  },
  tunya: {
    plains:   [{ id: "kraal_buck", target: 4, lifestyle: "herbivore" }],
    forest:   [{ id: "sangmoth",   target: 2, lifestyle: "herbivore" }],
    highland: [{ id: "cliff_condor", target: 2, lifestyle: "carnivore" }],
    arid:     [{ id: "sandsong_finch", target: 5, lifestyle: "herbivore" }],
  },
  cyber: {
    plains:   [{ id: "drone_rat",   target: 6, lifestyle: "omnivore"  },
               { id: "wire_corvid", target: 4, lifestyle: "omnivore"  }],
  },
  crime: {
    plains:   [{ id: "alley_cat",   target: 5, lifestyle: "carnivore" },
               { id: "dock_rat",    target: 7, lifestyle: "omnivore"  }],
  },
  superhero: {
    plains:   [{ id: "meta_coyote",   target: 3, lifestyle: "carnivore" },
               { id: "plasma_pigeon", target: 6, lifestyle: "omnivore"  }],
  },
  sovereign_ruins: {
    plains:   [{ id: "archive_owl",  target: 3, lifestyle: "carnivore" },
               { id: "wraith_deer",  target: 2, lifestyle: "herbivore" }],
    arid:     [{ id: "wraith_deer",  target: 1, lifestyle: "herbivore" }],
  },
  lattice_crucible: {
    plains:   [{ id: "drift_stag",     target: 2, lifestyle: "herbivore" },
               { id: "shimmer_finch",  target: 4, lifestyle: "omnivore"  }],
    forest:   [{ id: "drift_stag",     target: 2, lifestyle: "herbivore" }],
  },
  frontier: {
    plains:   [{ id: "walker_hound",  target: 3, lifestyle: "carnivore" },
               { id: "trail_falcon",  target: 2, lifestyle: "carnivore" }],
    forest:   [{ id: "walker_hound",  target: 2, lifestyle: "carnivore" }],
    highland: [{ id: "trail_falcon",  target: 3, lifestyle: "carnivore" }],
  },
  concordia_hub: {
    // Hub is peaceful (Concordant Law). Only the gentlest base spawns;
    // no carnivore-only flavor entries — predators come from the base set.
  },
});

/**
 * Look up species for a biome. universe is the world's universe_type
 * (standard / fantasy / etc.). Falls back to standard if a universe
 * doesn't define species for a biome — every world gets at least the
 * base set.
 *
 * When `universe === "standard"` we return ONLY the base set rather than
 * doubling it (without the guard `[...base, ...flavor]` would concat the
 * standard roster with itself).
 */
export function speciesForBiome(universe, biome) {
  const base = BIOME_SPECIES.standard[biome] ?? [];
  if (universe === "standard") return [...base];
  const flavor = (BIOME_SPECIES[universe]?.[biome]) ?? [];
  return [...base, ...flavor];
}

export const LOOT_TABLES = LOOT;
