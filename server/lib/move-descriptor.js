// server/lib/move-descriptor.js
//
// Universal Move System — server twin of the client move-resolver. Given a
// created move's skill_kind + element, derive the `motion` descriptor block that
// gets stamped into the recipe DTU's meta_json at mint / evolve / fuse time. The
// client `resolveMove` (concord-frontend/lib/concordia/move-resolver.ts) prefers
// an explicit stamped block and only DERIVES when it's absent — so stamping here
// makes the server the source of truth and guarantees a created move animates per
// its element + archetype instead of a generic `cast`.
//
// The tables below MIRROR concord-frontend/lib/concordia/move-catalog/move-types.ts
// (SKILL_KIND_MOTION + ELEMENT_EFFECT_BIAS + DEFAULT_PHASES). Keep them in sync —
// the move-render coverage gate (scripts/verify-move-render-coverage.mjs) parses
// the client tables; this is the server side of the same contract.

// skill_kind → default motion (family, biomech archetype, effect, leading limb, gauge)
export const SKILL_KIND_MOTION = {
  fighting_style: { family: "combat_melee",  archetype: "swing_down",   effect: "melee_imbue", limb: "both_arms", gauge: "stamina" },
  spell:          { family: "magic",         archetype: "cast_channel", effect: "projectile",  limb: "both_arms", gauge: "mana" },
  biopower:       { family: "magic",         archetype: "cast_channel", effect: "self_aura",   limb: "spine",     gauge: "bio" },
  cyber_ability:  { family: "combat_ranged", archetype: "lean_reach",   effect: "beam",        limb: "right_arm", gauge: "charge" },
  psionic:        { family: "magic",         archetype: "cast_channel", effect: "debuff",      limb: "head",      gauge: "mana" },
  tech_gadget:    { family: "combat_ranged", archetype: "lean_reach",   effect: "projectile",  limb: "right_arm", gauge: "charge" },
  mundane:        { family: "labor",         archetype: "thrust",       effect: "melee_imbue", limb: "right_arm", gauge: "stamina" },
};

// element → the effect archetype it most naturally expresses (a default).
export const ELEMENT_EFFECT_BIAS = {
  fire: "projectile", ice: "ground_zone", frost: "ground_zone", water: "ground_zone",
  lightning: "chain", energy: "beam", bio: "debuff", poison: "debuff",
  psychic: "debuff", physical: "melee_imbue", refusal: "shield",
  earth: "terrain_alter", air: "nova", wind: "nova", nature: "ground_zone",
  light: "beam", shadow: "debuff", void: "nova", arcane: "projectile",
};

export const DEFAULT_PHASES = [200, 160, 220];

/**
 * Derive the `motion` descriptor block for a created move. Never throws; always
 * returns a complete block (mirrors the client resolver's never-null contract).
 *
 * @param {string} skillKind  one of SKILL_KIND_MOTION (default: 'spell')
 * @param {string} element    fire/ice/lightning/… (default: 'physical')
 * @param {object} [opts]     { effectArchetype?, targetShape?, motionArchetype? } explicit overrides
 * @returns {{motionFamily,motionArchetype,effectArchetype,element,resourceGauge,leadingLimb,targetShape,phases}}
 */
export function deriveMotion(skillKind, element, opts = {}) {
  const kind = SKILL_KIND_MOTION[skillKind] ? skillKind : "spell";
  const base = SKILL_KIND_MOTION[kind];
  const el = String(element || "physical").toLowerCase();
  const effectArchetype = opts.effectArchetype || ELEMENT_EFFECT_BIAS[el] || base.effect || "projectile";
  return {
    motionFamily: base.family,
    motionArchetype: opts.motionArchetype || base.archetype,
    effectArchetype,
    element: el,
    resourceGauge: base.gauge,
    leadingLimb: base.limb,
    targetShape: opts.targetShape || "single",
    phases: DEFAULT_PHASES.slice(),
  };
}

/**
 * Stamp the universal-move fields onto a recipe meta object in place: the
 * derived `motion` block (unless already present) + `nativeWorld` (Pillar 3 —
 * the world the move was created in, so cross-world potency can sag it abroad).
 * Returns the same meta for chaining. Kill-switch: CONCORD_MOVE_RESOLVER=0.
 */
export function stampMoveMeta(meta, { skillKind, element, worldId } = {}) {
  if (process.env.CONCORD_MOVE_RESOLVER === "0") return meta;
  if (!meta || typeof meta !== "object") return meta;
  if (!meta.motion) {
    meta.motion = deriveMotion(skillKind ?? meta.skill_kind, element ?? meta.element);
  }
  if (meta.nativeWorld == null && worldId != null) meta.nativeWorld = worldId;
  return meta;
}
