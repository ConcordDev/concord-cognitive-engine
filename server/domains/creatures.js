// server/domains/creatures.js
//
// Wave 6 — the creature render data path. Creatures are simulated (spawn, flock,
// flee, breed) as world_npcs rows (archetype='creature:<species>') but were
// INVISIBLE: appearance.for_world explicitly filters `creature:%` out, and the
// humanoid AppearanceConfig has no rig for them. This domain serves the
// topology-aware descriptor the frontend CreatureSystem needs to build a
// non-humanoid mesh + drive the matching gait — un-gating the bestiary.
//
// for_world  — every live creature in a world with its taxonomy + genotype.
// taxonomy   — the taxonomy record for one species id.
// Public-read (world-visible).

import { taxonomyForSpecies, isAquaticSpecies } from "../lib/species-taxonomy.js";

// Deterministic coat colour from species id + dominant affinity, so a steam
// variant reads cool-grey, a magma variant red, etc. — no per-species art asset.
const VARIANT_TINT = {
  steam: "#cdd6e0", brine: "#3f6b6b", magma: "#b5421f", storm: "#5a6cc0",
  fire: "#c0532a", water: "#3a6ea5", ice: "#9fd6e8", bio: "#5a8a3c",
  lightning: "#d8c24a", earth: "#7a5a3a", energy: "#caa3ef",
};
function coatFor(speciesId, dominant) {
  if (dominant && VARIANT_TINT[dominant]) return VARIANT_TINT[dominant];
  // hash the species id to a stable earthy hue.
  let h = 0;
  for (const c of String(speciesId)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hues = ["#8b5e3c", "#6a4a2c", "#9a7048", "#5a4632", "#7a6048", "#4a3a2a"];
  return hues[h % hues.length];
}

function speciesOf(row) {
  if (row.species_id) return String(row.species_id);
  const a = String(row.archetype || "");
  return a.startsWith("creature:") ? a.slice("creature:".length) : a;
}

export default function registerCreatureMacros(register) {
  register("creatures", "for_world", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = input.worldId;
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    const limit = Math.min(Number(input.limit) || 500, 1000);

    let rows = [];
    try {
      rows = db.prepare(`
        SELECT id, species_id, archetype, x, y, z
        FROM world_npcs
        WHERE world_id = ? AND COALESCE(is_dead, 0) = 0 AND archetype LIKE 'creature:%'
        LIMIT ?
      `).all(worldId, limit);
    } catch { return { ok: true, creatures: [] }; }

    // Best-effort genotype lookup for bred hybrids (creature_lineage may be absent).
    let genoById = new Map();
    try {
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        const ph = ids.map(() => "?").join(",");
        const lin = db.prepare(`SELECT child_id, blueprint FROM creature_lineage WHERE child_id IN (${ph})`).all(...ids);
        for (const l of lin) {
          try { const bp = JSON.parse(l.blueprint); if (bp?.genotype) genoById.set(l.child_id, bp.genotype); } catch { /* skip */ }
        }
      }
    } catch { /* no lineage table */ }

    const creatures = rows.map((r) => {
      const species = speciesOf(r);
      const tax = taxonomyForSpecies(species);
      const geno = genoById.get(r.id) || null;
      const dominant = geno?.dominant || geno?.affinity || null;
      return {
        id: r.id,
        species_id: species,
        x: r.x, y: r.y, z: r.z,
        topology: tax.topology,
        clade: tax.clade,
        diet: tax.diet,
        aquatic: isAquaticSpecies(species),
        variant: geno?.variant || null,
        coatColor: coatFor(species, dominant),
      };
    });
    return { ok: true, creatures, count: creatures.length };
  }, { note: "live creatures in a world with taxonomy + genotype (CreatureSystem render feed)" });

  register("creatures", "taxonomy", async (_ctx, input = {}) => {
    // Accept the codebase-standard snake_case species_id as well as the legacy
    // camelCase speciesId (playtest finding #6 — intra-domain consistency).
    const speciesId = input.species_id || input.speciesId;
    if (!speciesId) return { ok: false, reason: "missing_species_id" };
    return { ok: true, taxonomy: taxonomyForSpecies(speciesId) };
  }, { note: "taxonomy record (clade/topology/diet) for a species id" });
}
