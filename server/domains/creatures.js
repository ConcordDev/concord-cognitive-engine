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
import { buildCreaturePortraitSvg, summarizePartCounts } from "../lib/creature-portrait.js";
import { registerCitation } from "../economy/royalty-cascade.js";

// Deterministic coat colour from species id + dominant affinity, so a steam
// variant reads cool-grey, a magma variant red, etc. — no per-species art asset.
const VARIANT_TINT = {
  steam: "#cdd6e0", brine: "#3f6b6b", magma: "#b5421f", storm: "#5a6cc0",
  fire: "#c0532a", water: "#3a6ea5", ice: "#9fd6e8", bio: "#5a8a3c",
  lightning: "#d8c24a", earth: "#7a5a3a", energy: "#caa3ef",
};
export function coatFor(speciesId, dominant) {
  if (dominant && VARIANT_TINT[dominant]) return VARIANT_TINT[dominant];
  // hash the species id to a stable earthy hue.
  let h = 0;
  for (const c of String(speciesId)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hues = ["#8b5e3c", "#6a4a2c", "#9a7048", "#5a4632", "#7a6048", "#4a3a2a"];
  return hues[h % hues.length];
}

// Reject a poisoned numeric input (NaN/Infinity/1e308/negative) before it can
// silently clamp through Math.min/max. An absent field is fine (uses default).
// Returns null when clean, else the offending key. Fail-CLOSED.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

function speciesOf(row) {
  if (row.species_id) return String(row.species_id);
  const a = String(row.archetype || "");
  return a.startsWith("creature:") ? a.slice("creature:".length) : a;
}

// ── Asset Studio — creature authoring / lineage helpers ────────────────
// Mirrors the proven building-publish / asset-fuse pattern in
// server/domains/gamedesign.js (Increment 1 + 5): mint real creator-
// attributed blueprint DTUs, register royalty LINEAGE (never money — a
// later SALE fires distributeRoyalties), and honestly reject before any
// insert. Adapted to the creatures substrate — creatures live as
// world_npcs rows (archetype='creature:<species>'), and world_npcs has NO
// spawned_by_user_id / blueprint_dtu_id column, so the owner + blueprint
// linkage is persisted honestly in the existing `state` JSON column
// (verified against the live schema) and read back via json_extract.

const CS_AUTH_ANON = new Set([null, undefined, "", "anon"]);
const csId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const csNow = () => new Date().toISOString();
const csClean = (v, max = 160) => String(v == null ? "" : v).trim().slice(0, max);
function csFiniteNum(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function csUserId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || null;
}

// Deduped, order-preserving list of parent DTU ids from a legacy single id
// + a plural array. `single` is placed first. Mirrors gdNormalizeParentIds.
function csNormalizeParentIds(single, list) {
  const ids = [];
  if (single) ids.push(String(single));
  if (Array.isArray(list)) {
    for (const raw of list) {
      if (raw == null || raw === "") continue;
      const id = String(raw);
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

// Looks up every parent id in `dtus`. Returns { missingId, rows } — missingId
// is set (rows null) on the FIRST id that doesn't exist, so the caller can
// reject the whole publish honestly before any insert. Mirrors
// gdLookupParentRows.
function csLookupDtuParents(db, ids) {
  const rows = new Map();
  for (const id of ids) {
    const row = db.prepare(
      "SELECT id, owner_user_id, visibility, body_json FROM dtus WHERE id = ?",
    ).get(id);
    if (!row) return { missingId: id, rows: null };
    rows.set(id, row);
  }
  return { missingId: null, rows };
}

// Registers one royalty_lineage row per valid, non-self-owned parent. A
// self-owned parent (owner === caller) is SKIPPED honestly (no royalty with
// yourself — same as building-publish); a consent/cycle failure on one
// parent is recorded in its own entry and never blocks the others. Every
// entry corresponds to a REAL registerCitation() attempt — nothing is
// fabricated. `parents` is an array of { parentId, parentCreatorId, parentDtu }.
function csCiteParents(db, { parents, childId, userId }) {
  const citations = [];
  for (const p of parents) {
    if (!p?.parentCreatorId || p.parentCreatorId === userId) continue; // self-owned: skipped, not an error
    try {
      const result = registerCitation(db, {
        childId,
        parentId: p.parentId,
        creatorId: userId,
        parentCreatorId: p.parentCreatorId,
        parentDtu: p.parentDtu,
        generation: 1,
      });
      citations.push(result?.ok
        ? { lineageId: result.lineageId, parentId: p.parentId }
        : { ok: false, error: result?.error || "citation_failed", parentId: p.parentId });
    } catch (e) {
      citations.push({ ok: false, error: "citation_error", message: String(e?.message || e), parentId: p.parentId });
    }
  }
  return citations;
}

// Resolve a breed parent (as passed to creatures.breed: { id?, species_id })
// to its owning creator + blueprint DTU, IF it's a real owned creature. A
// creature spawned via creature-publish carries { spawnedByUserId,
// blueprintDtuId } in its world_npcs.state JSON. Wild / un-owned creatures
// (no id, no state linkage, or a missing world_npcs/dtus table) return null
// — the caller skips them honestly (no citation, not an error). Fully
// guarded so it degrades to null on any schema absence.
function csResolveOwnedCreatureParent(db, parentInput) {
  const pid = parentInput?.id;
  if (!pid) return null;
  let npcRow;
  try {
    npcRow = db.prepare("SELECT id, state FROM world_npcs WHERE id = ?").get(String(pid));
  } catch { return null; } // world_npcs table absent → treat as un-owned
  if (!npcRow) return null;
  let st = {};
  try { st = JSON.parse(npcRow.state || "{}") || {}; } catch { st = {}; }
  const ownerId = st.spawnedByUserId;
  const blueprintDtuId = st.blueprintDtuId;
  if (!ownerId || !blueprintDtuId) return null; // not an owned/authored creature
  let bp;
  try {
    bp = db.prepare("SELECT id, owner_user_id, visibility FROM dtus WHERE id = ?").get(String(blueprintDtuId));
  } catch { return null; }
  if (!bp) return null; // blueprint DTU gone → can't attribute honestly
  return {
    parentId: bp.id,
    parentCreatorId: bp.owner_user_id,
    parentDtu: { ownerId: bp.owner_user_id, visibility: bp.visibility },
  };
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

  /**
   * creatures.portrait — a deterministic procedural SVG schematic of a
   * species' REAL body plan. No art asset pipeline, no image model: this
   * synthesizes the same real, physics-validated blueprint `creatures.breed`
   * already synthesizes per species on demand (via generateCreature, seeded
   * only by the species id text — so the SAME species always yields the
   * SAME topology/mass/height/parts), then renders that real geometry as an
   * SVG in server/lib/creature-portrait.js. Every visual feature — body
   * shape, limb count, overall scale, tint — is a direct function of real
   * generator output; nothing is invented. Framed as a "procedural
   * schematic," never a photographic portrait.
   *
   * input: {
   *   species_id,               // required
   *   worldId?,                 // world-flavor physics modifier (default concordia-hub)
   *   dominant?,                // real elemental affinity, e.g. from a hybrid's
   *                             // genotype — drives coatFor's tint the same way
   *                             // creatures.for_world does for live instances
   *   variant?,                 // real bred-hybrid label (e.g. from creatures.breed's
   *                             // result.hybrid.variant) — captioned when present,
   *                             // never fabricated when absent
   * }
   */
  register("creatures", "portrait", async (_ctx, input = {}) => {
    const speciesId = input.species_id || input.speciesId;
    if (!speciesId) return { ok: false, reason: "missing_species_id" };
    const worldId = input.worldId || input.world_id || "concordia-hub";
    const dominant = input.dominant || null;
    const variant = input.variant || null;
    try {
      const topology = topologyForSpecies(speciesId);
      const blueprint = generateCreature({ description: speciesId, worldId, topology, origin: "portrait" });
      const coatColor = coatFor(speciesId, dominant);
      const svg = buildCreaturePortraitSvg({
        topology: blueprint.topology,
        massKg: blueprint.massKg,
        heightM: blueprint.heightM,
        parts: blueprint.parts,
        coatColor,
        variant,
      });
      return {
        ok: true,
        svg,
        params: {
          species_id: String(speciesId),
          topology: blueprint.topology,
          massKg: blueprint.massKg,
          heightM: blueprint.heightM,
          coatColor,
          variant,
          partCount: blueprint.parts.length,
          partCounts: summarizePartCounts(blueprint.parts),
        },
      };
    } catch (e) {
      return { ok: false, reason: "portrait_failed", error: e?.message };
    }
  }, { note: "deterministic SVG schematic of a species' real body plan (topology/mass/height/parts/coat) — procedural, not concept art" });

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
    const badNum = badNumericField(input, ["limit"]);
    if (badNum) return { ok: false, reason: `invalid_${badNum}` };
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

      // ── Creatures-C — the composition flywheel ────────────────────────
      // When a parent creature is a REAL owned creature (spawned via
      // creatures.creature-publish, so its world_npcs.state carries
      // { spawnedByUserId, blueprintDtuId }), the offspring owes its
      // owning parent-creator a royalty lineage. We mint a minimal, honest
      // offspring blueprint DTU (owned by the breeder) so lineage has a
      // real child to attach, then register one royalty citation per owned,
      // non-self parent. Wild / un-owned parents are skipped honestly — no
      // citation, no error. Nothing here changes the breeding genetics/
      // compat math above, and the pre-existing return fields are all
      // preserved byte-for-byte; offspringDtuId + citations are additive.
      let offspringDtuId = null;
      let citations = [];
      const breederId = csUserId(ctx);
      if (breederId && !CS_AUTH_ANON.has(breederId)) {
        const ownedParents = [
          csResolveOwnedCreatureParent(db, a),
          csResolveOwnedCreatureParent(db, b),
        ].filter(Boolean);
        if (ownedParents.length > 0) {
          try {
            const childDtuId = csId("dtu");
            const now = csNow();
            const childSpecies = result.hybrid.species_id || result.hybrid.provenance?.description || "hybrid";
            const body = {
              title: `Bred hybrid — ${childSpecies}`,
              meta: {
                type: "creature_blueprint",
                kind: "offspring",
                species_id: childSpecies,
                topology: result.hybrid.topology,
                massKg: result.hybrid.massKg,
                heightM: result.hybrid.heightM,
                variant: result.hybrid.variant || result.hybrid.genotype?.variant || null,
                stability: result.stability,
                generation: result.generation,
                crossWorld: result.crossWorld,
                creatureId: result.hybrid.id,
              },
              lineage: { parents: ownedParents.map((p) => p.parentId) },
              human: { summary: `A bred hybrid offspring composed from ${ownedParents.length} owned parent creature(s).` },
            };
            db.prepare(`
              INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 'public', 'regular', ?, ?)
            `).run(childDtuId, breederId, body.title, JSON.stringify(body), JSON.stringify(["creature", "blueprint", "offspring"]), now, now);
            offspringDtuId = childDtuId;
            citations = csCiteParents(db, { parents: ownedParents, childId: childDtuId, userId: breederId });
          } catch {
            // Honest failure — no fabricated lineage. If the offspring DTU
            // can't be minted (e.g. dtus table absent on a minimal build),
            // breeding still succeeds; we simply don't attach lineage.
            offspringDtuId = null;
            citations = [];
          }
        }
      }

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
        // Creatures-C additive fields (null / [] when no owned parents).
        offspringDtuId,
        citations,
      };
    } catch (e) {
      return { ok: false, reason: "breed_failed", error: e?.message };
    }
  }, { note: "crossbreed two species → a real physics-valid hybrid (delegates to creature-crossbreeding); owned-parent offspring registers royalty lineage" });

  /**
   * creatures.creature-publish — author/publish a creature as a real,
   * creator-attributed blueprint DTU (meta.type='creature_blueprint'). The
   * blueprint's geometry comes from the REAL procedural generator
   * (generateCreature) — never invented. When worldId + a finite position
   * are supplied, ALSO persists a live creature (a world_npcs row,
   * archetype='creature:<species>'); world_npcs has no owner/blueprint
   * column, so the linkage is stored honestly in the row's `state` JSON
   * ({ spawnedByUserId, blueprintDtuId, species_id }) and spawn_method is
   * stamped 'authored'. Otherwise mints the DTU only with spawned:false.
   * Each valid non-self parent in remixOfDtuIds registers a real royalty
   * citation (lineage only — money moves on a later SALE).
   *
   * input: { name?, speciesId | species_id, topology?, worldId?,
   *          position?: {x,y,z}, remixOfDtuIds?: string[], remixOfDtuId? }
   */
  register("creatures", "creature-publish", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db_unavailable" };
    const userId = csUserId(ctx);
    if (CS_AUTH_ANON.has(userId)) return { ok: false, error: "auth_required" };

    const speciesId = input.speciesId || input.species_id;
    if (!speciesId) return { ok: false, error: "missing_species_id" };
    const species = String(speciesId);
    const name = csClean(input.name, 160) || `Authored ${species}`;

    // Remix parents (Increment-5 shape) must genuinely exist — validated up
    // front so an invalid id is an honest rejection, not a silently-dropped
    // lineage. No insert has happened yet.
    const remixParentIds = csNormalizeParentIds(input.remixOfDtuId, input.remixOfDtuIds);
    let parentRows = new Map();
    if (remixParentIds.length > 0) {
      const lookup = csLookupDtuParents(db, remixParentIds);
      if (lookup.missingId) return { ok: false, error: "parent_not_found", parentId: lookup.missingId };
      parentRows = lookup.rows;
    }

    // Build the REAL, physics-validated blueprint. topology is optional —
    // the generator infers it from the species when omitted.
    const worldId = input.worldId || input.world_id || "concordia-hub";
    const topology = input.topology || topologyForSpecies(species);
    let blueprint;
    try {
      blueprint = generateCreature({ description: species, worldId, topology, origin: "authored" });
    } catch (e) {
      return { ok: false, error: "generate_failed", message: e?.message };
    }

    // ── Mint the creator-attributed blueprint DTU ──────────────────────
    const dtuId = csId("dtu");
    const now = csNow();
    const body = {
      title: name,
      meta: {
        type: "creature_blueprint",
        kind: "authored",
        species_id: species,
        topology: blueprint.topology,
        massKg: blueprint.massKg,
        heightM: blueprint.heightM,
        partCount: Array.isArray(blueprint.parts) ? blueprint.parts.length : 0,
        clade: taxonomyForSpecies(species).clade,
        aquatic: isAquaticSpecies(species),
      },
      human: { summary: `${name} — an authored ${blueprint.topology} creature blueprint (${species}).` },
    };
    if (remixParentIds.length > 0) body.lineage = { parents: remixParentIds };
    db.prepare(`
      INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'public', 'regular', ?, ?)
    `).run(dtuId, userId, name, JSON.stringify(body), JSON.stringify(["creature", "blueprint", species]), now, now);

    // ── Optionally spawn a live creature ───────────────────────────────
    // Only when a real world + finite position are supplied — never a
    // fabricated placement. Owner + blueprint linkage lives in `state`.
    const position = input.position && typeof input.position === "object" ? input.position : {};
    const px = csFiniteNum(position.x);
    const py = csFiniteNum(position.y);
    const pz = csFiniteNum(position.z);
    const wantsSpawn = !!worldId && px != null && py != null && pz != null;
    let creatureId = null;
    if (wantsSpawn) {
      try {
        creatureId = csId("wc");
        const state = JSON.stringify({ spawnedByUserId: userId, blueprintDtuId: dtuId, species_id: species });
        db.prepare(`
          INSERT INTO world_npcs (id, world_id, archetype, species_id, x, y, z, is_dead, state, spawn_method)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'authored')
        `).run(creatureId, String(worldId), `creature:${species}`, species, px, py, pz, state);
      } catch (e) {
        // Honest partial: the blueprint DTU is real and persisted; the live
        // spawn failed (e.g. minimal world_npcs schema). Report spawned:false
        // with the reason rather than fabricating a creature id.
        creatureId = null;
        const citations = remixParentIds.length > 0
          ? csCiteParents(db, {
              parents: remixParentIds.map((pid) => {
                const prow = parentRows.get(pid);
                return { parentId: pid, parentCreatorId: prow.owner_user_id, parentDtu: { ownerId: prow.owner_user_id, visibility: prow.visibility } };
              }),
              childId: dtuId, userId,
            })
          : [];
        return { ok: true, dtuId, creatureId: null, spawned: false, spawnError: e?.message || "spawn_failed", species_id: species, parents: remixParentIds, citations };
      }
    }

    // ── Remix → real royalty citations (one per valid non-self parent) ──
    const citations = remixParentIds.length > 0
      ? csCiteParents(db, {
          parents: remixParentIds.map((pid) => {
            const prow = parentRows.get(pid);
            return { parentId: pid, parentCreatorId: prow.owner_user_id, parentDtu: { ownerId: prow.owner_user_id, visibility: prow.visibility } };
          }),
          childId: dtuId, userId,
        })
      : [];

    return { ok: true, dtuId, creatureId, spawned: wantsSpawn, species_id: species, parents: remixParentIds, citations };
  }, { note: "author/publish a creature as a creator-attributed blueprint DTU (+ optional live spawn + remix royalty lineage)" });

  /**
   * creatures.creature-list-mine — the caller's authored creature blueprint
   * DTUs (meta.type='creature_blueprint'), newest first, each enriched with
   * its live spawn instances (world_npcs rows whose state.blueprintDtuId
   * points back). Honest empty list for anon / when the caller has authored
   * none.
   */
  register("creatures", "creature-list-mine", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db_unavailable" };
    const userId = csUserId(ctx);
    if (CS_AUTH_ANON.has(userId)) return { ok: true, creatures: [], count: 0 };

    let dtuRows = [];
    try {
      dtuRows = db.prepare(`
        SELECT id, title, body_json, visibility, created_at
        FROM dtus WHERE owner_user_id = ?
        ORDER BY created_at DESC
      `).all(userId);
    } catch { return { ok: true, creatures: [], count: 0 }; }

    const creatures = [];
    for (const row of dtuRows) {
      let body = {};
      try { body = JSON.parse(row.body_json || "{}"); } catch { continue; }
      if (body?.meta?.type !== "creature_blueprint") continue;
      let spawns = [];
      try {
        spawns = db.prepare(`
          SELECT id, world_id, x, y, z FROM world_npcs
          WHERE json_extract(state, '$.blueprintDtuId') = ? AND COALESCE(is_dead, 0) = 0
        `).all(row.id);
      } catch { spawns = []; }
      creatures.push({
        dtuId: row.id,
        name: row.title,
        species_id: body.meta.species_id ?? null,
        kind: body.meta.kind ?? null,
        topology: body.meta.topology ?? null,
        massKg: body.meta.massKg ?? null,
        variant: body.meta.variant ?? null,
        visibility: row.visibility,
        createdAt: row.created_at,
        spawnCount: spawns.length,
        spawns,
      });
    }
    return { ok: true, creatures, count: creatures.length };
  }, { note: "the caller's authored creature blueprint DTUs (+ their live spawns)" });
}
