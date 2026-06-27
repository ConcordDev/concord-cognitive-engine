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

import { taxonomyForSpecies, isAquaticSpecies, topologyForSpecies, speciesCatalog } from "../lib/species-taxonomy.js";
import { generateCreature } from "../lib/procedural-creature.js";
import {
  recordEncounter,
  ensureCrossbreedingTables,
  generateHybrid,
  getLineage,
} from "../lib/creature-crossbreeding.js";

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

  // ── Lens surface ────────────────────────────────────────────────────
  // The creatures lens browses populations + the species library and breeds.
  // These delegate to the real libs (species-taxonomy + creature-crossbreeding);
  // no breeding logic is duplicated here.

  /**
   * creatures.species — the authored species library (the real catalog the
   * lens picks parents from). Read-only, world-agnostic.
   */
  register("creatures", "species", async (_ctx, _input = {}) => {
    const catalog = speciesCatalog();
    return { ok: true, species: catalog, count: catalog.length };
  }, { note: "the authored species library (clade/topology/diet per species)" });

  /**
   * creatures.roster — the live populations in a world (per-biome fauna).
   * input: { worldId, limit? }
   */
  register("creatures", "roster", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = input.worldId || input.world_id;
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    const limit = Math.min(Math.max(Number(input.limit) || 100, 1), 500);
    let rows = [];
    try {
      rows = db.prepare(`
        SELECT id, world_id, biome, species_id, lifestyle, current_count, target_count
        FROM creature_population WHERE world_id = ?
        ORDER BY current_count DESC LIMIT ?
      `).all(worldId, limit);
    } catch { return { ok: true, populations: [], count: 0 }; }
    // Enrich each population with its real taxonomy so the UI reads richly.
    const populations = rows.map((r) => ({
      ...r,
      topology: topologyForSpecies(r.species_id),
      clade: taxonomyForSpecies(r.species_id).clade,
      aquatic: isAquaticSpecies(r.species_id),
    }));
    return { ok: true, populations, count: populations.length };
  }, { note: "live per-biome creature populations in a world (taxonomy-enriched)" });

  /**
   * creatures.lineage — a creature's parents + descendants.
   * input: { creatureId }
   */
  register("creatures", "lineage", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const creatureId = input.creatureId || input.creature_id;
    if (!creatureId) return { ok: false, reason: "missing_creature_id" };
    return { ok: true, lineage: getLineage(db, creatureId) || { self: null, descendants: [] } };
  }, { note: "lineage (self + descendants) for a creature id" });

  /**
   * creatures.breed — the crossbreeding pen. The lens passes two SPECIES
   * (with optional ids + a shared biome). We synthesize a real, physics-valid
   * parent blueprint per species from the procedural generator (so mass /
   * topology / parts are real, not faked), seed the bond past the breeding
   * threshold for an explicit pen-pairing, then delegate to generateHybrid()
   * — the single real breeding path. Same-biome pairings get the bond bonus
   * (sameEnvironmentBonus → SAME_ENV_BONUS) so they cross more readily.
   *
   * input: {
   *   a: { id?, species_id, lifestyle? },
   *   b: { id?, species_id, lifestyle? },
   *   environment?: string (biome),
   *   sameEnvironmentBonus?: boolean,
   *   worldId?: string,
   * }
   */
  register("creatures", "breed", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const a = input.a, b = input.b;
    const speciesA = a?.species_id || a?.speciesId;
    const speciesB = b?.species_id || b?.speciesId;
    if (!a || !b || !speciesA || !speciesB) return { ok: false, reason: "missing_parents" };
    const worldId = input.worldId || input.world_id || "concordia-hub";
    const biome = input.environment || null;
    const sameEnv = input.sameEnvironmentBonus === true;

    try {
      ensureCrossbreedingTables(db);

      // Build a real parent blueprint per species via the procedural generator.
      // The generator returns { id, worldId, topology, massKg, heightM, parts, ... }
      // — everything generateHybrid needs. Stable id when the caller supplies one.
      const buildParent = (parent, speciesId) => {
        const bp = generateCreature({
          description: speciesId,
          worldId,
          topology: topologyForSpecies(speciesId),
          origin: "pen-pairing",
        });
        if (parent?.id) bp.id = String(parent.id);
        bp.species_id = speciesId;
        return bp;
      };
      const pa = buildParent(a, speciesA);
      const pb = buildParent(b, speciesB);
      if (pa.id === pb.id) return { ok: false, reason: "self_pair" };

      // An explicit pen-pairing is an intentional, sustained encounter: seed the
      // bond past the same-world threshold in one shot (the wild path builds it
      // over many co-located ticks via recordEncounter). Same-biome carries the
      // env bonus so the cross is more reliable.
      for (let i = 0; i < 24; i++) {
        recordEncounter(db, {
          aId: pa.id, bId: pb.id, worldA: worldId, worldB: worldId,
          environment: biome, sameEnvironmentBonus: sameEnv,
        });
      }

      const environment = biome ? { kind: biome } : null;
      const result = generateHybrid(db, { a: pa, b: pb, environment });
      if (!result.ok) return result;
      // Surface a lean, UI-friendly hybrid shape alongside the full blueprint.
      return {
        ok: true,
        hybrid: {
          id: result.hybrid.id,
          species_id: result.hybrid.species_id || result.hybrid.provenance?.description || "hybrid",
          topology: result.hybrid.topology,
          massKg: result.hybrid.massKg,
          variant: result.hybrid.variant || result.hybrid.genotype?.variant || null,
        },
        stability: result.stability,
        crossWorld: result.crossWorld,
        inheritedSkillIds: result.inheritedSkillIds,
        generation: result.generation,
        parents: result.parents,
        sameEnvironmentBonus: sameEnv,
      };
    } catch (e) {
      return { ok: false, reason: "breed_failed", error: e?.message };
    }
  }, { note: "crossbreed two species → a real physics-valid hybrid (delegates to creature-crossbreeding)" });
}
