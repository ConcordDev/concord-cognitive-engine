/**
 * Concordia creature pillar — presentation of the existing genome / lineage /
 * ecology substrate on /unity-ws.
 *
 * Does not spawn creatures. Does not invent species. Compact cards come from
 * world_npcs (fauna-spawner) + creature_lineage (crossbreed) +
 * creature_population (food-web counts). Empty tables stay [].
 *
 *   cd server && node --test tests/concordia-creatures.test.js
 */

import { topologyForSpecies, taxonomyForSpecies } from "./species-taxonomy.js";
import { lifestyleForSpecies } from "./ecosystem/loot-tables.js";

const LIVE_CAP = 24;
const ECOLOGY_CAP = 16;

function parseBlueprint(raw) {
  if (!raw) return null;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}

function gaitKindFor(topology) {
  const t = String(topology || "");
  if (t.startsWith("winged") || t === "avian") return "winged";
  if (t === "serpentine" || t === "eel" || t === "fish" || t === "shark" || t === "cephalopod") return t;
  if (t === "polyped") return "polyped";
  if (t === "amorphous") return "amorphous";
  if (t === "humanoid") return "biped";
  return "quadruped";
}

function isFly(topology, gaitKind) {
  const g = gaitKind || gaitKindFor(topology);
  return g === "winged" || String(topology || "").startsWith("winged");
}

function isPredator(lifestyle) {
  return lifestyle === "carnivore";
}

function compactFromBlueprint(bp, row, lineage) {
  const speciesId = bp.species_id
    || bp.provenance?.baselineId
    || row?.species_id
    || String(row?.archetype || "").replace(/^creature:/, "")
    || "";
  const topology = bp.topology || topologyForSpecies(speciesId);
  const lifestyle = bp.lifestyle
    || taxonomyForSpecies(speciesId).diet
    || lifestyleForSpecies(speciesId)
    || "omnivore";
  const gait = bp.gait || {};
  const geno = bp.genotype || {};
  return {
    id: String(bp.id || row?.id || ""),
    speciesId,
    x: Number.isFinite(row?.x) ? row.x : null,
    y: Number.isFinite(row?.y) ? row.y : null,
    z: Number.isFinite(row?.z) ? row.z : null,
    topology,
    massKg: Number.isFinite(bp.massKg) ? bp.massKg : null,
    heightM: Number.isFinite(bp.heightM) ? bp.heightM : null,
    generation: Number.isInteger(lineage?.generation) ? lineage.generation : (Number(lineage?.generation) || 0),
    parentA: lineage?.parent_a || null,
    parentB: lineage?.parent_b || null,
    dominant: geno.dominant || geno.affinity || null,
    variant: bp.variant || geno.variant || null,
    affinity: geno.affinity || geno.dominant || null,
    gaitKind: gait.kind || gaitKindFor(topology),
    walkMps: Number.isFinite(gait.walkMps) ? gait.walkMps : null,
    lifestyle,
    predator: isPredator(lifestyle),
    fly: isFly(topology, gait.kind),
    stability: Number.isFinite(lineage?.stability) ? lineage.stability
      : (Number.isFinite(bp.genotype?.stability) ? bp.genotype.stability : null),
  };
}

function compactFromRow(row, lineage) {
  const bp = parseBlueprint(lineage?.blueprint);
  if (bp) return compactFromBlueprint(bp, row, lineage);
  const speciesId = row.species_id || String(row.archetype || "").replace(/^creature:/, "");
  const tax = taxonomyForSpecies(speciesId);
  const lifestyle = tax.diet || lifestyleForSpecies(speciesId) || "omnivore";
  const topology = tax.topology || topologyForSpecies(speciesId);
  return {
    id: String(row.id || ""),
    speciesId,
    x: Number.isFinite(row.x) ? row.x : null,
    y: Number.isFinite(row.y) ? row.y : null,
    z: Number.isFinite(row.z) ? row.z : null,
    topology,
    massKg: null,
    heightM: null,
    generation: Number(lineage?.generation) || 0,
    parentA: lineage?.parent_a || null,
    parentB: lineage?.parent_b || null,
    dominant: null,
    variant: null,
    affinity: null,
    gaitKind: gaitKindFor(topology),
    walkMps: null,
    lifestyle,
    predator: isPredator(lifestyle),
    fly: isFly(topology),
    stability: Number.isFinite(lineage?.stability) ? lineage.stability : null,
  };
}

/**
 * Live fauna + lineage cards for a world. Missing tables → []. Never fabricates
 * a creature that is not a world_npcs fauna row or a creature_lineage child.
 */
export function snapshotCreatures(db, worldId) {
  if (!db || !worldId) return [];
  const out = [];
  const seen = new Set();
  try {
    const live = db.prepare(`
      SELECT id, world_id, archetype, species_id, x, y, z
      FROM world_npcs
      WHERE world_id = ?
        AND is_dead = 0
        AND (archetype LIKE 'creature:%' OR species_id IS NOT NULL)
      LIMIT ?
    `).all(worldId, LIVE_CAP);
    for (const row of live) {
      const arch = String(row.archetype || "");
      if (!arch.startsWith("creature:") && !row.species_id) continue;
      let lineage = null;
      try {
        lineage = db.prepare(`SELECT * FROM creature_lineage WHERE child_id = ?`).get(row.id);
      } catch { /* lineage optional */ }
      const card = compactFromRow(row, lineage);
      if (!card.id) continue;
      seen.add(card.id);
      out.push(card);
    }
  } catch { /* world_npcs / is_dead optional on minimal builds */ }

  try {
    const kids = db.prepare(`
      SELECT child_id, parent_a, parent_b, generation, stability, blueprint
      FROM creature_lineage
      ORDER BY created_at DESC
      LIMIT ?
    `).all(LIVE_CAP);
    for (const lin of kids) {
      if (seen.has(lin.child_id)) continue;
      const bp = parseBlueprint(lin.blueprint);
      if (bp?.worldId && bp.worldId !== worldId && worldId !== "concordia-hub") continue;
      const card = compactFromBlueprint(bp || { id: lin.child_id }, null, lin);
      if (!card.id) continue;
      seen.add(card.id);
      out.push(card);
      if (out.length >= LIVE_CAP) break;
    }
  } catch { /* lineage optional */ }

  return out;
}

/**
 * Per-(biome, species) counts the fauna spawner already writes.
 * Empty / missing table → [].
 */
export function snapshotEcology(db, worldId) {
  if (!db || !worldId) return [];
  try {
    const rows = db.prepare(`
      SELECT species_id, biome, current_count, target_count, lifestyle
      FROM creature_population
      WHERE world_id = ?
      ORDER BY current_count DESC
      LIMIT ?
    `).all(worldId, ECOLOGY_CAP);
    return rows.map((r) => ({
      speciesId: r.species_id || "",
      biome: r.biome || "",
      count: Number(r.current_count) || 0,
      target: Number(r.target_count) || 0,
      lifestyle: r.lifestyle || lifestyleForSpecies(r.species_id) || "",
    })).filter((c) => c.speciesId);
  } catch {
    return [];
  }
}

/**
 * Thin emit of a real generateHybrid result. No invented child, no invented xz.
 */
export function announceCreatureBorn(result, worldId) {
  if (!result?.ok || !result.hybrid?.id) return { ok: false, reason: "no_hybrid" };
  const emit = globalThis._concordRealtimeEmit;
  if (typeof emit !== "function") return { ok: false, reason: "no_emit" };
  const hybrid = result.hybrid;
  const lineage = {
    generation: result.generation,
    parent_a: result.parents?.[0] || null,
    parent_b: result.parents?.[1] || null,
    stability: result.stability,
    blueprint: hybrid,
  };
  const card = compactFromBlueprint(hybrid, null, lineage);
  const wid = worldId || hybrid.worldId || "concordia-hub";
  emit("creature:born", {
    ...card,
    worldId: wid,
    childId: hybrid.id,
  }, { worldId: wid });
  return { ok: true, childId: hybrid.id };
}

export default { snapshotCreatures, snapshotEcology, announceCreatureBorn };
