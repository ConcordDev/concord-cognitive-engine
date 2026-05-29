// server/lib/skills/skill-key.js
//
// T3.1 — resolve a combat skill payload to a canonical SKILL_CATALOG key, so
// the client can look up the per-skill descriptor (skill-descriptors.ts) for
// VFX/animation accents. Deterministic; no DB. Shipped on combat:hit +
// combat:impact alongside element/tier.
//
// Mapping precedence: explicit element → elemental_<x>; else weapon/kind →
// the matching martial key; else the skill's own skill_type when it's already
// a catalog key; else 'fists' (the universal unarmed fallback).

const ELEMENT_KEYS = {
  fire: "elemental_fire",
  water: "elemental_water",
  ice: "elemental_ice",
  frost: "elemental_ice",
  lightning: "elemental_lightning",
  storm: "elemental_lightning",
  poison: "elemental_poison",
  bio: "elemental_poison",
  energy: "elemental_energy",
  plasma: "elemental_energy",
};

// weapon/kind token → catalog key (checked as substrings, longest first).
const WEAPON_KEYS = [
  ["pistol", "ranged_pistol"],
  ["revolver", "ranged_pistol"],
  ["rifle", "ranged_rifle"],
  ["gun", "ranged_pistol"],
  ["bow", "archery"],
  ["arrow", "archery"],
  ["sword", "swords"],
  ["blade", "swords"],
  ["dagger", "swords"],
  ["spear", "spears"],
  ["lance", "spears"],
  ["polearm", "spears"],
  ["staff", "staves"],
  ["staves", "staves"],
  ["fist", "fists"],
  ["unarmed", "fists"],
  ["punch", "fists"],
  ["kick", "agility"],
];

const KNOWN_CATALOG_KEYS = new Set([
  "swords", "archery", "fists", "spears", "staves", "ranged_pistol",
  "ranged_rifle", "elemental_fire", "elemental_water", "elemental_ice",
  "elemental_lightning", "elemental_poison", "elemental_energy",
  "strength", "agility",
]);

/**
 * Resolve a skill payload to a catalog key. Accepts the loose shapes the combat
 * paths carry: { element, kind, weapon_kind, skill_kind, skill_type, name }.
 */
export function skillKeyForSkill(skillData = {}) {
  if (!skillData || typeof skillData !== "object") return "fists";

  const element = String(skillData.element || "").toLowerCase();
  if (element && element !== "none" && element !== "physical" && ELEMENT_KEYS[element]) {
    return ELEMENT_KEYS[element];
  }

  const tokens = [
    skillData.kind, skillData.weapon_kind, skillData.skill_kind, skillData.weapon, skillData.name,
  ].filter(Boolean).map((t) => String(t).toLowerCase());
  for (const tok of tokens) {
    for (const [needle, key] of WEAPON_KEYS) {
      if (tok.includes(needle)) return key;
    }
  }

  const st = String(skillData.skill_type || "").toLowerCase();
  if (KNOWN_CATALOG_KEYS.has(st)) return st;

  return "fists";
}

export { ELEMENT_KEYS, WEAPON_KEYS, KNOWN_CATALOG_KEYS };
