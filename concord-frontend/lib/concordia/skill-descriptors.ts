// concord-frontend/lib/concordia/skill-descriptors.ts
//
// T3.1 — per-skill combat descriptors.
//
// VFX/feel was tier(5)×element(7)×style(5) — 0 per-skill identity, so a sword
// and a spear at the same tier looked the same. This is a data-driven overlay
// keyed by the server SKILL_CATALOG (skill-tree-engine.js) so all ~67 skills
// differentiate without 67 bespoke animation files. Differentiation is by
// composition: each skill picks a baseAction + element + fighting style + a
// palette/accent/lever/mass bias + mastery milestones.
//
// ALL_SKILL_KEYS mirrors the server SKILL_CATALOG exactly (a contract test
// asserts every catalog key resolves a descriptor — see skill-descriptors test).

import type { CombatAction, BodyType } from './combat-biomechanics';
import type { FightingStyleId } from './style-sets';

export type DescriptorElement =
  | 'fire' | 'water' | 'ice' | 'lightning' | 'poison' | 'energy' | 'physical' | 'none';

export type MasteryUnlock =
  | 'riposte' | 'feint' | 'finisher' | 'chain_extend' | 'guard_break';

export interface MasteryMilestone {
  atLevel: number;
  unlocks: MasteryUnlock;
  /** Optional biomech accent the milestone adds to the generated motion. */
  biomechHook?: {
    addPhaseAccent?: 'recoil_tail' | 'offhand_counter' | 'double_tap';
    anticipationDeltaMs?: number;
    followThroughDeltaMs?: number;
  };
}

export interface SkillDescriptor {
  /** The procedural base motion this skill drives. */
  baseAction: CombatAction;
  element: DescriptorElement;
  /** Which of the 5 fighting styles colours the stance + accents. */
  styleHint: FightingStyleId;
  vfx: {
    paletteOverride?: number;  // hex; tints the element burst
    trailColor?: number;       // hex; weapon/limb trail
    accentParticle?: 'sparks' | 'embers' | 'shards' | 'arcs' | 'miasma' | 'plasma' | 'dust';
  };
  /** Per-skill biases layered onto impactKinematics + the pose generators. */
  animationAccents: {
    windupBias: number;   // -1..+1 — negative = snappier, positive = telegraphed
    followBias: number;   // -1..+1 — follow-through length bias
    leverArmM?: number;   // overrides the kinematics lever (reach weapons longer)
    boneMassMul?: number; // scales the striking-segment mass (heavy weapons hit harder)
  };
  mastery: { milestones: MasteryMilestone[] };
}

// The full server SKILL_CATALOG, mirrored. Keep in sync with
// server/lib/skill-tree-engine.js SKILL_CATALOG.
export const ALL_SKILL_KEYS: string[] = [
  // combat
  'swords', 'archery', 'fists', 'spears', 'staves', 'ranged_pistol',
  'ranged_rifle', 'elemental_fire', 'elemental_water', 'elemental_ice',
  'elemental_lightning', 'elemental_poison', 'elemental_energy',
  // athletic
  'athletics', 'reflex', 'stealth', 'swimming', 'climbing', 'agility',
  'endurance', 'vitality', 'strength', 'focus',
  // craft
  'blacksmithing', 'carpentry', 'tailoring', 'cooking', 'alchemy',
  'engineering', 'leatherworking', 'jewelry', 'brewing',
  // arts
  'painting', 'drawing', 'music_performance', 'music_composition',
  'dance', 'acting', 'writing', 'photography',
  // social
  'rhetoric', 'negotiation', 'diplomacy', 'deception', 'leadership',
  'intimidation', 'empathy', 'charisma', 'public_speaking', 'ethics',
  // scholar
  'academics', 'history', 'mathematics', 'natural_philosophy',
  'linguistics', 'programming', 'engineering_theory', 'occult_studies',
  // side
  'fishing', 'karaoke', 'mahjong', 'gardening', 'carpentry_decor',
  'appraising', 'lockpicking', 'racing', 'vehicle_tuning',
];

// Standard mastery ladder: a martial skill unlocks affordances at 4 levels.
function martialMastery(): MasteryMilestone[] {
  return [
    { atLevel: 15, unlocks: 'feint',        biomechHook: { addPhaseAccent: 'double_tap', anticipationDeltaMs: 30 } },
    { atLevel: 30, unlocks: 'riposte',      biomechHook: { addPhaseAccent: 'offhand_counter' } },
    { atLevel: 55, unlocks: 'guard_break',  biomechHook: { followThroughDeltaMs: 40 } },
    { atLevel: 80, unlocks: 'finisher',     biomechHook: { addPhaseAccent: 'recoil_tail' } },
    { atLevel: 95, unlocks: 'chain_extend', biomechHook: { followThroughDeltaMs: 60 } },
  ];
}

// Explicit combat descriptors — real per-skill identity.
const COMBAT_DESCRIPTORS: Record<string, SkillDescriptor> = {
  swords: {
    baseAction: 'attack-heavy', element: 'physical', styleHint: 'classical_swordwork',
    vfx: { trailColor: 0xdfe8ff, accentParticle: 'sparks' },
    animationAccents: { windupBias: 0.25, followBias: 0.4, leverArmM: 0.95, boneMassMul: 1.4 },
    mastery: { milestones: martialMastery() },
  },
  spears: {
    baseAction: 'attack-heavy', element: 'physical', styleHint: 'classical_swordwork',
    vfx: { trailColor: 0xcfd6e0, accentParticle: 'dust' },
    animationAccents: { windupBias: 0.35, followBias: 0.2, leverArmM: 1.25, boneMassMul: 1.2 },
    mastery: { milestones: martialMastery() },
  },
  staves: {
    baseAction: 'attack-heavy', element: 'energy', styleHint: 'wing_chun',
    vfx: { trailColor: 0x9be9ff, accentParticle: 'arcs' },
    animationAccents: { windupBias: 0.1, followBias: 0.5, leverArmM: 1.1, boneMassMul: 1.1 },
    mastery: { milestones: martialMastery() },
  },
  fists: {
    baseAction: 'attack-light', element: 'physical', styleHint: 'muay_thai',
    vfx: { accentParticle: 'dust' },
    animationAccents: { windupBias: -0.4, followBias: -0.1, boneMassMul: 1.0 },
    mastery: { milestones: martialMastery() },
  },
  archery: {
    baseAction: 'attack-light', element: 'physical', styleHint: 'classical_swordwork',
    vfx: { trailColor: 0xeae0c0, accentParticle: 'sparks' },
    animationAccents: { windupBias: 0.6, followBias: -0.3, leverArmM: 0.6 },
    mastery: { milestones: martialMastery() },
  },
  ranged_pistol: {
    baseAction: 'attack-light', element: 'physical', styleHint: 'wing_chun',
    vfx: { trailColor: 0xffd24a, accentParticle: 'sparks' },
    animationAccents: { windupBias: -0.5, followBias: -0.4, leverArmM: 0.4 },
    mastery: { milestones: martialMastery() },
  },
  ranged_rifle: {
    baseAction: 'attack-heavy', element: 'physical', styleHint: 'classical_swordwork',
    vfx: { trailColor: 0xffe0a0, accentParticle: 'sparks' },
    animationAccents: { windupBias: 0.2, followBias: -0.5, leverArmM: 0.7 },
    mastery: { milestones: martialMastery() },
  },
  elemental_fire: {
    baseAction: 'attack-heavy', element: 'fire', styleHint: 'capoeira',
    vfx: { paletteOverride: 0xff6a2b, accentParticle: 'embers' },
    animationAccents: { windupBias: 0.3, followBias: 0.5, boneMassMul: 0.8 },
    mastery: { milestones: martialMastery() },
  },
  elemental_water: {
    baseAction: 'attack-light', element: 'water', styleHint: 'wing_chun',
    vfx: { paletteOverride: 0x5ad6ff, accentParticle: 'shards' },
    animationAccents: { windupBias: 0.0, followBias: 0.6, boneMassMul: 0.85 },
    mastery: { milestones: martialMastery() },
  },
  elemental_ice: {
    baseAction: 'attack-heavy', element: 'ice', styleHint: 'classical_swordwork',
    vfx: { paletteOverride: 0x7fd4ff, accentParticle: 'shards' },
    animationAccents: { windupBias: 0.4, followBias: 0.1, boneMassMul: 0.9 },
    mastery: { milestones: martialMastery() },
  },
  elemental_lightning: {
    baseAction: 'attack-light', element: 'lightning', styleHint: 'capoeira',
    vfx: { paletteOverride: 0x9b8cff, accentParticle: 'arcs' },
    animationAccents: { windupBias: -0.6, followBias: 0.2, boneMassMul: 0.7 },
    mastery: { milestones: martialMastery() },
  },
  elemental_poison: {
    baseAction: 'attack-light', element: 'poison', styleHint: 'wing_chun',
    vfx: { paletteOverride: 0x7bd16a, accentParticle: 'miasma' },
    animationAccents: { windupBias: -0.2, followBias: 0.3, boneMassMul: 0.8 },
    mastery: { milestones: martialMastery() },
  },
  elemental_energy: {
    baseAction: 'attack-heavy', element: 'energy', styleHint: 'karate',
    vfx: { paletteOverride: 0x5ad6ff, accentParticle: 'plasma' },
    animationAccents: { windupBias: 0.2, followBias: 0.4, boneMassMul: 0.9 },
    mastery: { milestones: martialMastery() },
  },
  // Athletic skills that read in combat as unarmed/grapple/mobility.
  strength: {
    baseAction: 'grapple', element: 'physical', styleHint: 'muay_thai',
    vfx: { accentParticle: 'dust' },
    animationAccents: { windupBias: 0.3, followBias: 0.2, boneMassMul: 1.3 },
    mastery: { milestones: martialMastery() },
  },
  agility: {
    baseAction: 'kick', element: 'physical', styleHint: 'capoeira',
    vfx: { accentParticle: 'dust' },
    animationAccents: { windupBias: -0.3, followBias: 0.3 },
    mastery: { milestones: martialMastery() },
  },
};

// A neutral default for non-combat skills (they can still throw a small physical
// burst when used in a brawl context) so every catalog key resolves.
const DEFAULT_DESCRIPTOR: SkillDescriptor = {
  baseAction: 'attack-light',
  element: 'none',
  styleHint: 'karate',
  vfx: { accentParticle: 'dust' },
  animationAccents: { windupBias: 0, followBias: 0 },
  mastery: { milestones: [] },
};

/** Resolve a descriptor for any SKILL_CATALOG key (default for non-combat). */
export function descriptorFor(skillKey: string | null | undefined): SkillDescriptor {
  if (!skillKey) return DEFAULT_DESCRIPTOR;
  return COMBAT_DESCRIPTORS[skillKey] || DEFAULT_DESCRIPTOR;
}

/** True if a skill has an explicit combat identity (not the default). */
export function isCombatSkill(skillKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMBAT_DESCRIPTORS, skillKey);
}

/** Which mastery milestones a skill has unlocked at a given level. */
export function unlockedMilestones(skillKey: string, level: number): MasteryUnlock[] {
  return descriptorFor(skillKey).mastery.milestones
    .filter((m) => level >= m.atLevel)
    .map((m) => m.unlocks);
}

export type { CombatAction, BodyType };
