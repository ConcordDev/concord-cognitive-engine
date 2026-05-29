// server/lib/skill-fusion.js
//
// WS4 — Breed + Evolve + Combine powers (the My Hero Academia engine).
//
// Bakugo's parents weren't as strong as Bakugo: Mitsuki's Glycerin sweat +
// Masaru's oxidation FUSED into Explosion — a novel power stronger than either.
// Today creature crossbreeding inherits the UNION of parent skills (no power
// gain). This module adds the fusion path: two compatible parent skills combine
// into a single new skill that is stronger than the stronger parent, with a
// combined element, bounded growth, diminishing returns across generations, an
// inbreeding penalty, and a deep-lineage "singularity" unlock (One-For-All).
//
// This is the escalation engine behind the outward-migration gradient (WS3):
// fused offspring are stronger, so they drift toward the frontier, which forms
// the food chain and keeps the world climbing over time.
//
// Pure (no DB/I/O) so it's deterministic + testable; callers persist the result
// as a fused-skill DTU via the existing createSkill path. All dials env-overridable.

function envNum(name, dflt, { min = 0, max = Infinity } = {}) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= min && v <= max ? v : dflt;
}

export const FUSION_DIALS = Object.freeze({
  gainMin: envNum("CONCORD_FUSION_GAIN_MIN", 1.2, { min: 1 }),     // unstable fusion
  gainMax: envNum("CONCORD_FUSION_GAIN_MAX", 1.85, { min: 1 }),     // perfectly stable fusion
  genDecay: envNum("CONCORD_FUSION_GEN_DECAY", 0.95, { min: 0.5, max: 1 }),
  inbredPenalty: envNum("CONCORD_FUSION_INBRED_PENALTY", 0.85, { min: 0.1, max: 1 }),
  singularityGen: Math.round(envNum("CONCORD_FUSION_SINGULARITY_GEN", 8, { min: 2 })),
  singularityBonus: envNum("CONCORD_FUSION_SINGULARITY_BONUS", 0.22, { min: 0 }),
});

/** Skill fusion is on by default (additive + desirable). Kill-switch: CONCORD_SKILL_FUSION=0. */
export function skillFusionEnabled() {
  return process.env.CONCORD_SKILL_FUSION !== "0";
}

// Iconic element combinations, keyed by the alphabetically-sorted pair. Anything
// not listed falls back to the dominant (stronger-parent) element.
const ELEMENT_FUSIONS = Object.freeze({
  "fire|water": "steam",
  "fire|ice": "steam",
  "air|fire": "explosion",      // Bakugo
  "fire|wind": "explosion",
  "fire|lightning": "plasma",
  "lightning|water": "storm",
  "ice|lightning": "storm",
  "earth|fire": "magma",
  "fire|physical": "magma",
  "earth|water": "mud",
  "physical|water": "mud",
  "bio|poison": "plague",
  "ice|water": "frost",
  "energy|physical": "force",
  "air|lightning": "tempest",
  "lightning|wind": "tempest",
});

// Flavor names for fused elements (deterministic pick by the seed below).
const FUSED_ELEMENT_NAMES = Object.freeze({
  steam: ["Scaldburst", "Boiling Veil"],
  explosion: ["Detonation", "Blastcore"],
  plasma: ["Plasma Lance", "Ion Surge"],
  storm: ["Tempest Surge", "Stormcaller"],
  magma: ["Magma Render", "Molten Core"],
  mud: ["Mire Grasp", "Quagmire"],
  plague: ["Plaguebloom", "Rotwind"],
  frost: ["Glacial Edge", "Permafrost"],
  force: ["Force Pulse", "Kinetic Wave"],
  tempest: ["Tempest Crash", "Galecharge"],
});

function norm(e) { return String(e || "physical").toLowerCase(); }

/** Combine two elements into one (iconic table, else the dominant element). Pure. */
export function combineElements(elemA, elemB, { dominant = null } = {}) {
  const a = norm(elemA), b = norm(elemB);
  if (a === b) return a;
  const key = [a, b].sort().join("|");
  if (ELEMENT_FUSIONS[key]) return ELEMENT_FUSIONS[key];
  return dominant ? norm(dominant) : a;
}

function cap(s) { return String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1); }

/** Deterministic small hash → integer, for stable name/variant picks. */
function seedInt(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Compose a fused skill name from parents + the resulting element. Pure. */
export function composeFusedName(nameA, nameB, fusedElement, seedKey = "") {
  const pool = FUSED_ELEMENT_NAMES[fusedElement];
  if (pool && pool.length) return pool[seedInt(`${nameA}|${nameB}|${seedKey}`) % pool.length];
  return `${cap(nameA || "Power")}-${cap(nameB || "Power")} Fusion`;
}

/**
 * Fuse two parent skills into a novel child skill stronger than the stronger
 * parent. Inputs are normalized descriptors: { name, element, maxDamage, rangeM }.
 *
 * @param {object} skillA
 * @param {object} skillB
 * @param {object} opts { stability=1 (0..1), generation=1, inbred=false, seedKey="" }
 * @returns {{ name, element, maxDamage, rangeM, fromElements, gain,
 *             unlockedHidden, generation, parents }}
 */
export function fuseTwoSkills(skillA, skillB, opts = {}) {
  const { stability = 1, generation = 1, inbred = false, seedKey = "" } = opts;
  const aDmg = Math.max(0, Number(skillA?.maxDamage) || 0);
  const bDmg = Math.max(0, Number(skillB?.maxDamage) || 0);
  const stronger = Math.max(aDmg, bDmg) || 1;
  const dominantElem = aDmg >= bDmg ? skillA?.element : skillB?.element;

  const d = FUSION_DIALS;
  const s = Math.max(0, Math.min(1, Number(stability)));
  // Base gain scales with stability: a clean fusion realises more of its potential.
  const baseGain = d.gainMin + (d.gainMax - d.gainMin) * s;
  // Diminish the *bonus* (the part above 1.0) across generations to avoid runaway.
  const genMult = Math.pow(d.genDecay, Math.max(0, (Number(generation) || 1) - 1));
  let gain = 1 + (baseGain - 1) * genMult;
  if (inbred) gain *= d.inbredPenalty;

  // Singularity: deep lineages unlock a hidden surge (One-For-All).
  const unlockedHidden = (Number(generation) || 1) >= d.singularityGen;
  if (unlockedHidden) gain += d.singularityBonus;

  const fusedElement = combineElements(skillA?.element, skillB?.element, { dominant: dominantElem });
  const maxDamage = Math.max(1, Math.round(stronger * gain));
  const rangeM = Math.round(((Number(skillA?.rangeM) || 0) + (Number(skillB?.rangeM) || 0)) / 2) || undefined;

  return {
    name: composeFusedName(skillA?.name, skillB?.name, fusedElement, seedKey),
    element: fusedElement,
    maxDamage,
    rangeM,
    gain: Math.round(gain * 1000) / 1000,
    fromElements: [norm(skillA?.element), norm(skillB?.element)],
    parents: [skillA?.name ?? null, skillB?.name ?? null],
    generation: Number(generation) || 1,
    unlockedHidden,
  };
}
