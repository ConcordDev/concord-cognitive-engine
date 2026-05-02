/**
 * Emergent Skills Registry
 *
 * In Concordia, skills/abilities are NOT picked from a static list. They are
 * AUTHORED at runtime by NPCs, emergents, users, and enemies during gameplay,
 * and they propagate as records that other creatures can later learn,
 * inherit, or evolve.
 *
 * A Skill is structured data (not code). It declares:
 *   - prerequisites (body parts, mass range, gait kind, other skills)
 *   - costs (stamina, mana, cooldown, fuel)
 *   - effects (declarative rules the resolver can interpret: damage, push,
 *     heal, summon, transform, etc.)
 *   - origin (the entity that created it + the gameplay event that crystallized it)
 *
 * The world resolver is the runtime that, given a skill + an actor + a
 * target, applies the effects. Effects are bounded by an "effect grammar"
 * so authored skills cannot break the simulation — but the grammar is
 * expressive enough that an emergent NPC can compose new ones.
 *
 * This module exposes:
 *   - createSkill(seed)             — author a new skill
 *   - listSkills(filter)            — query with prerequisite filters
 *   - attachSkills(creatureBlueprint) — pick which skills a creature can
 *                                       use given its body
 *   - evolveSkill(parentId, mutator) — create a derivative skill (for
 *                                       creature-driven skill trees)
 *
 * Persistence: skills live in a SQLite table (migration 082). In-memory
 * cache mirrors the table for fast reads during combat/AI ticks.
 */

import crypto from "crypto";

/* ── Effect grammar ───────────────────────────────────────────────── */

/**
 * The atomic effect kinds an emergent skill can compose. Anything outside
 * this set is rejected so a malicious or hallucinated skill cannot break
 * the simulation. Combat resolver implements each kind explicitly.
 */
export const EFFECT_KINDS = Object.freeze(new Set([
  "damage",         // { amount, kind: 'physical'|'fire'|'cold'|'shock'|'poison'|'soul', radius? }
  "heal",           // { amount, target: 'self'|'ally' }
  "displace",       // { force, direction: 'forward'|'away'|'toward', distance }
  "stun",           // { durationMs }
  "buff",           // { stat: 'speed'|'damage'|'defense'|'stealth', delta, durationMs }
  "debuff",         // { stat, delta, durationMs }
  "summon",         // { creatureSeed }   // creates another procedural creature
  "transform",      // { topology }       // changes the actor's topology temporarily
  "terrain",        // { kind: 'fire'|'ice'|'pit'|'wall', radius, durationMs }
  "ranged_projectile", // { speed, damage, kind, ttlMs }
  "channel",        // { tickEvents: Effect[], ticks, intervalMs }   // sustained channel
]));

/* ── Skill schema ─────────────────────────────────────────────────── */

/**
 * @typedef {Object} SkillEffect
 * @property {string} kind            one of EFFECT_KINDS
 * @property {object} params          per-kind payload
 *
 * @typedef {Object} SkillRequirements
 * @property {string[]} bodyParts     part KINDS the actor must have ("wing", "arm", "leg", ...)
 * @property {string[]} topologies    topologies allowed (or empty for any)
 * @property {{min:number, max:number}} [massKg]   mass range
 * @property {string[]} [requiresSkills] other skill ids the actor must already know
 *
 * @typedef {Object} SkillCosts
 * @property {number} [stamina]
 * @property {number} [mana]
 * @property {number} [cooldownMs]
 * @property {string} [fuel]          item id consumed (e.g., "arrow")
 *
 * @typedef {Object} Skill
 * @property {string} id
 * @property {string} name
 * @property {string} verb            short imperative ("strike", "incinerate", "veil", "bind")
 * @property {SkillRequirements} requires
 * @property {SkillCosts} costs
 * @property {SkillEffect[]} effects
 * @property {object} provenance      { origin, parentId?, createdAt, gameplayEvent }
 * @property {number} version
 */

/* ── In-memory cache ──────────────────────────────────────────────── */

const _cache = new Map(); // id -> Skill

/* ── Persistence ──────────────────────────────────────────────────── */

/** Ensure the storage table exists. Idempotent. */
export function ensureSkillsTable(db) {
  if (!db) return;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS emergent_skills (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        verb            TEXT,
        json            TEXT NOT NULL,
        origin          TEXT,
        parent_id       TEXT,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_emergent_skills_parent ON emergent_skills(parent_id);
      CREATE INDEX IF NOT EXISTS idx_emergent_skills_origin ON emergent_skills(origin);
    `);
  } catch { /* idempotent */ }
}

function _persist(db, skill) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO emergent_skills (id, name, verb, json, origin, parent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, verb=excluded.verb, json=excluded.json
    `).run(skill.id, skill.name, skill.verb, JSON.stringify(skill), skill.provenance?.origin ?? null, skill.provenance?.parentId ?? null);
  } catch { /* persistence best-effort */ }
}

function _load(db) {
  if (!db) return;
  try {
    const rows = db.prepare(`SELECT json FROM emergent_skills`).all();
    for (const r of rows) {
      try {
        const s = JSON.parse(r.json);
        if (s?.id) _cache.set(s.id, s);
      } catch { /* skip malformed */ }
    }
  } catch { /* table may not exist on first call */ }
}

/* ── Validation ───────────────────────────────────────────────────── */

function _validateSkill(skill) {
  if (!skill?.name || !skill?.verb) return { ok: false, reason: "missing name/verb" };
  if (!Array.isArray(skill.effects) || skill.effects.length === 0)
    return { ok: false, reason: "no effects" };
  for (const eff of skill.effects) {
    if (!EFFECT_KINDS.has(eff.kind)) return { ok: false, reason: `unknown effect kind: ${eff.kind}` };
  }
  if (!skill.requires) skill.requires = { bodyParts: [], topologies: [] };
  if (!skill.costs)    skill.costs = {};
  return { ok: true };
}

/* ── Public API ───────────────────────────────────────────────────── */

/**
 * Create a new emergent skill from a seed. Caller supplies origin (npc id,
 * user id, etc.) and gameplayEvent (what crystallized this skill, e.g.
 * "killed a fire-breathing dragon and absorbed its breath").
 *
 * @returns {{ ok:true, skill:Skill } | { ok:false, reason:string }}
 */
export function createSkill(db, seed) {
  const id = `skl_${crypto.randomBytes(6).toString("hex")}`;
  const skill = {
    id,
    name:    String(seed?.name ?? "unnamed"),
    verb:    String(seed?.verb ?? "act"),
    requires: seed?.requires ?? { bodyParts: [], topologies: [] },
    costs:    seed?.costs ?? {},
    effects:  Array.isArray(seed?.effects) ? seed.effects : [],
    provenance: {
      origin:        seed?.origin ?? "emergent",
      parentId:      seed?.parentId ?? null,
      createdAt:     new Date().toISOString(),
      gameplayEvent: seed?.gameplayEvent ?? "",
    },
    version: 1,
  };

  const v = _validateSkill(skill);
  if (!v.ok) return { ok: false, reason: v.reason };

  _cache.set(id, skill);
  _persist(db, skill);
  return { ok: true, skill };
}

/**
 * Create a derivative skill — a mutation of an existing one. Useful when an
 * NPC observes another creature use a skill and adapts it (with shifts in
 * costs / effect magnitudes / requirements).
 */
export function evolveSkill(db, parentId, mutator) {
  const parent = _cache.get(parentId);
  if (!parent) return { ok: false, reason: "parent_not_found" };
  const mutated = mutator(JSON.parse(JSON.stringify(parent)));
  mutated.id = undefined;
  mutated.provenance = {
    origin:        mutated?.provenance?.origin ?? "emergent",
    parentId,
    createdAt:     new Date().toISOString(),
    gameplayEvent: mutated?.provenance?.gameplayEvent ?? "",
  };
  return createSkill(db, mutated);
}

/** Look up a skill by id. */
export function getSkill(id) { return _cache.get(id) ?? null; }

/** List all skills, optionally filtered. */
export function listSkills(filter = {}) {
  const all = [..._cache.values()];
  return all.filter(s => {
    if (filter.origin && s.provenance.origin !== filter.origin) return false;
    if (filter.parentId && s.provenance.parentId !== filter.parentId) return false;
    return true;
  });
}

/**
 * Pick which skills a creature can use given its body.
 *
 * For each skill, check:
 *   - the creature's part list contains every required body part KIND
 *   - the creature's topology matches (or skill has no topology constraint)
 *   - mass is within range (if specified)
 *
 * Returns an array of skill ids the creature qualifies for. Caller writes
 * these into the blueprint.skillIds field.
 *
 * @param {object} blueprint   CreatureBlueprint from procedural-creature.js
 * @param {object} [opts]      { limit? } default 12
 */
export function attachSkills(blueprint, opts = {}) {
  const limit = opts.limit ?? 12;
  const partKinds = new Set((blueprint.parts ?? []).map(p => p.kind));
  const eligible = [];

  for (const s of _cache.values()) {
    const r = s.requires ?? {};
    if (Array.isArray(r.bodyParts) && r.bodyParts.length > 0) {
      const hasAll = r.bodyParts.every(bp => partKinds.has(bp));
      if (!hasAll) continue;
    }
    if (Array.isArray(r.topologies) && r.topologies.length > 0) {
      if (!r.topologies.includes(blueprint.topology)) continue;
    }
    if (r.massKg) {
      if (typeof r.massKg.min === "number" && blueprint.massKg < r.massKg.min) continue;
      if (typeof r.massKg.max === "number" && blueprint.massKg > r.massKg.max) continue;
    }
    eligible.push(s.id);
    if (eligible.length >= limit) break;
  }
  return eligible;
}

/* ── Initialization helper ────────────────────────────────────────── */

/**
 * Boot helper: ensures the table exists, loads existing rows into the cache,
 * and seeds a SMALL set of universal-baseline skills if the cache is empty
 * so the world isn't completely skill-less on first boot. Anyone (NPCs,
 * users) can author new skills above and beyond this baseline.
 */
export function bootEmergentSkills(db) {
  ensureSkillsTable(db);
  _load(db);
  if (_cache.size === 0) {
    // Seed universal baseline. These are intentionally minimal — the
    // emergent system grows beyond this organically through play.
    createSkill(db, {
      name: "strike", verb: "strike",
      requires: { bodyParts: ["arm"], topologies: [] },
      costs:    { stamina: 6, cooldownMs: 400 },
      effects:  [{ kind: "damage", params: { amount: 8, kind: "physical" } }],
      origin: "baseline", gameplayEvent: "world boot",
    });
    createSkill(db, {
      name: "bite", verb: "bite",
      requires: { bodyParts: ["head"], topologies: [] },
      costs:    { stamina: 5, cooldownMs: 600 },
      effects:  [{ kind: "damage", params: { amount: 10, kind: "physical" } }],
      origin: "baseline", gameplayEvent: "world boot",
    });
    createSkill(db, {
      name: "wingbeat", verb: "wingbeat",
      requires: { bodyParts: ["wing"], topologies: ["winged_quadruped", "winged_biped"] },
      costs:    { stamina: 14, cooldownMs: 1500 },
      effects:  [
        { kind: "displace", params: { force: 220, direction: "away", distance: 8 } },
        { kind: "debuff",   params: { stat: "speed", delta: -0.4, durationMs: 1500 } },
      ],
      origin: "baseline", gameplayEvent: "world boot",
    });
  }
  return { count: _cache.size };
}
