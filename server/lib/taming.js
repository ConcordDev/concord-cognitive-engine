// server/lib/taming.js
//
// Wave 2 / T1.3 — player taming of wild creatures. Creature must be a
// world_npcs row with `archetype LIKE 'creature:%'`. Success roll is
// modulated by the existing `creature_bonds.bond` (built by proximity
// + shared environment) — so a creature you've spent time near is
// easier to tame.
//
// On success:
//   - world_npcs row is marked is_dead = 1 (removed from active sim)
//   - player_companions row is inserted with the creature's blueprint
//     persisted into blueprint_json so the 3D mesh follows the companion
//   - bestiary records a 'tamed' kind sighting

import crypto from "crypto";

const BASE_TAME_CHANCE = 0.25;       // 25% baseline before bond/skill
const BOND_TAME_BONUS_MAX = 0.45;    // up to +45% from a maxed bond (200)
const SKILL_TAME_BONUS_MAX = 0.30;   // up to +30% from Lv10 wilderness skill

/**
 * Compute the success probability for a single tame attempt.
 * Exposed so the UI can show "Tame chance: 64%" before the player commits.
 */
export function tameChance(db, userId, creatureId) {
  const bond = _getPlayerCreatureBond(db, userId, creatureId);
  const skillLevel = _getWildernessSkillLevel(db, userId);
  const bondBonus = Math.min(BOND_TAME_BONUS_MAX, (bond / 200) * BOND_TAME_BONUS_MAX);
  const skillBonus = Math.min(SKILL_TAME_BONUS_MAX, (skillLevel / 10) * SKILL_TAME_BONUS_MAX);
  return Math.max(0.05, Math.min(0.95, BASE_TAME_CHANCE + bondBonus + skillBonus));
}

/**
 * Attempt to tame a wild creature. Returns:
 *   { ok: true, success: true, companion }    on tame
 *   { ok: true, success: false, retryAfterBondReset }   on failed roll
 *   { ok: false, reason }                       on validation failure
 */
export function attemptTame(db, userId, creatureId, { rng = Math.random, name } = {}) {
  if (!db || !userId || !creatureId) return { ok: false, reason: "invalid_args" };

  const npc = db.prepare(`
    SELECT id, world_id, archetype, species_id, x, y, z,
           mass_kg AS massKg, height_m AS heightM, topology
    FROM world_npcs
    WHERE id = ? AND COALESCE(is_dead, 0) = 0
  `).get(creatureId);

  if (!npc) return { ok: false, reason: "creature_not_found" };
  if (typeof npc.archetype !== "string" || !npc.archetype.startsWith("creature:")) {
    return { ok: false, reason: "not_a_creature" };
  }

  // Already owned by anyone?
  const existing = db.prepare(`SELECT id FROM player_companions WHERE creature_id = ?`).get(creatureId);
  if (existing) return { ok: false, reason: "already_owned" };

  const chance = tameChance(db, userId, creatureId);
  const roll = rng();
  if (roll > chance) {
    // Failure resets the bond half-way as the creature flees / distrusts.
    _decayBond(db, userId, creatureId, 0.5);
    return { ok: true, success: false, chance, roll, retryAfterBondReset: true };
  }

  // Success — build a blueprint snapshot from the NPC's procedural-creature
  // fields and persist it on the companion row.
  const blueprint = {
    id: creatureId,
    topology: npc.topology || "quadruped",
    massKg: npc.massKg ?? 40,
    heightM: npc.heightM ?? 1.2,
    worldId: npc.world_id,
    parts: [],
    abilityFlavors: [],
  };

  const companionId = crypto.randomUUID();
  const companionName = name || `${(npc.species_id || npc.archetype || "Companion").replace(/^creature:/, "")} Friend`;

  // Insert companion row + remove the NPC from the active sim. Single tx.
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO player_companions
        (id, owner_id, creature_id, name, tame_bond, loyalty, level, xp,
         world_id, deployed, blueprint_json, source_kind, source_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      companionId, userId, creatureId, companionName,
      100, 50, 1, 0,
      npc.world_id, 0,
      JSON.stringify(blueprint),
      "world_npc",
      creatureId,
    );
    db.prepare(`UPDATE world_npcs SET is_dead = 1, died_at = unixepoch() WHERE id = ?`).run(creatureId);
  });

  try { tx(); }
  catch (err) { return { ok: false, reason: "persist_failed", message: err?.message }; }

  // Bestiary — log the tame.
  try {
    const { recordSighting } = require_or_import("./bestiary.js");
    recordSighting?.(db, userId, {
      worldId: npc.world_id,
      kind: "tamed",
      speciesRef: companionId,
      meta: { sourceNpcId: creatureId, archetype: npc.archetype, species: npc.species_id },
    });
  } catch { /* best-effort */ }

  return {
    ok: true,
    success: true,
    chance,
    roll,
    companion: {
      id: companionId,
      ownerId: userId,
      creatureId,
      name: companionName,
      worldId: npc.world_id,
      blueprint,
    },
  };
}

// Sync wrapper so callers above can both import or require this module.
// Node's ESM doesn't allow `require()` directly; this helper just dynamic-
// imports and caches.
const _cache = new Map();
function require_or_import(rel) {
  if (_cache.has(rel)) return _cache.get(rel);
  // ESM lazy load — best-effort sync use is only safe after a tick.
  // Callers above tolerate undefined (bestiary log is best-effort).
  import(rel).then((mod) => _cache.set(rel, mod)).catch(() => _cache.set(rel, null));
  return _cache.get(rel);
}

function _getPlayerCreatureBond(db, userId, creatureId) {
  try {
    // Bond rows are sorted-pair PK. The "player side" id is userId.
    const [a, b] = userId < creatureId ? [userId, creatureId] : [creatureId, userId];
    const row = db.prepare(`SELECT bond FROM creature_bonds WHERE a_id = ? AND b_id = ?`).get(a, b);
    return row?.bond ?? 0;
  } catch { return 0; }
}

function _decayBond(db, userId, creatureId, factor) {
  try {
    const [a, b] = userId < creatureId ? [userId, creatureId] : [creatureId, userId];
    db.prepare(`UPDATE creature_bonds SET bond = MAX(0, bond * ?) WHERE a_id = ? AND b_id = ?`)
      .run(1 - factor, a, b);
  } catch { /* table optional */ }
}

function _getWildernessSkillLevel(db, userId) {
  try {
    const row = db.prepare(`
      SELECT MAX(level) AS lv FROM player_skill_levels
      WHERE user_id = ? AND skill_type IN ('wilderness', 'survival', 'hunting')
    `).get(userId);
    return row?.lv ?? 0;
  } catch { return 0; }
}

/**
 * Breed two of the caller's companions. Calls into the existing
 * generateHybrid pipeline from creature-crossbreeding.js — its schema
 * doesn't care if the parents are NPCs or companions, both produce a
 * world_hybrid_creatures row. We also clone the offspring into the
 * caller's player_companions so they OWN the new hybrid.
 *
 * Returns:
 *   { ok: true, hybrid, companion }   on success
 *   { ok: false, reason }              on validation failure
 */
export async function breedCompanions(db, userId, aCompanionId, bCompanionId, { name } = {}) {
  if (!db || !userId || !aCompanionId || !bCompanionId) return { ok: false, reason: "invalid_args" };
  if (aCompanionId === bCompanionId) return { ok: false, reason: "self_pair" };

  const a = db.prepare(`SELECT * FROM player_companions WHERE id = ? AND owner_id = ?`).get(aCompanionId, userId);
  const b = db.prepare(`SELECT * FROM player_companions WHERE id = ? AND owner_id = ?`).get(bCompanionId, userId);
  if (!a || !b) return { ok: false, reason: "companion_not_found" };

  const aBlueprint = _tryParseJSON(a.blueprint_json);
  const bBlueprint = _tryParseJSON(b.blueprint_json);
  if (!aBlueprint || !bBlueprint) return { ok: false, reason: "missing_blueprint" };

  // generateHybrid checks bond via getBond(db, aId, bId). We forge a bond
  // row above threshold so the player-paired companions can always breed
  // (taming was the gate — at this point the player owns both).
  try {
    const { recordEncounter, generateHybrid } = await import("./creature-crossbreeding.js");
    for (let i = 0; i < 25; i++) {
      recordEncounter(db, {
        aId: aCompanionId, bId: bCompanionId,
        worldA: a.world_id, worldB: b.world_id,
        sameEnvironmentBonus: true, sharedThreatBonus: true,
      });
    }

    const hybridResult = generateHybrid(db, {
      a: { ...aBlueprint, id: aCompanionId, worldId: a.world_id, skillIds: [], abilitySeeds: [] },
      b: { ...bBlueprint, id: bCompanionId, worldId: b.world_id, skillIds: [], abilitySeeds: [] },
      environment: null,
      generation: 1,
    });
    if (!hybridResult.ok) return { ok: false, reason: hybridResult.reason ?? "generate_failed" };

    // Spawn the offspring into world_hybrid_creatures (so it renders) AND
    // into player_companions (so the player owns it).
    const childBlueprint = hybridResult.hybrid;
    const childId = `hybrid_${crypto.randomBytes(6).toString("hex")}`;
    const x = ((a.world_id === b.world_id) ? (Math.random() - 0.5) * 4 : 0);
    const z = ((a.world_id === b.world_id) ? (Math.random() - 0.5) * 4 : 0);

    db.prepare(`
      INSERT INTO world_hybrid_creatures
        (id, world_id, x, y, z, blueprint_json, parent_a, parent_b, generation, stability, cross_world, alive, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, unixepoch())
    `).run(
      childId, childBlueprint.worldId || a.world_id,
      x, 0, z,
      JSON.stringify(childBlueprint),
      aCompanionId, bCompanionId,
      hybridResult.generation ?? 1,
      hybridResult.stability ?? 0.5,
      hybridResult.crossWorld ? 1 : 0,
    );

    const companionId = crypto.randomUUID();
    const companionName = name || `${(childBlueprint.topology || "Creature").replace(/_/g, " ")} Spawn`;
    db.prepare(`
      INSERT INTO player_companions
        (id, owner_id, creature_id, name, tame_bond, loyalty, level, xp,
         world_id, deployed, blueprint_json, source_kind, source_ref)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      companionId, userId, childId, companionName,
      150, 75, 1, 0,
      childBlueprint.worldId || a.world_id, 0,
      JSON.stringify(childBlueprint),
      "bred",
      childId,
    );

    // Bestiary entry — kind='bred'
    try {
      const { recordSighting } = await import("./bestiary.js");
      recordSighting(db, userId, {
        worldId: childBlueprint.worldId || a.world_id,
        kind: "bred",
        speciesRef: companionId,
        meta: { hybridId: childId, parents: [aCompanionId, bCompanionId] },
      });
    } catch { /* best-effort */ }

    return {
      ok: true,
      hybrid: { ...hybridResult, hybridId: childId },
      companion: {
        id: companionId,
        ownerId: userId,
        creatureId: childId,
        name: companionName,
        worldId: childBlueprint.worldId || a.world_id,
        blueprint: childBlueprint,
      },
    };
  } catch (err) {
    return { ok: false, reason: "internal_error", message: err?.message };
  }
}

function _tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }
