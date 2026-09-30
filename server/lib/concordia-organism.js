/**
 * Concordia megaworld — a creature is a persistent organism, not a spawn.
 *
 * Two loops, one world:
 *
 *   Genome → organism → ecology → civilization → history → presentation
 *   Person → needs → action → consequence → memory → place → history → presentation
 *
 * They meet at WorldField + world_consequences + place. Do not rebuild
 * fauna-spawner, creature-needs, npc-needs, food-web, or the Unity
 * CreatureCompiler (other branch). Compose them.
 *
 * Authored catalog fields are returned. Missing prey / pack / territory
 * stay empty — never a fabricated hunting list.
 *
 *   cd server && node --test tests/concordia-organism.test.js
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CREATURE_NEED_KINDS, freshCreatureNeeds } from "./ecosystem/creature-needs.js";
import { NEED_KINDS as PERSON_NEED_KINDS, freshNeeds as freshPersonNeeds } from "./npc-needs.js";
import { preyForPredator } from "./ecosystem/food-web.js";
import { fieldAt, fieldKeyForWorld, geographicEffectiveness, localRules } from "./concordia-world-field.js";
import { recordConsequence } from "./world-consequence.js";

export const ORGANISM_LOOPS = Object.freeze({
  creature: Object.freeze(["genome", "organism", "ecology", "civilization", "history", "presentation"]),
  person: Object.freeze(["person", "needs", "action", "consequence", "memory", "place", "history", "presentation"]),
});

export { CREATURE_NEED_KINDS, PERSON_NEED_KINDS, freshCreatureNeeds, freshPersonNeeds };

const CONTENT_WORLD = join(dirname(fileURLToPath(import.meta.url)), "../../content/world");

const _species = [];
let _catalogLoaded = false;

function loadCatalog() {
  if (_catalogLoaded) return;
  _catalogLoaded = true;
  let dirs = [];
  try { dirs = readdirSync(CONTENT_WORLD); } catch { return; }
  for (const folder of dirs) {
    let items;
    try {
      items = JSON.parse(readFileSync(join(CONTENT_WORLD, folder, "creatures.json"), "utf8"));
    } catch { continue; }
    if (!Array.isArray(items)) continue;
    for (const row of items) {
      if (!row?.id) continue;
      _species.push({
        id: row.id,
        name: row.name || row.id,
        worldId: row.world_id || folder,
        description: row.description || "",
        topologyHint: row.topology_hint || null,
        sizeBand: row.size_band || null,
        startingBehavior: row.starting_behavior || null,
        prey: Array.isArray(row.prey) ? row.prey : null,
        pack: row.pack ?? row.pack_behavior ?? null,
        territory: row.territory || null,
      });
    }
  }
}

export function speciesById(id, worldId = null) {
  loadCatalog();
  const sid = String(id || "");
  if (!sid) return { ok: false, reason: "unknown_species" };
  const matches = _species.filter((s) => s.id === sid);
  if (worldId) {
    const hit = matches.find((s) => s.worldId === worldId);
    if (!hit) return { ok: false, reason: "unknown_species" };
    return { ok: true, species: hit };
  }
  if (matches.length === 1) return { ok: true, species: matches[0] };
  if (matches.length === 0) return { ok: false, reason: "unknown_species" };
  return {
    ok: false,
    reason: "ambiguous_species",
    worlds: matches.map((s) => s.worldId),
  };
}

/**
 * Prey from the catalog, else food-web edges for a real biome roster.
 * Unknown species → empty. Never invent "isolated targets" as a species id.
 */
export function preyOf(speciesId, { universe = null, biome = null } = {}) {
  const cat = speciesById(speciesId);
  if (cat.ok && Array.isArray(cat.species.prey)) return cat.species.prey.slice();
  if (universe && biome) {
    try {
      const list = preyForPredator(universe, biome, speciesId);
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  }
  return [];
}

export function habitatFitness({ originWorldId, x, z } = {}) {
  const field = fieldAt(x, z);
  if (!field.ok) return field;
  const key = fieldKeyForWorld(originWorldId);
  const fitness = key ? (field[key] || 0) : 0;
  return {
    ok: true,
    origin: key,
    fitness,
    suppressed: field.flowerLaw === true,
    flowerLaw: field.flowerLaw,
    dominant: field.dominant,
    field,
  };
}

/**
 * What the organism is *here*. Catalog + field + recorded needs.
 * Does not invent pack, prey, or a census.
 */
export function organismInField(opts = {}) {
  const {
    kind = "creature",
    speciesId = null,
    personId = null,
    originWorldId = null,
    x, z,
    nativeStrength = 0,
    adaptation = 0,
    needs = null,
    universe = null,
    biome = null,
  } = opts;
  const field = fieldAt(x, z);
  if (!field.ok) return field;

  const isPerson = kind === "person" || kind === "npc" || kind === "player";
  let species = null;
  if (!isPerson) {
    const cat = speciesById(speciesId, originWorldId || null);
    if (!cat.ok) return cat;
    species = cat.species;
  }

  const origin = originWorldId || species?.worldId || null;
  const habitat = habitatFitness({ originWorldId: origin, x, z });
  const domain = isPerson ? (opts.domain || "athletics") : (opts.domain || "magic");
  const geo = geographicEffectiveness({
    origin,
    x, z,
    domain,
    nativeStrength,
    adaptation,
    actorKind: isPerson ? (kind === "player" ? "player" : "person") : "creature",
  });
  const rules = localRules(field);
  const prey = isPerson ? [] : preyOf(speciesId, { universe, biome });

  return {
    ok: true,
    kind: isPerson ? "person" : "creature",
    id: isPerson ? personId : speciesId,
    species,
    needs: needs == null
      ? (isPerson ? freshPersonNeeds() : freshCreatureNeeds())
      : needs,
    habitatFitness: habitat.fitness,
    habitatSuppressed: habitat.suppressed,
    geographic: geo,
    localPhysics: rules,
    prey,
    pack: species?.pack ?? null,
    territory: species?.territory ?? null,
    field,
    loop: isPerson ? ORGANISM_LOOPS.person : ORGANISM_LOOPS.creature,
  };
}

/**
 * Same point → same field. This is where the two loops meet.
 */
export function sharedWorldSurface(x, z) {
  const field = fieldAt(x, z);
  if (!field.ok) return field;
  return { ok: true, field, rules: localRules(field) };
}

export function explainOrganism(opts = {}) {
  const o = organismInField(opts);
  if (!o.ok) return o;
  const name = o.species?.name || o.id || "someone";
  let because;
  if (o.kind === "person") {
    because = o.habitatSuppressed
      ? `${name} is under Flower Law. Local physics is civil.`
      : `${name} acts in the ${o.field.dominant} field. Local ${o.geographic.domain} physics is ${o.geographic.localPhysics.toFixed(2)}.`;
  } else if (o.habitatSuppressed) {
    because = `${name} is in the Hub well. Wild hunting is suppressed. Habitat fitness ${o.habitatFitness.toFixed(2)}.`;
  } else {
    const preyLine = o.prey.length
      ? ` Recorded prey: ${o.prey.join(", ")}.`
      : " Prey is unknown — the catalog has no list.";
    because = `${name} (authored ${o.species.worldId}). Habitat fitness ${o.habitatFitness.toFixed(2)} in the ${o.field.dominant} field. Magic coupling ${o.geographic.multiplier.toFixed(2)}.${preyLine}`;
  }
  return {
    ok: true,
    kind: o.kind,
    habitatFitness: o.habitatFitness,
    multiplier: o.geographic.multiplier,
    prey: o.prey,
    pack: o.pack,
    because,
  };
}

function tryConsequence(db, opts) {
  try { return recordConsequence(db, opts); }
  catch (e) { return { ok: false, reason: "consequence_unavailable", error: e?.message }; }
}

/**
 * Death writes the graph and tombstones the row. It never DELETE.
 */
export function recordOrganismDeath(db, opts = {}) {
  const targetId = opts.targetId || opts.id;
  if (!db || !targetId) return { ok: false, reason: "missing_inputs" };
  const actorKind = opts.actorKind || "system";
  const actorId = opts.actorId || "ecology";
  const action = opts.action === "hunt" ? "hunt" : "kill";
  const con = tryConsequence(db, {
    worldId: opts.worldId || "concordia-hub",
    actorKind,
    actorId,
    action,
    targetKind: opts.targetKind || (opts.kind === "person" ? "npc" : "creature"),
    targetId,
    location: opts.location || targetId,
    importance: opts.importance ?? 0.55,
    immediate: { speciesId: opts.speciesId || null, remains: true },
    longTerm: { deleted: false },
  });
  let tombstoned = false;
  try {
    const r = db.prepare(`UPDATE world_npcs SET is_dead = 1 WHERE id = ?`).run(targetId);
    tombstoned = (r?.changes || 0) > 0;
  } catch { /* table optional */ }
  let remaining = null;
  try {
    remaining = db.prepare(`SELECT id, is_dead FROM world_npcs WHERE id = ?`).get(targetId) || null;
  } catch { remaining = null; }
  return {
    ok: con.ok !== false,
    deleted: false,
    tombstoned,
    stillPresent: remaining != null,
    consequence: con,
  };
}

/**
 * Birth writes the graph. Does not insert a fabricated NPC — the caller
 * already has an id, or we refuse.
 */
export function recordOrganismBirth(db, opts = {}) {
  const id = opts.id || opts.targetId;
  if (!id) return { ok: false, reason: "missing_id" };
  return tryConsequence(db, {
    worldId: opts.worldId || "concordia-hub",
    actorKind: opts.actorKind || "system",
    actorId: opts.actorId || "ecology",
    action: "birth",
    targetKind: opts.targetKind || "creature",
    targetId: id,
    location: opts.location || id,
    importance: opts.importance ?? 0.4,
    immediate: { speciesId: opts.speciesId || null },
  });
}
