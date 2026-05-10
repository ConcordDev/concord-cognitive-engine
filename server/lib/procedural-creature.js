/**
 * Procedural Creature Generation
 *
 * Concordia's creatures are NOT picked from a static bestiary. When an NPC
 * tells the player "a dragon attacked our village," that description is the
 * SEED for a creature that gets spawned with:
 *   1. A procedurally generated body topology (limbs, wings, tail, etc.)
 *   2. Physics-validated proportions (a dragon's wingspan must support its
 *      mass; a giant lizard's legs must hold its weight)
 *   3. A procedural gait keyed to topology (biped, quadruped, winged-quad,
 *      serpentine, polyped, etc.)
 *   4. An emergent skill set drawn from CreatureSkillsRegistry — abilities
 *      that other NPCs/users have created and that match this creature's
 *      body capabilities.
 *
 * The generator accepts a structured description (or a free-text prompt for
 * an LLM expand-step upstream) and returns a CreatureBlueprint that
 * AvatarSystem3D / a host renderer can instantiate.
 *
 * Physics validation rules (heuristic; tunable):
 *   - For winged flight: total wing area >= mass * G / (rho * Cl * v_min^2)
 *     simplified to: wingArea >= mass * 0.05 m²/kg (sea level, normal lift Cl)
 *     A 200kg dragon needs >=10m² of wing area total.
 *   - For terrestrial gait: limb cross-section area >= mass / (count * 1500)
 *     A 50kg quadruped needs each leg >= 8.3 cm² cross-section.
 *   - For serpentine: body length >= 2 * sqrt(mass / 8) so big snakes are long.
 *
 * If the LLM asks for an impossible body (a 1000kg dragon with sparrow wings),
 * the generator REJECTS it back to the caller with a specific reason. The
 * narrative system can then re-roll the description or shrink the creature.
 */

import crypto from "crypto";
import { readFileSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const G = 9.81; // gravity
const AIR_DENSITY = 1.225;

// ── World-flavor modifiers ────────────────────────────────────────────────
//
// Each world (superhero / fantasy / crime / cyber) applies a different
// physics + flavor profile to procedural creatures. Heavier-than-life
// fantasy creatures get a strength bonus; cyber creatures get a glitch
// (phase) capability; crime creatures get pain immunity; superhero
// creatures get power-tier scaling.

export const WORLD_MODIFIERS = Object.freeze({
  superhero: {
    massScale:     1.0,
    strengthScale: 1.5,           // super-physics
    abilityFlavors: ["energy", "mutation", "tech"],
    description: "modern city + super-powered physics",
  },
  fantasy: {
    massScale:     1.1,           // mythic creatures slightly heavier
    strengthScale: 1.3,
    abilityFlavors: ["magic", "curse", "nature"],
    description: "magic overrides some rules but still has limits",
  },
  crime: {
    massScale:     1.0,
    strengthScale: 1.2,
    abilityFlavors: ["drugs", "cybernetics", "trauma"],
    description: "real-world physics, exaggerated brutality",
  },
  cyber: {
    massScale:     0.95,          // hard-light projections weigh less
    strengthScale: 1.1,
    abilityFlavors: ["glitch", "data", "neural"],
    description: "real + digital physics; data corruption permitted",
  },
  concordia: {
    massScale: 1.0, strengthScale: 1.0,
    abilityFlavors: ["balanced"],
    description: "the hub world; default physics",
  },
});

// Sprint C / Track C2 — aquatic ability flavors. Layered onto WORLD_MODIFIERS
// per-creature when topology is one of AQUATIC_TOPOLOGIES. The
// procedural-creature pipeline picks one ability flavor per creature; aquatic
// topologies pick from this set instead of (or in addition to) the world's
// default flavors.
export const AQUATIC_ABILITY_FLAVORS = Object.freeze([
  "bioluminescence",  // emissive material 1-4 spots; 25% in dark water
  "electric",         // lightning element on contact (eels especially)
  "pressure",         // reduces nearby player oxygen 2× rate (deep zones)
  "ink",              // deploys cloud particle on threat (cephalopods)
  "echolocation",     // NPC perception bonus / sonar pulses
]);

// ── Baseline creature loader ──────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = join(__dir, "../../content");
const _baselineCache = new Map(); // worldId -> creatures[]

function loadBaselineCreatures(worldId) {
  if (_baselineCache.has(worldId)) return _baselineCache.get(worldId);
  let creatures = [];
  try {
    const p = join(CONTENT_ROOT, "world", worldId, "creatures.json");
    creatures = JSON.parse(readFileSync(p, "utf8"));
  } catch { /* world has no baselines yet */ }
  _baselineCache.set(worldId, creatures);
  return creatures;
}

/** Find a baseline creature in a world matching the description text. */
export function matchBaseline(worldId, description) {
  const baselines = loadBaselineCreatures(worldId);
  const text = String(description || "").toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const c of baselines) {
    let score = 0;
    if (text.includes(c.name.toLowerCase())) score += 3;
    for (const word of (c.name + " " + c.description).toLowerCase().split(/\W+/)) {
      if (word.length > 4 && text.includes(word)) score += 1;
    }
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore >= 2 ? best : null;
}

/** List the baseline creatures registered for a world. */
export function listBaselines(worldId) {
  return loadBaselineCreatures(worldId);
}

export const TOPOLOGIES = Object.freeze([
  "humanoid",        // 2 legs, 2 arms, 1 head
  "quadruped",       // 4 legs, 1 head, optional tail
  "winged_quadruped",// 4 legs + 2 wings, 1 head, optional tail   (dragons, gryphons)
  "winged_biped",    // 2 legs + 2 wings (raptors, harpies)
  "serpentine",      // long body, no/small limbs (snakes, eels) — terrestrial
  "polyped",         // 6+ legs (insects, crustaceans)
  "amorphous",       // no fixed limbs (slimes, oozes)
  // Sprint C / Track C2 — aquatic topologies for marine biomes.
  "fish",            // generic streamlined fish (caudal fin sweep)
  "eel",             // serpentine ribbon body, sinusoidal undulation
  "cephalopod",      // soft body + 6-8 procedural tentacles, jet propulsion
  "shark",           // torpedo body + caudal fin, predatory pursuit
]);

/** Topologies that live entirely in water (used by spawner depth gates). */
export const AQUATIC_TOPOLOGIES = Object.freeze(["fish", "eel", "cephalopod", "shark"]);

/**
 * @typedef {Object} CreatureSeed
 * @property {string} description       free-text or structured short description
 * @property {string} [topology]        one of TOPOLOGIES (auto-inferred if missing)
 * @property {number} [massKg]          target mass in kg
 * @property {number} [heightM]         standing/wing-tip-to-tip height
 * @property {string[]} [traits]        e.g. ["fire-breathing", "armored", "swift"]
 * @property {string} [origin]          npcId or 'authored' or 'emergent'
 */

/**
 * @typedef {Object} BodyPart
 * @property {string} name              "torso", "leftWing", "tail", ...
 * @property {string} kind              "torso" | "head" | "leg" | "arm" | "wing" | "tail" | "limb"
 * @property {number} massKg
 * @property {{x:number,y:number,z:number}} dimensions   half-extents for primitives
 * @property {string} parent            parent part name (or "" for root)
 * @property {{x:number,y:number,z:number}} attach       attachment offset on parent
 */

/**
 * @typedef {Object} CreatureBlueprint
 * @property {string} id
 * @property {string} topology
 * @property {number} massKg
 * @property {number} heightM
 * @property {BodyPart[]} parts
 * @property {object} gait                procedural gait params
 * @property {string[]} skillIds          references to CreatureSkillsRegistry
 * @property {object} validation          { ok:true } | { ok:false, reason }
 * @property {object} provenance          { description, origin, seedHash }
 */

/* ───────────────────────────────────────────────────────────────────── */

function seedHash(s) {
  return crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
}

function _seededRng(hashHex) {
  let s = parseInt(hashHex.slice(0, 8), 16);
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/* ── Topology inference ───────────────────────────────────────────── */

const TOPOLOGY_KEYWORDS = {
  winged_quadruped: ["dragon", "wyvern", "drake", "gryphon", "manticore", "chimera"],
  winged_biped:     ["harpy", "raptor", "phoenix", "thunderbird", "garuda"],
  quadruped:        ["wolf", "lion", "bear", "horse", "cat", "dog", "ox", "stag", "deer", "tiger", "boar", "hound"],
  serpentine:       ["snake", "serpent", "naga", "wyrm", "eel", "viper", "cobra"],
  polyped:          ["spider", "scorpion", "centipede", "crab", "insect", "ant"],
  amorphous:        ["slime", "ooze", "blob", "elemental", "shade"],
  humanoid:         ["man", "woman", "child", "human", "elf", "dwarf", "orc", "goblin", "ogre", "giant", "knight", "warrior", "mage"],
};

function inferTopology(description) {
  const text = String(description || "").toLowerCase();
  // Score each topology by keyword presence
  let bestTop = "humanoid";
  let bestScore = 0;
  for (const [top, kws] of Object.entries(TOPOLOGY_KEYWORDS)) {
    let s = 0;
    for (const kw of kws) if (text.includes(kw)) s += 1;
    if (s > bestScore) { bestScore = s; bestTop = top; }
  }
  return bestTop;
}

/* ── Mass / scale inference ───────────────────────────────────────── */

const SIZE_KEYWORDS = {
  tiny:    { min: 0.5,  max: 5,    height: 0.4 },
  small:   { min: 5,    max: 30,   height: 1.0 },
  medium:  { min: 30,   max: 120,  height: 1.8 },
  large:   { min: 120,  max: 600,  height: 3.5 },
  huge:    { min: 600,  max: 3000, height: 7.0 },
  colossal:{ min: 3000, max: 20000, height: 15.0 },
};

function inferMassAndHeight(description, topology, rng) {
  const text = String(description || "").toLowerCase();
  let band = "medium";
  if (/colossal|titan|leviathan|behemoth/.test(text)) band = "colossal";
  else if (/huge|massive|towering|enormous|elder/.test(text))    band = "huge";
  else if (/large|big|great\s/.test(text))                       band = "large";
  else if (/small|young|cub|juvenile/.test(text))                band = "small";
  else if (/tiny|baby|miniature|swarm-?member/.test(text))       band = "tiny";

  // Topology adjusts: dragons skew large, slimes skew small, polypeds stay tiny→medium
  if (topology === "winged_quadruped" && band === "medium") band = "large";
  if (topology === "amorphous" && band === "medium")        band = "small";
  if (topology === "polyped"   && band === "huge")          band = "large";

  const range = SIZE_KEYWORDS[band];
  const massKg  = range.min + rng() * (range.max - range.min);
  const heightM = range.height * (0.85 + rng() * 0.3);
  return { massKg: Math.round(massKg * 10) / 10, heightM: Math.round(heightM * 100) / 100 };
}

/* ── Body topology builders ───────────────────────────────────────── */

function buildHumanoidParts(massKg, heightM) {
  const torsoMass = massKg * 0.45;
  const headMass  = massKg * 0.08;
  const limbMass  = (massKg - torsoMass - headMass) / 4;
  const torsoH    = heightM * 0.35;
  const limbR     = Math.cbrt(limbMass / 1000) * 0.5;

  return [
    { name: "torso", kind: "torso", massKg: torsoMass, dimensions: { x: heightM*0.18, y: torsoH/2, z: heightM*0.10 }, parent: "", attach: { x:0,y:0,z:0 } },
    { name: "head",  kind: "head",  massKg: headMass,  dimensions: { x: heightM*0.10, y: heightM*0.10, z: heightM*0.10 }, parent: "torso", attach: { x:0,y:torsoH/2 + heightM*0.05, z:0 } },
    { name: "leftArm",  kind: "arm",  massKg: limbMass, dimensions: { x:limbR, y:heightM*0.15, z:limbR }, parent: "torso", attach: { x:-heightM*0.20, y: torsoH/2 - 0.05, z:0 } },
    { name: "rightArm", kind: "arm",  massKg: limbMass, dimensions: { x:limbR, y:heightM*0.15, z:limbR }, parent: "torso", attach: { x: heightM*0.20, y: torsoH/2 - 0.05, z:0 } },
    { name: "leftLeg",  kind: "leg",  massKg: limbMass, dimensions: { x:limbR*1.2, y:heightM*0.20, z:limbR*1.2 }, parent: "torso", attach: { x:-heightM*0.10, y:-torsoH/2, z:0 } },
    { name: "rightLeg", kind: "leg",  massKg: limbMass, dimensions: { x:limbR*1.2, y:heightM*0.20, z:limbR*1.2 }, parent: "torso", attach: { x: heightM*0.10, y:-torsoH/2, z:0 } },
  ];
}

function buildQuadrupedParts(massKg, heightM, withTail = true) {
  const bodyMass = massKg * 0.55;
  const headMass = massKg * 0.10;
  const legMass  = (massKg - bodyMass - headMass) / 4 - (withTail ? 1 : 0);
  const tailMass = withTail ? (massKg - bodyMass - headMass - legMass*4) : 0;
  const limbR = Math.cbrt(legMass / 800) * 0.5;
  const bodyL = heightM * 1.6;
  const bodyH = heightM * 0.5;

  const parts = [
    { name: "torso", kind: "torso", massKg: bodyMass, dimensions: { x: heightM*0.25, y: bodyH/2, z: bodyL/2 }, parent: "", attach: {x:0,y:0,z:0} },
    { name: "head",  kind: "head",  massKg: headMass, dimensions: { x: heightM*0.18, y: heightM*0.18, z: heightM*0.20 }, parent: "torso", attach: { x:0, y: bodyH*0.3, z: bodyL/2 + heightM*0.15 } },
    { name: "frontLeftLeg",  kind: "leg", massKg: legMass, dimensions: { x:limbR, y: heightM*0.4, z:limbR }, parent: "torso", attach: { x:-heightM*0.20, y:-bodyH/2, z: bodyL*0.30 } },
    { name: "frontRightLeg", kind: "leg", massKg: legMass, dimensions: { x:limbR, y: heightM*0.4, z:limbR }, parent: "torso", attach: { x: heightM*0.20, y:-bodyH/2, z: bodyL*0.30 } },
    { name: "rearLeftLeg",   kind: "leg", massKg: legMass, dimensions: { x:limbR, y: heightM*0.4, z:limbR }, parent: "torso", attach: { x:-heightM*0.20, y:-bodyH/2, z:-bodyL*0.30 } },
    { name: "rearRightLeg",  kind: "leg", massKg: legMass, dimensions: { x:limbR, y: heightM*0.4, z:limbR }, parent: "torso", attach: { x: heightM*0.20, y:-bodyH/2, z:-bodyL*0.30 } },
  ];
  if (withTail) {
    parts.push({ name: "tail", kind: "tail", massKg: tailMass, dimensions: { x:limbR*0.6, y:limbR*0.6, z: bodyL*0.7 }, parent: "torso", attach: { x:0, y:bodyH*0.1, z:-bodyL/2 - bodyL*0.35 } });
  }
  return parts;
}

function buildWingedParts(baseParts, massKg, heightM) {
  // Wings sized to support flight given mass (sized minimally to pass validation).
  const requiredWingArea = massKg * 0.05; // m² total
  const wingArea = requiredWingArea * 1.15; // 15% margin
  const wingSpan = Math.sqrt(wingArea * 4); // approximate aspect ratio 4:1
  const wingChord = wingArea / (wingSpan / 2); // per-wing
  const wingMass = (massKg * 0.06); // wing pair total

  return [
    ...baseParts,
    { name: "leftWing",  kind: "wing", massKg: wingMass / 2, dimensions: { x: wingSpan / 2, y: 0.05, z: wingChord }, parent: "torso", attach: { x:-heightM*0.15, y: heightM*0.20, z: 0 } },
    { name: "rightWing", kind: "wing", massKg: wingMass / 2, dimensions: { x: wingSpan / 2, y: 0.05, z: wingChord }, parent: "torso", attach: { x: heightM*0.15, y: heightM*0.20, z: 0 } },
  ];
}

function buildSerpentineParts(massKg, heightM, rng) {
  // Serpentine: body length scales with mass; lots of small segments.
  const length = Math.max(2, 2 * Math.sqrt(massKg / 8));
  const segCount = Math.max(6, Math.round(length * 2));
  const segMass  = massKg / segCount;
  const segR     = Math.cbrt(segMass * 0.0008);

  const parts = [{
    name: "head", kind: "head", massKg: segMass * 1.5,
    dimensions: { x: segR*1.3, y: segR*1.3, z: segR*1.5 },
    parent: "", attach: {x:0,y:0,z:0},
  }];
  let prev = "head";
  for (let i = 0; i < segCount - 1; i++) {
    const name = `segment_${i}`;
    parts.push({
      name, kind: "torso", massKg: segMass,
      dimensions: { x: segR, y: segR, z: segR * 1.2 },
      parent: prev,
      attach: { x: 0, y: 0, z: -segR * 1.5 },
    });
    prev = name;
  }
  return parts;
}

function buildPolypedParts(massKg, heightM, rng) {
  // 6 to 8 legs around a flat body.
  const legCount = 6 + Math.floor(rng() * 3); // 6..8
  const bodyMass = massKg * 0.6;
  const headMass = massKg * 0.05;
  const legMass = (massKg - bodyMass - headMass) / legCount;
  const bodyR = Math.cbrt(massKg / 800);

  const parts = [
    { name: "torso", kind: "torso", massKg: bodyMass, dimensions: { x: bodyR, y: bodyR * 0.3, z: bodyR }, parent: "", attach: {x:0,y:0,z:0} },
    { name: "head",  kind: "head",  massKg: headMass, dimensions: { x: bodyR*0.4, y: bodyR*0.4, z: bodyR*0.5 }, parent: "torso", attach: { x:0, y:bodyR*0.2, z:bodyR } },
  ];
  for (let i = 0; i < legCount; i++) {
    const a = (i / legCount) * Math.PI * 2;
    parts.push({
      name: `leg_${i}`, kind: "leg", massKg: legMass,
      dimensions: { x: bodyR*0.08, y: heightM*0.4, z: bodyR*0.08 },
      parent: "torso",
      attach: { x: Math.cos(a) * bodyR * 0.9, y: -bodyR*0.15, z: Math.sin(a) * bodyR * 0.9 },
    });
  }
  return parts;
}

function buildAmorphousParts(massKg, heightM) {
  const r = Math.cbrt(massKg / 1000) * 0.6;
  return [
    { name: "core", kind: "torso", massKg: massKg, dimensions: { x: r, y: r * 0.7, z: r }, parent: "", attach: {x:0,y:0,z:0} },
  ];
}

/* ── Physics validation ───────────────────────────────────────────── */

/**
 * Validate that the body proportions can support the creature's mass under
 * Concordia's physics. Returns { ok:true } or { ok:false, reason, fix }.
 * The `fix` field is advisory: it tells the caller how to shrink/scale the
 * creature so it would pass.
 */
export function validateCreaturePhysics(blueprint) {
  const { topology, massKg, parts } = blueprint;

  // Wing flight check
  if (topology === "winged_quadruped" || topology === "winged_biped") {
    const wings = parts.filter(p => p.kind === "wing");
    const wingArea = wings.reduce((s, w) => s + (w.dimensions.x * 2) * w.dimensions.z * 2, 0);
    const required = massKg * 0.05;
    if (wingArea < required) {
      return {
        ok: false,
        reason: `wings too small for mass (have ${wingArea.toFixed(1)}m², need ≥${required.toFixed(1)}m²)`,
        fix:    { suggestedMassKg: wingArea / 0.05, suggestedWingAreaM2: required },
      };
    }
  }

  // Terrestrial leg-strength check
  if (["humanoid", "quadruped", "winged_quadruped", "winged_biped", "polyped"].includes(topology)) {
    const legs = parts.filter(p => p.kind === "leg");
    if (legs.length === 0) return { ok: false, reason: "no legs for terrestrial creature" };
    const totalCrossSection = legs.reduce((s, l) => s + (l.dimensions.x * 2) * (l.dimensions.z * 2), 0);
    const required = massKg / 1500;
    if (totalCrossSection < required) {
      return {
        ok: false,
        reason: `legs too thin for mass (have ${(totalCrossSection*10000).toFixed(0)}cm² total, need ≥${(required*10000).toFixed(0)}cm²)`,
        fix:    { suggestedMassKg: totalCrossSection * 1500 },
      };
    }
  }

  // Serpentine length check
  if (topology === "serpentine") {
    const segs = parts.filter(p => p.kind === "torso").length;
    const minSegs = Math.max(6, Math.round(2 * Math.sqrt(massKg / 8) * 2));
    if (segs < minSegs) {
      return { ok: false, reason: `serpentine body too short for mass`, fix: { suggestedSegments: minSegs } };
    }
  }

  // Total-mass cohesion: sum of part mass within 5% of declared
  const summed = parts.reduce((s, p) => s + p.massKg, 0);
  const drift  = Math.abs(summed - massKg) / massKg;
  if (drift > 0.05) {
    return { ok: false, reason: `part-mass sum (${summed.toFixed(1)}kg) drifts from total (${massKg.toFixed(1)}kg) by ${(drift*100).toFixed(1)}%`, fix: { rescale: massKg / summed } };
  }

  return { ok: true };
}

/* ── Procedural gait params ───────────────────────────────────────── */

function buildGait(topology, massKg, heightM, rng) {
  const baseSpeed = Math.max(1.5, 6.0 / Math.cbrt(massKg / 70));
  switch (topology) {
    case "humanoid":   return { kind: "biped",       walkMps: baseSpeed,       runMps: baseSpeed * 2.4, strideHz: 1.3, gaitPattern: "alternating" };
    case "quadruped":  return { kind: "quadruped",   walkMps: baseSpeed * 1.2, runMps: baseSpeed * 3.0, strideHz: 1.8, gaitPattern: "trot/canter/gallop" };
    case "winged_quadruped":
    case "winged_biped": return { kind: "flight",   walkMps: baseSpeed * 0.7, runMps: baseSpeed * 0.7, flyMps: baseSpeed * 5, flapHz: 1.0 + rng()*1.5, glideMps: baseSpeed * 8 };
    case "serpentine": return { kind: "slither",     walkMps: baseSpeed * 0.6, runMps: baseSpeed * 1.2, undulationHz: 1.5 + rng() };
    case "polyped":    return { kind: "polyped",     walkMps: baseSpeed * 0.9, runMps: baseSpeed * 1.8, gaitPattern: "alternating-tripod" };
    case "amorphous":  return { kind: "ooze",        walkMps: 0.5,             runMps: 1.2,             pulseHz: 0.5 + rng() };
    default:           return { kind: "biped",       walkMps: baseSpeed,       runMps: baseSpeed * 2.4, strideHz: 1.3 };
  }
}

/* ── Public API ───────────────────────────────────────────────────── */

/**
 * Generate a creature blueprint from a description seed. The caller may
 * supply a structured topology/mass/height; otherwise they are inferred
 * from the description text.
 *
 * Auto-rescales when validation fails (e.g., too-small wings) — if the
 * autofix succeeds the blueprint returns ok:true with provenance.rescaled.
 *
 * @param {CreatureSeed} seed
 * @returns {CreatureBlueprint}
 */
export function generateCreature(seed) {
  const description = seed?.description ?? "creature";
  const worldId     = seed?.worldId ?? "concordia";
  const worldMod    = WORLD_MODIFIERS[worldId] ?? WORLD_MODIFIERS.concordia;

  const id = `crt_${seedHash(description + Date.now())}`;
  const hash = seedHash(description);
  const rng  = _seededRng(hash);

  // Try matching against authored baselines first. A close match seeds
  // the topology + ability hints from the curated content rather than
  // re-inferring them from raw text.
  const baseline = matchBaseline(worldId, description);

  const topology = seed?.topology && TOPOLOGIES.includes(seed.topology)
    ? seed.topology
    : (baseline?.topology_hint ?? inferTopology(description));

  let { massKg, heightM } = (seed?.massKg && seed?.heightM)
    ? { massKg: seed.massKg, heightM: seed.heightM }
    : inferMassAndHeight(baseline?.description ? `${baseline.description} ${description}` : description, topology, rng);

  // World massScale: fantasy creatures are slightly heavier, cyber lighter.
  massKg *= worldMod.massScale;

  let parts = _partsFor(topology, massKg, heightM, rng);
  let validation = validateCreaturePhysics({ topology, massKg, parts });
  let rescaled = false;

  // Auto-fix pass: handle both fix shapes returned by validateCreaturePhysics:
  //   • suggestedMassKg — wing/leg checks: declared mass exceeds what the
  //     body can support; rescale mass downward to the supportable maximum.
  //   • rescale         — part-mass drift: sum of part masses ≠ declared
  //     mass within 5%; align declared mass to the actual sum.
  // Up to eight passes — fixing one constraint can reveal another (e.g.,
  // shrinking wings cascades into a leg-thickness check, then a part-mass
  // drift check). For colossal creatures the chain can be long.
  for (let pass = 0; pass < 8 && !validation.ok; pass++) {
    if (validation.fix?.suggestedMassKg) {
      // 15% safety margin: rebuilt parts can fall short of the suggested
      // ceiling by a few percent, so undershoot to converge in fewer passes.
      massKg = validation.fix.suggestedMassKg * 0.85;
      parts = _partsFor(topology, massKg, heightM, rng);
      rescaled = true;
    } else if (validation.fix?.rescale) {
      // Reconcile by aligning declared mass to summed part mass.
      const summed = parts.reduce((s, p) => s + p.massKg, 0);
      massKg = summed;
      rescaled = true;
    } else {
      break;
    }
    validation = validateCreaturePhysics({ topology, massKg, parts });
  }

  const gait = buildGait(topology, massKg, heightM, rng);

  return {
    id,
    worldId,
    topology,
    massKg,
    heightM,
    strengthMultiplier: worldMod.strengthScale,
    parts,
    gait,
    skillIds:   [], // populated separately by attachSkills()
    abilitySeeds: baseline?.emergent_ability_seeds ?? [],
    abilityFlavors: worldMod.abilityFlavors,
    validation,
    provenance: {
      description,
      origin:     seed?.origin ?? "emergent",
      seedHash:   hash,
      rescaled,
      worldId,
      baselineId: baseline?.id ?? null,
    },
  };
}

function _partsFor(topology, massKg, heightM, rng) {
  switch (topology) {
    case "humanoid":          return buildHumanoidParts(massKg, heightM);
    case "quadruped":         return buildQuadrupedParts(massKg, heightM, true);
    case "winged_quadruped":  return buildWingedParts(buildQuadrupedParts(massKg, heightM, true), massKg, heightM);
    case "winged_biped":      return buildWingedParts(buildHumanoidParts(massKg, heightM), massKg, heightM);
    case "serpentine":        return buildSerpentineParts(massKg, heightM, rng);
    case "polyped":           return buildPolypedParts(massKg, heightM, rng);
    case "amorphous":         return buildAmorphousParts(massKg, heightM);
    default:                  return buildHumanoidParts(massKg, heightM);
  }
}
