// concord-frontend/lib/concordia/move-resolver.ts
//
// Universal Move System — Phase 1 keystone. THE resolver: given any created
// move (its stored `motion` descriptor + its skill_kind/element/level), produce
// a fully-resolved `ResolvedMove` the client animates + the VFX/SFX it fires.
//
// This closes the audit's core gap: before this, a minted spell stored
// element+damage+glyph but no animation archetype, so every custom move played a
// generic `cast`. Now `resolveMove` picks the archetype + effect + element VFX +
// the level-gated visual tier (Pillar 1) for ANY creation — and NEVER returns
// null (always a sensible default). Pure + unit-testable.

import {
  type MoveDescriptor, type ResolvedMove, type SkillKind, type EffectArchetype,
  type MotionFamily, SKILL_KIND_MOTION, ELEMENT_EFFECT_BIAS, DEFAULT_PHASES, clampTier,
} from './move-catalog/move-types';
import { modulatedVfx, modulatedSfx, effectiveTier } from './skill-motion';

export interface ResolveMoveInput {
  /** The stored motion block (`meta_json.motion`), if the move was minted with one. */
  motion?: MoveDescriptor | null;
  /** Authored kind — used to derive defaults when `motion` is partial/absent. */
  skillKind?: string | null;
  /** Element (fire/ice/lightning/…) — drives VFX/SFX + effect bias. */
  element?: string | null;
  /** The move's CURRENT skill level (Pillar 1: gates the active visual tier). */
  skillLevel?: number | null;
  /** Explicit base tier override (else derived from skillLevel). */
  tier?: number | null;
}

/** Skill level → 1..5 visual tier (mirrors server skill-evolution: revisions every
 *  10 levels; tier saturates at 5 while power keeps scaling). A L1 move is tier 1
 *  no matter how grand its description; a L150+ move is tier 5. */
export function tierForLevel(level: number | null | undefined): number {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  const revision = Math.floor((lv - 1) / 10); // a revision every 10 levels
  if (revision >= 150) return 5;
  if (revision >= 50) return 4;
  if (revision >= 15) return 3;
  if (revision >= 5) return 2;
  return 1;
}

function isSkillKind(k: string | null | undefined): k is SkillKind {
  return !!k && k in SKILL_KIND_MOTION;
}

/**
 * Resolve any created move to its animation + effect. Precedence: an explicit
 * field on `motion` wins; else derive from skill_kind; else a safe generic.
 */
export function resolveMove(input: ResolveMoveInput): ResolvedMove {
  const m = input.motion ?? {};
  const kind = isSkillKind(input.skillKind) ? input.skillKind : null;
  const base = kind ? SKILL_KIND_MOTION[kind] : null;
  const element = (m.element ?? input.element ?? 'physical').toLowerCase();

  const motionFamily: MotionFamily = m.motionFamily ?? base?.family ?? 'magic';
  const motionArchetype = m.motionArchetype ?? base?.archetype ?? 'cast_channel';
  const leadingLimb = m.leadingLimb ?? base?.limb ?? 'both_arms';
  const resourceGauge = m.resourceGauge ?? base?.gauge ?? 'none';
  const targetShape = m.targetShape ?? 'single';

  // Effect archetype: authored > element bias > skill_kind default > projectile.
  const effectArchetype: EffectArchetype =
    m.effectArchetype ?? ELEMENT_EFFECT_BIAS[element] ?? base?.effect ?? 'projectile';

  // Visual tier (Pillar 1): explicit > derived-from-level. Element nudges it
  // (fire bigger, ice sharper) via the existing skill-motion bias.
  const baseTier = input.tier != null ? clampTier(input.tier) : tierForLevel(input.skillLevel);
  const tier = effectiveTier(baseTier, element);

  // Element VFX/SFX (reuse the shipped skill-motion element table; default by family).
  const fallbackVfx = motionFamily === 'combat_melee' ? 'impact' : 'arcane';
  const vfx = modulatedVfx(fallbackVfx, element);
  const sfxId = modulatedSfx(undefined, element);

  return {
    motionFamily,
    motionArchetype,
    effectArchetype,
    element,
    resourceGauge,
    leadingLimb,
    targetShape,
    tier,
    phases: m.phases ?? DEFAULT_PHASES,
    vfx,
    sfxId,
  };
}
