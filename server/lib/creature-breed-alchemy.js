// server/lib/creature-breed-alchemy.js
//
// Wave 6 / Layer 2 — the adaptation layer: environment-conditioned dominance +
// emergent reaction. When two elementally-affined creatures breed, the birth
// environment decides which affinity is DOMINANT and which is recessive-but-
// present, and conflicting affinities RESOLVE into a named third thing rather
// than blending:
//
//   water-bred × fire-bred, born hot   → fire dominant, water recessive → STEAM
//   steam-bred (water+heat) × water, wet → BRINE
//
// This is the same combinatorial pattern Concordia already runs twice —
// embodied/signal-propagation.js#evaluateCombos (steam at hot+humid) and
// craft-resolve.js (dominant-affinity cascade + stability/conflict penalty) —
// pointed at genetics. Pure + deterministic + total; never throws.

export const AFFINITIES = Object.freeze([
  "water", "fire", "ice", "lightning", "earth", "wind", "bio", "energy",
  "steam", "brine", "magma", "storm", "physical", "none",
]);

// Conflicting affinity pairs — when both are present they don't blend, they react.
// Conflict lowers stability (craft-resolve CONFLICT_PENALTY analogue).
const CONFLICTS = [
  ["water", "fire"], ["ice", "fire"], ["lightning", "earth"], ["wind", "earth"], ["bio", "energy"],
];
const CONFLICT_PENALTY = Number(process.env.CONCORD_BREED_CONFLICT_PENALTY) || 0.22;

// The reaction table — (a + b under an env condition) → a named variant.
// envCheck receives { temp, humidity } (Layer-7 signal shape; both optional).
const VARIANT_RULES = [
  { a: "water", b: "fire",      when: (e) => hot(e),            variant: "steam" },
  { a: "steam", b: "water",     when: (e) => wet(e),            variant: "brine" },
  { a: "steam", b: "fire",      when: (e) => hot(e),            variant: "magma" },
  { a: "fire",  b: "earth",     when: (e) => !wet(e),           variant: "magma" },
  { a: "water", b: "lightning", when: () => true,               variant: "storm" },
  { a: "wind",  b: "lightning", when: () => true,               variant: "storm" },
  { a: "ice",   b: "water",     when: (e) => cold(e),           variant: "brine" },
  { a: "bio",   b: "water",     when: (e) => wet(e),            variant: "bio" },
];

function hot(e)  { return Number(e?.temp ?? 18) >= 28; }
function cold(e) { return Number(e?.temp ?? 18) <= 6; }
function wet(e)  { return Number(e?.humidity ?? 50) >= 65; }

function norm(a) {
  const s = String(a || "none").toLowerCase();
  return AFFINITIES.includes(s) ? s : "none";
}
function isConflict(a, b) {
  return CONFLICTS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

/**
 * Which affinity does the birth environment favour? Heat favours fire/magma/steam;
 * cold favours ice/water/brine; wet favours water/bio; dry favours fire/earth.
 * Returns the affinity (of the two) the environment amplifies, else `a`.
 */
function envDominant(a, b, env) {
  const score = (aff) => {
    let s = 0;
    if (hot(env)  && ["fire", "magma", "steam", "lightning", "storm"].includes(aff)) s += 2;
    if (cold(env) && ["ice", "water", "brine"].includes(aff)) s += 2;
    if (wet(env)  && ["water", "bio", "brine", "steam"].includes(aff)) s += 1;
    if (!wet(env) && ["fire", "earth", "magma"].includes(aff)) s += 1;
    return s;
  };
  const sa = score(a), sb = score(b);
  if (sb > sa) return b;
  return a;
}

/**
 * Resolve a hybrid's elemental outcome from its parents' affinities + the birth
 * environment. PURE.
 * @param {object} args { affinityA, affinityB, env:{temp,humidity} }
 * @returns {{ dominant, recessive, variant, stability, reacted }}
 *   dominant  — expressed affinity (environment-chosen)
 *   recessive — latent affinity carried in genotype (re-expressible elsewhere)
 *   variant   — the named third thing (steam/brine/…) or null if no reaction
 *   stability — 0..1 (lowered by conflicting affinities, BotW-cancel analogue)
 *   reacted   — true when a named variant was produced
 */
export function resolveVariant({ affinityA, affinityB, env = {} } = {}) {
  const a = norm(affinityA);
  const b = norm(affinityB);
  if (a === "none" && b === "none") {
    return { dominant: "none", recessive: "none", variant: null, stability: 1, reacted: false };
  }
  if (a === b) {
    return { dominant: a, recessive: a, variant: null, stability: 1, reacted: false };
  }

  const dominant = envDominant(a, b, env);
  const recessive = dominant === a ? b : a;

  // Reaction lookup (order-independent).
  let variant = null;
  for (const rule of VARIANT_RULES) {
    const match = (rule.a === a && rule.b === b) || (rule.a === b && rule.b === a);
    if (match && rule.when(env)) { variant = rule.variant; break; }
  }

  let stability = 1;
  if (isConflict(a, b)) stability -= CONFLICT_PENALTY;
  // A clean reaction restores some stability (the conflict resolved into a thing).
  if (variant) stability = Math.min(1, stability + 0.1);
  stability = Math.max(0.05, stability);

  return {
    dominant: variant || dominant, // a reacted hybrid expresses the variant
    recessive,
    variant,
    stability,
    reacted: !!variant,
  };
}

/**
 * Phenotype plasticity — the SAME genotype expresses differently by current
 * environment (slicker in water, scaled-up/dry in heat) within genotype bounds.
 * Pure: returns a shader-uniform-ish descriptor the renderer folds in (same
 * mechanism as the avatar wear/dye uniforms, env input instead of player).
 * @returns {{ wetness, scaling, glow }} each 0..1
 */
export function phenotypeForEnv(genotype = {}, env = {}) {
  const aff = norm(genotype.dominant || genotype.affinity);
  const wetAff = ["water", "brine", "bio", "steam"].includes(aff);
  const hotAff = ["fire", "magma", "steam", "lightning", "storm"].includes(aff);
  const wetness = clamp01((wet(env) ? 0.6 : 0.2) + (wetAff ? 0.3 : 0));
  const scaling = clamp01((hot(env) ? 0.6 : 0.25) + (hotAff ? 0.3 : 0));
  const glow = clamp01(["energy", "lightning", "storm", "magma"].includes(aff) ? 0.5 + (hot(env) ? 0.3 : 0) : 0.1);
  return { wetness, scaling, glow };
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
