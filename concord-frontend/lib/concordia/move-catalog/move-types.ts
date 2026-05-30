// concord-frontend/lib/concordia/move-catalog/move-types.ts
//
// Universal Move System — Phase 1. The canonical schema every CREATED move maps
// to (glyph spell, fighting style, biopower, psionic, cyber ability, gun,
// movement power, fused skill), so any creation resolves to a procedural
// animation + effect. Stored in the recipe DTU `meta_json.motion`; the client
// resolver derives the *active* look from it. Backward-compatible: when a move
// has no `.motion` block (existing creations), the resolver derives one from
// `skill_kind` + `element`.
//
// Pure types + catalog tables (no three/DOM), so they're shared + unit-testable.

import type { ActionArchetype, LeadingLimb } from '../action-biomechanics';

/** What kind of motion a move is — selects the animation family. */
export type MotionFamily =
  | 'combat_melee' | 'combat_ranged' | 'firearm' | 'magic' | 'movement'
  | 'social' | 'labor' | 'creature';

/** The biomech pose family. Reuses action-biomechanics' archetypes; later phases
 *  add the firearm/flight/surface/swing/speed-trail/blink archetypes (declared
 *  here as string-literal extensions so the catalog can reference them before the
 *  pose generators ship). */
export type MotionArchetype =
  | ActionArchetype
  | 'firearm' | 'flight' | 'surface_ride' | 'web_swing' | 'speed_trail' | 'blink';

/** The structural effect category (independent of element). */
export type EffectArchetype =
  | 'projectile' | 'beam' | 'nova' | 'ground_zone' | 'self_aura' | 'ally_heal'
  | 'debuff' | 'summon' | 'transform' | 'melee_imbue' | 'dash_blink' | 'shield'
  | 'trap' | 'chain' | 'terrain_alter' | 'homing';

/** The world-appropriate power source a move drains (Pillar 2 — lore-resource). */
export type ResourceGauge = 'mana' | 'bio' | 'charge' | 'stamina' | 'none';

/** The 7 authored skill kinds (server `skill-evolution.js` SKILL_KIND_LIMB_REQ). */
export type SkillKind =
  | 'fighting_style' | 'spell' | 'biopower' | 'cyber_ability'
  | 'psionic' | 'tech_gadget' | 'mundane';

export type TargetShape = 'self' | 'single' | 'cone' | 'line' | 'area';

/**
 * The motion block stored on a created move (`meta_json.motion`). Every field is
 * optional so the resolver can fill gaps from skill_kind + element (backward-
 * compat for moves minted before this system).
 */
export interface MoveDescriptor {
  motionFamily?: MotionFamily;
  motionArchetype?: MotionArchetype;
  effectArchetype?: EffectArchetype;
  element?: string;
  powerCategory?: string;
  resourceGauge?: ResourceGauge;
  leadingLimb?: LeadingLimb;
  targetShape?: TargetShape;
  /** [windupMs, actionMs, followMs] */
  phases?: [number, number, number];
}

/** The fully-resolved move the client animates + the VFX/SFX it fires. */
export interface ResolvedMove {
  motionFamily: MotionFamily;
  motionArchetype: MotionArchetype;
  effectArchetype: EffectArchetype;
  element: string;
  resourceGauge: ResourceGauge;
  leadingLimb: LeadingLimb;
  targetShape: TargetShape;
  /** 1..5 visual tier (Pillar 1 — gated by skill level, not the description). */
  tier: number;
  phases: [number, number, number];
  vfx?: string;
  sfxId?: string;
}

// ── skill_kind → default motion (mirrors server SKILL_KIND_LIMB_REQ + adds the
// animation archetype + effect + the lore-resource gauge each kind drains). ──
export interface SkillKindMotion {
  family: MotionFamily;
  archetype: MotionArchetype;
  effect: EffectArchetype;
  limb: LeadingLimb;
  gauge: ResourceGauge;
}

export const SKILL_KIND_MOTION: Record<SkillKind, SkillKindMotion> = {
  fighting_style: { family: 'combat_melee', archetype: 'swing_down', effect: 'melee_imbue', limb: 'both_arms', gauge: 'stamina' },
  spell:          { family: 'magic',        archetype: 'cast_channel', effect: 'projectile', limb: 'both_arms', gauge: 'mana' },
  biopower:       { family: 'magic',        archetype: 'cast_channel', effect: 'self_aura',  limb: 'spine',     gauge: 'bio' },
  cyber_ability:  { family: 'combat_ranged',archetype: 'lean_reach',   effect: 'beam',       limb: 'right_arm', gauge: 'charge' },
  psionic:        { family: 'magic',        archetype: 'cast_channel', effect: 'debuff',     limb: 'head',      gauge: 'mana' },
  tech_gadget:    { family: 'combat_ranged',archetype: 'lean_reach',   effect: 'projectile', limb: 'right_arm', gauge: 'charge' },
  mundane:        { family: 'labor',        archetype: 'thrust',       effect: 'melee_imbue',limb: 'right_arm', gauge: 'stamina' },
};

/** Element → the effect archetype it most naturally expresses (a *default* — the
 *  builder can override). Anchored to Concord's 9 canonical elements + families. */
export const ELEMENT_EFFECT_BIAS: Record<string, EffectArchetype> = {
  fire: 'projectile', ice: 'ground_zone', frost: 'ground_zone', water: 'ground_zone',
  lightning: 'chain', energy: 'beam', bio: 'debuff', poison: 'debuff',
  psychic: 'debuff', physical: 'melee_imbue', refusal: 'shield',
  earth: 'terrain_alter', air: 'nova', wind: 'nova', nature: 'ground_zone',
  light: 'beam', shadow: 'debuff', void: 'nova', arcane: 'projectile',
};

export const DEFAULT_PHASES: [number, number, number] = [200, 160, 220];

/** Clamp a value to the engine's 1..5 visual tier range. */
export function clampTier(t: number): number {
  return Math.max(1, Math.min(5, Math.floor(Number.isFinite(t) ? t : 3)));
}
