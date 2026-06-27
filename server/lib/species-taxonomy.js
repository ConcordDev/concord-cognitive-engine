// server/lib/species-taxonomy.js
//
// Wave 6 / Layer 1 — the taxonomy spine: the single lookup that selects a
// creature's base rig topology + needs-driving diet + clade. Authored in
// content/species-taxonomy.json; unknown species (e.g. procedurally-named
// hybrids) fall back to deterministic keyword inference so the spine is total.
//
// taxonomyForSpecies(id) -> { clade, topology, diet }
//   clade    — mammal/avian/reptile/fish/cephalopod/arthropod + exotics
//   topology — the procedural-creature rig family (quadruped/winged_biped/…)
//   diet     — herbivore/carnivore/omnivore/filter/photosynth (drives needs)

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(__dir, "../../content/species-taxonomy.json");

let _catalog = null;
function catalog() {
  if (_catalog) return _catalog;
  try { _catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"))?.species || {}; }
  catch { _catalog = {}; }
  return _catalog;
}
export function _resetTaxonomyCache() { _catalog = null; }

/**
 * The full authored species catalog as a list of taxonomy records. This is the
 * real species library (content/species-taxonomy.json) — the single source of
 * truth the creatures lens browses. Returns [] only if the file is missing.
 */
export function speciesCatalog() {
  const cat = catalog();
  return Object.entries(cat).map(([id, rec]) => ({
    species_id: id,
    clade: rec.clade || "mammal",
    topology: rec.topology || "quadruped",
    diet: rec.diet || "omnivore",
    aquatic: ["fish", "eel", "shark", "cephalopod"].includes(rec.topology),
  }));
}

// Keyword → topology inference for unknown species (mirrors procedural-creature's
// TOPOLOGY_KEYWORDS, kept local so this lib stays import-light).
const TOPOLOGY_KEYWORDS = [
  [/owl|condor|hawk|falcon|pigeon|finch|corvid|raptor|crow|moth/, "winged_biped"],
  [/snake|serpent|viper|cobra|naga|wyrm/, "serpentine"],
  [/eel/, "eel"],
  [/shark/, "shark"],
  [/octopus|squid|kraken|cephalo/, "cephalopod"],
  [/fish|minnow|carp|trout/, "fish"],
  [/crab|scorpion|spider|centipede|ant|insect|beetle/, "polyped"],
  [/sprite|seed|kin|wisp|drift|spectre|wraith_/, "amorphous"],
  [/dragon|wyvern|drake|gryphon|chimera/, "winged_quadruped"],
];
const TOPOLOGY_TO_CLADE = {
  quadruped: "mammal", winged_quadruped: "mammal", winged_biped: "avian",
  serpentine: "reptile", eel: "fish", fish: "fish", shark: "fish",
  cephalopod: "cephalopod", polyped: "arthropod", amorphous: "sprite", humanoid: "humanoid",
};

function inferTopology(speciesId) {
  const s = String(speciesId || "").toLowerCase();
  for (const [re, top] of TOPOLOGY_KEYWORDS) if (re.test(s)) return top;
  return "quadruped"; // the safe terrestrial default
}

/**
 * The taxonomy record for a species id. Authored first, inferred otherwise.
 * Always returns a complete record (total).
 */
export function taxonomyForSpecies(speciesId) {
  const id = String(speciesId || "").replace(/^creature:/, "");
  const authored = catalog()[id];
  if (authored && authored.topology && authored.clade) {
    return { clade: authored.clade, topology: authored.topology, diet: authored.diet || "omnivore" };
  }
  const topology = authored?.topology || inferTopology(id);
  return {
    clade: authored?.clade || TOPOLOGY_TO_CLADE[topology] || "mammal",
    topology,
    diet: authored?.diet || "omnivore",
  };
}

/** Just the rig topology — the keystone the renderer + gait select on. */
export function topologyForSpecies(speciesId) {
  return taxonomyForSpecies(speciesId).topology;
}

/** Whether this species is aquatic (drives swim behaviour + finned gait). */
export function isAquaticSpecies(speciesId) {
  return ["fish", "eel", "shark", "cephalopod"].includes(topologyForSpecies(speciesId));
}
