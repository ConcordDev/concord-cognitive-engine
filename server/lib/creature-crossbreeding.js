/**
 * Creature Crossbreeding System
 *
 * Two creatures that share enough time, environment, and bond can produce a
 * hybrid offspring. Hybrids are PHYSICS-VALIDATED — the resulting body must
 * still obey its world's rules. Most are unstable; rare ones stabilize across
 * generations and become new baseline species. Cross-world hybrids (only
 * possible via the Concord Link) are legendary and often unstable.
 *
 * Pipeline:
 *   1. recordEncounter(a, b, env)  — increments bond between two creatures
 *      whenever they're co-located. Decays without continued proximity.
 *   2. checkCompatibility(a, b)    — gates: same world (or both via link),
 *      environment supports both, bond >= threshold, no taxonomy collisions.
 *   3. generateHybrid(a, b, env)   — composes a new blueprint:
 *        - topology = blend rules (winged_quadruped × quadruped → winged_quadruped)
 *        - mass     = midpoint * stability factor
 *        - parts    = inherits dominant parent's skeleton + adds key wing/tail
 *        - skills   = union of parent skill sets, then evolveSkill() one or two
 *        - abilities= "tension abilities" emerge from conflicting traits
 *        - stability = 0..1, computed from physics divergence between parents
 *
 * Storage:
 *   creature_bonds (a_id, b_id, bond, last_seen_at, environment, world)
 *   creature_lineage (child_id, parent_a, parent_b, generation, stability,
 *                     created_at, cross_world)
 *
 * The Concord Link integration: when both parents come from different worlds
 * and bonded through a Link Walker delivery, the resulting hybrid's
 * stability cap is lower (rare/unstable by design) but its ability pool
 * gets a flavor union (so a fantasy × cyber hybrid can have both magic
 * and glitch effects).
 */

import crypto from "crypto";
import { generateCreature, validateCreaturePhysics, WORLD_MODIFIERS, TOPOLOGIES } from "./procedural-creature.js";
import { evolveSkill, getSkill, createSkill, attachSkills } from "./emergent-skills.js";

/* ── Bond tracking ────────────────────────────────────────────────── */

const BOND_THRESHOLD       = 100;
const BOND_DECAY_PER_TICK  = 0.5;
const BOND_INCREMENT       = 5;
const SAME_ENV_BONUS       = 1.5;
const SHARED_THREAT_BONUS  = 2.0;

export function ensureCrossbreedingTables(db) {
  if (!db) return;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS creature_bonds (
        a_id           TEXT NOT NULL,
        b_id           TEXT NOT NULL,
        world_a        TEXT,
        world_b        TEXT,
        bond           REAL NOT NULL DEFAULT 0,
        environment    TEXT,
        last_seen_at   INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (a_id, b_id)
      );
      CREATE INDEX IF NOT EXISTS idx_creature_bonds_b   ON creature_bonds(b_id);
      CREATE INDEX IF NOT EXISTS idx_creature_bonds_lvl ON creature_bonds(bond DESC);

      CREATE TABLE IF NOT EXISTS creature_lineage (
        child_id     TEXT PRIMARY KEY,
        parent_a     TEXT NOT NULL,
        parent_b     TEXT NOT NULL,
        generation   INTEGER NOT NULL DEFAULT 1,
        stability    REAL NOT NULL DEFAULT 0.5,
        cross_world  INTEGER NOT NULL DEFAULT 0,
        blueprint    TEXT,
        created_at   INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_creature_lineage_parent_a ON creature_lineage(parent_a);
      CREATE INDEX IF NOT EXISTS idx_creature_lineage_parent_b ON creature_lineage(parent_b);
    `);
  } catch { /* idempotent */ }
}

function _orderedPair(aId, bId) {
  return aId < bId ? [aId, bId] : [bId, aId];
}

/**
 * Record that two creatures shared the same environment for a moment.
 * Increases bond, with a bonus when both are in their preferred environment
 * or facing the same threat. Bonds decay if not refreshed.
 */
export function recordEncounter(db, { aId, bId, worldA, worldB, environment = null, sameEnvironmentBonus = false, sharedThreatBonus = false }) {
  if (!db || !aId || !bId || aId === bId) return { ok: false, reason: "invalid_pair" };
  const [a, b] = _orderedPair(aId, bId);

  let inc = BOND_INCREMENT;
  if (sameEnvironmentBonus) inc *= SAME_ENV_BONUS;
  if (sharedThreatBonus)    inc *= SHARED_THREAT_BONUS;

  db.prepare(`
    INSERT INTO creature_bonds (a_id, b_id, world_a, world_b, bond, environment, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, unixepoch())
    ON CONFLICT(a_id, b_id) DO UPDATE SET
      bond         = MIN(creature_bonds.bond + excluded.bond, 200),
      environment  = COALESCE(excluded.environment, creature_bonds.environment),
      last_seen_at = unixepoch()
  `).run(a, b, worldA ?? null, worldB ?? null, inc, environment);

  return { ok: true, increment: inc };
}

/** Decay all bonds that haven't been refreshed recently. Called by heartbeat. */
export function decayBonds(db, now = Math.floor(Date.now() / 1000)) {
  if (!db) return { decayed: 0 };
  try {
    const r = db.prepare(`
      UPDATE creature_bonds
         SET bond = MAX(0, bond - ?)
       WHERE last_seen_at < ? - 60
    `).run(BOND_DECAY_PER_TICK, now);
    // Drop fully-decayed rows so the table doesn't grow forever.
    db.prepare(`DELETE FROM creature_bonds WHERE bond <= 0`).run();
    return { decayed: r.changes };
  } catch { return { decayed: 0 }; }
}

/** Read the current bond between two creatures (0 if no row). */
export function getBond(db, aId, bId) {
  if (!db) return 0;
  const [a, b] = _orderedPair(aId, bId);
  const row = db.prepare(`SELECT bond FROM creature_bonds WHERE a_id=? AND b_id=?`).get(a, b);
  return row?.bond ?? 0;
}

/* ── Compatibility ────────────────────────────────────────────────── */

const TOPOLOGY_BLEND_RULES = {
  // Both winged → winged
  "winged_quadruped+winged_quadruped": "winged_quadruped",
  "winged_quadruped+quadruped":        "winged_quadruped",
  "winged_quadruped+humanoid":         "winged_biped",
  "winged_quadruped+winged_biped":     "winged_quadruped",
  "winged_biped+humanoid":             "winged_biped",
  "winged_biped+winged_biped":         "winged_biped",
  "humanoid+humanoid":                 "humanoid",
  "humanoid+quadruped":                "humanoid", // dominant biped
  "quadruped+quadruped":               "quadruped",
  "serpentine+serpentine":             "serpentine",
  "serpentine+amorphous":              "serpentine",
  "amorphous+amorphous":               "amorphous",
  "polyped+polyped":                   "polyped",
  "polyped+amorphous":                 "polyped",
};

function blendTopologies(tA, tB) {
  const key1 = `${tA}+${tB}`;
  const key2 = `${tB}+${tA}`;
  if (TOPOLOGY_BLEND_RULES[key1]) return TOPOLOGY_BLEND_RULES[key1];
  if (TOPOLOGY_BLEND_RULES[key2]) return TOPOLOGY_BLEND_RULES[key2];
  // Default: dominant-mass parent wins; ambiguous cases go humanoid.
  return tA;
}

/**
 * @returns {{ ok:true } | { ok:false, reason:string, bondNeeded?:number }}
 */
export function checkCompatibility({ a, b, bond, environment }) {
  if (!a || !b)               return { ok: false, reason: "missing_parents" };
  if (a.id === b.id)          return { ok: false, reason: "self_pair" };

  // Same-world by default; cross-world is permitted but harder (handled below).
  const sameWorld = a.worldId === b.worldId;
  const requiredBond = sameWorld ? BOND_THRESHOLD : BOND_THRESHOLD * 2;
  if ((bond ?? 0) < requiredBond) {
    return { ok: false, reason: "bond_too_low", bondNeeded: requiredBond, current: bond ?? 0 };
  }

  // Environment compatibility: if either creature has a strong env preference
  // (encoded in baseline traits), reject mismatched habitats.
  if (environment?.kind && a.environmentRequirement && a.environmentRequirement !== environment.kind) {
    return { ok: false, reason: "environment_mismatch_a" };
  }
  if (environment?.kind && b.environmentRequirement && b.environmentRequirement !== environment.kind) {
    return { ok: false, reason: "environment_mismatch_b" };
  }

  return { ok: true, sameWorld };
}

/* ── Hybrid generation ────────────────────────────────────────────── */

/**
 * Compose a hybrid blueprint from two parents. Returns the blueprint plus
 * a stability score in [0,1]. Most hybrids land between 0.3 and 0.6 — the
 * tension between parent traits keeps them unstable. Cross-world hybrids
 * cap at 0.4 stability unless multiple successive generations smooth it.
 *
 * The hybrid inherits abilities from both parents and the system also
 * tries to authoring a SINGLE NEW "tension ability" that emerges from the
 * conflict of the parents' flavors (fire+ice, magic+glitch, etc.).
 */
export function generateHybrid(db, { a, b, environment = null, generation = 1 }) {
  const compat = checkCompatibility({ a, b, bond: getBond(db, a.id, b.id), environment });
  if (!compat.ok) return { ok: false, reason: compat.reason, ...compat };

  const crossWorld = a.worldId !== b.worldId;
  const childWorld = crossWorld ? "concordia" : a.worldId;
  const topology   = blendTopologies(a.topology, b.topology);

  // Mass: midpoint, biased toward the lighter parent so the body can support itself.
  const mass = (a.massKg + b.massKg) / 2 * 0.85;
  const heightM = (a.heightM + b.heightM) / 2 * 0.95;

  // Combined description for narrative provenance.
  const description = `${a.provenance?.description ?? a.id} × ${b.provenance?.description ?? b.id} hybrid`;

  // Build the blueprint via the standard generator so physics validation
  // and gait + body parts are derived correctly from topology + mass.
  const blueprint = generateCreature({
    description,
    topology,
    massKg:  mass,
    heightM,
    worldId: childWorld,
    origin:  "crossbreed",
  });

  // Inherited skills: union of parent skill sets, deduped, capped at 16.
  const inheritedSkillIds = [...new Set([...(a.skillIds ?? []), ...(b.skillIds ?? [])])].slice(0, 16);
  blueprint.skillIds = inheritedSkillIds;

  // Stability — measure parent divergence:
  //   topology distance + world difference + mass ratio
  const massRatio = Math.abs(a.massKg - b.massKg) / Math.max(a.massKg, b.massKg);
  let stability = 1.0
    - (a.topology !== b.topology ? 0.25 : 0)
    - (crossWorld ? 0.35 : 0)
    - massRatio * 0.3;
  stability = Math.max(0.05, Math.min(crossWorld ? 0.4 : 1.0, stability));
  // Generations smooth instability.
  stability = Math.min(1.0, stability + (generation - 1) * 0.08);

  // Try authoring ONE tension ability when both parents have ability seeds.
  let tensionSkill = null;
  const tensionSeed = _composeTensionAbility(a, b);
  if (tensionSeed) {
    const created = createSkill(db, { ...tensionSeed, origin: "crossbreed", gameplayEvent: `hybrid of ${a.id} + ${b.id}` });
    if (created.ok) {
      tensionSkill = created.skill;
      blueprint.skillIds.push(created.skill.id);
    }
  }

  // Persist lineage.
  if (db) {
    try {
      ensureCrossbreedingTables(db);
      db.prepare(`
        INSERT INTO creature_lineage (child_id, parent_a, parent_b, generation, stability, cross_world, blueprint, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
      `).run(blueprint.id, a.id, b.id, generation, stability, crossWorld ? 1 : 0, JSON.stringify(blueprint));
    } catch { /* persist best-effort */ }
  }

  return {
    ok: true,
    hybrid: blueprint,
    stability,
    crossWorld,
    inheritedSkillIds,
    tensionSkill,
    parents: [a.id, b.id],
    generation,
  };
}

/** Heuristic: compose a tension ability when parents have conflicting effect kinds. */
function _composeTensionAbility(a, b) {
  const aFlavors = new Set(WORLD_MODIFIERS[a.worldId]?.abilityFlavors ?? []);
  const bFlavors = new Set(WORLD_MODIFIERS[b.worldId]?.abilityFlavors ?? []);
  const flavorPair = [...aFlavors, ...bFlavors];

  // Pick a stack of effects that pulls from both.
  const aSeed = (a.abilitySeeds ?? [])[0];
  const bSeed = (b.abilitySeeds ?? [])[0];
  if (!aSeed && !bSeed) return null;

  const effects = [];
  if (aSeed?.effects?.[0]) effects.push(aSeed.effects[0]);
  if (bSeed?.effects?.[0]) effects.push(bSeed.effects[0]);
  if (effects.length === 0) return null;

  // Add a debuff that captures the "hybrid is unstable" cost.
  effects.push({ kind: "debuff", params: { stat: "defense", delta: -0.2, durationMs: 4000 } });

  return {
    name: `tension_${flavorPair.slice(0, 2).join("_") || "hybrid"}`,
    verb: "unleash_tension",
    requires: { bodyParts: [], topologies: [] },
    costs:    { stamina: 14, cooldownMs: 4500 },
    effects,
  };
}

/**
 * High-level helper: drives the full pipeline.
 *   recordEncounter()  →  generateHybrid() if bond crosses threshold.
 * Returns the generated hybrid (or { ok:false, reason }).
 */
export function maybeCrossbreed(db, { a, b, environment, sameEnvironmentBonus = false, sharedThreatBonus = false }) {
  recordEncounter(db, {
    aId: a.id, bId: b.id, worldA: a.worldId, worldB: b.worldId,
    environment: environment?.kind ?? null,
    sameEnvironmentBonus, sharedThreatBonus,
  });
  const compat = checkCompatibility({ a, b, bond: getBond(db, a.id, b.id), environment });
  if (!compat.ok) return { ok: false, ...compat };
  return generateHybrid(db, { a, b, environment });
}

/** Read lineage for a creature — direct parents and children. */
export function getLineage(db, creatureId) {
  if (!db) return null;
  try {
    // TODO: project explicit columns (auto-fix suggestion)
    const asChild  = db.prepare(`SELECT * FROM creature_lineage WHERE child_id = ?`).get(creatureId);
    // TODO: project explicit columns (auto-fix suggestion)
    const asParent = db.prepare(`SELECT * FROM creature_lineage WHERE parent_a = ? OR parent_b = ? ORDER BY created_at DESC`).all(creatureId, creatureId);
    return { self: asChild ?? null, descendants: asParent };
  } catch { return null; }
}
