// concord-frontend/lib/concordia/action-biomechanics.ts
//
// Living Society — general procedural ACTION animation (the non-combat sibling
// of combat-biomechanics.ts). Every player/NPC verb (chop/forage/forge/fish/
// dig/cast/greet…) becomes an embodied avatar motion built from a few authored
// key poses across a wind-up → action → follow-through structure (the David
// Rosen/Overgrowth approach + the 12 principles: anticipation, weight via
// slow-in/out, follow-through, secondary motion).
//
// Design: a VERB resolves to an ActionDescriptor (archetype + leading limb +
// phase timings + juice/sfx/vfx ids + optional baked clipId). An ARCHETYPE
// generates the pose sequence. So "adding a verb = a row" and nothing is ever
// silent (category fallback). The pose/bone shape matches AvatarSystem3D's
// procedural skeleton so clips play through the same mixer the combat path uses.
//
// This module is deliberately self-contained (no import from combat-biomechanics)
// so the load-bearing combat path is untouched; the BONES list is the shared
// skeleton contract.

import * as THREE from 'three';

// Canonical bone names — MUST match AvatarSystem3D's procedural skeleton (same
// list combat-biomechanics.ts uses).
const B = {
  hips: 'hips', spine: 'spine', chest: 'chest', neck: 'neck', head: 'head',
  lArm: 'leftArm', lFore: 'leftForeArm', lHand: 'leftHand',
  rArm: 'rightArm', rFore: 'rightForeArm', rHand: 'rightHand',
  lUpLeg: 'leftUpLeg', lLeg: 'leftLeg', lFoot: 'leftFoot',
  rUpLeg: 'rightUpLeg', rLeg: 'rightLeg', rFoot: 'rightFoot',
} as const;

export type ActionArchetype =
  | 'swing_down' | 'thrust' | 'crouch_reach_pluck' | 'cast_channel'
  | 'manipulate_in_place' | 'cast_and_wait' | 'lean_reach'
  | 'social_gesture' | 'mount' | 'locomotion_modal';

export type LeadingLimb = 'right_arm' | 'left_arm' | 'both_arms' | 'spine' | 'legs' | 'head';

export interface ActionDescriptor {
  archetype: ActionArchetype;
  leadingLimb: LeadingLimb;
  /** [windupMs, actionMs, followMs] */
  phases: [number, number, number];
  /** loop id for sustained actions (fishing line tension, forge hammer) */
  loop?: string;
  /** if set, play this baked NPC-occupation clip instead of the procedural archetype */
  clipId?: string;
  juiceId?: string;
  sfxId?: string;
  /** particle-effect type spawned at the action point (concordia:particle-effect) */
  vfx?: string;
}

interface ActionPose {
  t: number; // 0..1 normalized
  bones: Record<string, { rot?: [number, number, number]; pos?: [number, number, number] }>;
  phase?: 'rest' | 'windup' | 'action' | 'follow' | 'settle';
}

// ── Archetype pose generators ────────────────────────────────────────────────
// Each returns a rest → wind-up → action → follow-through → settle sequence with
// a clear leading limb. Rotations are eulers in radians. amp scales by tier.

function ampFor(tier: number): number {
  const t = Math.max(1, Math.min(5, Math.floor(tier || 3)));
  return [0.6, 0.75, 0.9, 1.0, 1.12][t - 1];
}

function rest(): ActionPose { return { t: 0, bones: {}, phase: 'rest' }; }

/** swing_down: chop/mine/hammer/scythe/till — arms+spine raise then arc down. */
function poses_swing_down(a: number): ActionPose[] {
  return [
    rest(),
    { t: 0.30, phase: 'windup', bones: { [B.rArm]: { rot: [-2.4 * a, 0, 0] }, [B.lArm]: { rot: [-2.1 * a, 0, 0] }, [B.spine]: { rot: [-0.25 * a, 0, 0] }, [B.chest]: { rot: [-0.2 * a, 0, 0] } } },
    { t: 0.52, phase: 'action', bones: { [B.rArm]: { rot: [0.9 * a, 0, 0] }, [B.lArm]: { rot: [0.8 * a, 0, 0] }, [B.spine]: { rot: [0.45 * a, 0, 0] }, [B.chest]: { rot: [0.3 * a, 0, 0] }, [B.hips]: { pos: [0, -0.04 * a, 0.02 * a] } } },
    { t: 0.72, phase: 'follow', bones: { [B.rArm]: { rot: [0.5 * a, 0, 0] }, [B.spine]: { rot: [0.18 * a, 0, 0] } } },
    { t: 1, phase: 'settle', bones: {} },
  ];
}

/** thrust: dig/spear/jab — dominant arm cocks back then drives forward. */
function poses_thrust(a: number): ActionPose[] {
  return [
    rest(),
    { t: 0.28, phase: 'windup', bones: { [B.rArm]: { rot: [-0.9 * a, 0, -0.3 * a] }, [B.rFore]: { rot: [-1.2 * a, 0, 0] }, [B.spine]: { rot: [0, -0.25 * a, 0] } } },
    { t: 0.5, phase: 'action', bones: { [B.rArm]: { rot: [0.4 * a, 0, 0] }, [B.rFore]: { rot: [-0.1 * a, 0, 0] }, [B.spine]: { rot: [0, 0.2 * a, 0] }, [B.hips]: { pos: [0, -0.03 * a, 0.04 * a] } } },
    { t: 0.74, phase: 'follow', bones: { [B.rArm]: { rot: [0.1 * a, 0, 0] }, [B.spine]: { rot: [0, 0.05 * a, 0] } } },
    { t: 1, phase: 'settle', bones: {} },
  ];
}

/** crouch_reach_pluck: gather/forage/harvest/plant/pet — squat, fold, reach low. */
function poses_crouch_reach_pluck(a: number): ActionPose[] {
  return [
    rest(),
    { t: 0.35, phase: 'windup', bones: { [B.hips]: { pos: [0, -0.18 * a, 0] }, [B.spine]: { rot: [0.55 * a, 0, 0] }, [B.lUpLeg]: { rot: [-0.5 * a, 0, 0] }, [B.rUpLeg]: { rot: [-0.5 * a, 0, 0] }, [B.lLeg]: { rot: [0.8 * a, 0, 0] }, [B.rLeg]: { rot: [0.8 * a, 0, 0] } } },
    { t: 0.55, phase: 'action', bones: { [B.hips]: { pos: [0, -0.2 * a, 0] }, [B.spine]: { rot: [0.62 * a, 0, 0] }, [B.rArm]: { rot: [0.9 * a, 0, 0] }, [B.rFore]: { rot: [-0.3 * a, 0, 0] }, [B.lLeg]: { rot: [0.85 * a, 0, 0] }, [B.rLeg]: { rot: [0.85 * a, 0, 0] } } },
    { t: 0.8, phase: 'follow', bones: { [B.hips]: { pos: [0, -0.06 * a, 0] }, [B.spine]: { rot: [0.2 * a, 0, 0] } } },
    { t: 1, phase: 'settle', bones: {} },
  ];
}

/** cast_channel: spell/glyph/commune/sign — arms sweep up/out, hold, release. */
function poses_cast_channel(a: number): ActionPose[] {
  return [
    rest(),
    { t: 0.3, phase: 'windup', bones: { [B.rArm]: { rot: [-1.6 * a, 0, -0.5 * a] }, [B.lArm]: { rot: [-1.6 * a, 0, 0.5 * a] }, [B.head]: { rot: [-0.2 * a, 0, 0] }, [B.spine]: { rot: [-0.15 * a, 0, 0] } } },
    { t: 0.6, phase: 'action', bones: { [B.rArm]: { rot: [-1.2 * a, 0, -0.8 * a] }, [B.lArm]: { rot: [-1.2 * a, 0, 0.8 * a] }, [B.chest]: { rot: [-0.1 * a, 0, 0] } } },
    { t: 0.85, phase: 'follow', bones: { [B.rArm]: { rot: [-0.6 * a, 0, -0.3 * a] }, [B.lArm]: { rot: [-0.6 * a, 0, 0.3 * a] } } },
    { t: 1, phase: 'settle', bones: {} },
  ];
}

/** manipulate_in_place: cook/craft/forge/mill/trade/repair — lean + hand loop. */
function poses_manipulate_in_place(a: number): ActionPose[] {
  return [
    rest(),
    { t: 0.25, phase: 'windup', bones: { [B.spine]: { rot: [0.22 * a, 0, 0] }, [B.rArm]: { rot: [0.5 * a, 0, 0] }, [B.lArm]: { rot: [0.4 * a, 0, 0] } } },
    { t: 0.5, phase: 'action', bones: { [B.spine]: { rot: [0.28 * a, 0, 0] }, [B.rArm]: { rot: [0.7 * a, 0, 0] }, [B.rFore]: { rot: [-0.4 * a, 0, 0] } } },
    { t: 0.75, phase: 'action', bones: { [B.spine]: { rot: [0.24 * a, 0, 0] }, [B.rArm]: { rot: [0.45 * a, 0, 0] }, [B.rFore]: { rot: [-0.1 * a, 0, 0] } } },
    { t: 1, phase: 'settle', bones: {} },
  ];
}

/** cast_and_wait: fishing — overhead cast then forward, idle line tension loop. */
function poses_cast_and_wait(a: number): ActionPose[] {
  return [
    rest(),
    { t: 0.25, phase: 'windup', bones: { [B.rArm]: { rot: [-2.0 * a, 0, 0] }, [B.rFore]: { rot: [-0.8 * a, 0, 0] }, [B.spine]: { rot: [-0.15 * a, 0, 0] } } },
    { t: 0.45, phase: 'action', bones: { [B.rArm]: { rot: [0.3 * a, 0, 0] }, [B.rFore]: { rot: [-0.2 * a, 0, 0] }, [B.spine]: { rot: [0.1 * a, 0, 0] } } },
    { t: 1, phase: 'follow', bones: { [B.rArm]: { rot: [0.05 * a, 0, 0] } } },
  ];
}

/** lean_reach: lean/peek/pickpocket/lockpick/hack — torso off-axis, one arm out. */
function poses_lean_reach(a: number): ActionPose[] {
  return [
    rest(),
    { t: 0.35, phase: 'windup', bones: { [B.spine]: { rot: [0.1 * a, 0, 0.3 * a] }, [B.chest]: { rot: [0, 0, 0.2 * a] } } },
    { t: 0.6, phase: 'action', bones: { [B.spine]: { rot: [0.15 * a, 0, 0.35 * a] }, [B.rArm]: { rot: [0.8 * a, 0, -0.2 * a] }, [B.rFore]: { rot: [-0.5 * a, 0, 0] } } },
    { t: 1, phase: 'settle', bones: {} },
  ];
}

/** social_gesture: greet/converse/emote/court/mentor — head + arm beats. */
function poses_social_gesture(a: number): ActionPose[] {
  return [
    rest(),
    { t: 0.3, phase: 'windup', bones: { [B.rArm]: { rot: [-0.6 * a, 0, -0.5 * a] }, [B.head]: { rot: [0, -0.15 * a, 0] }, [B.chest]: { rot: [0, -0.1 * a, 0] } } },
    { t: 0.55, phase: 'action', bones: { [B.rArm]: { rot: [-0.9 * a, 0, -0.7 * a] }, [B.rFore]: { rot: [-0.3 * a, 0, 0] }, [B.head]: { rot: [0, 0.1 * a, 0] } } },
    { t: 0.8, phase: 'follow', bones: { [B.rArm]: { rot: [-0.4 * a, 0, -0.3 * a] } } },
    { t: 1, phase: 'settle', bones: {} },
  ];
}

/** mount: mount/dismount/ride — leg swing then seated. */
function poses_mount(a: number): ActionPose[] {
  return [
    rest(),
    { t: 0.35, phase: 'windup', bones: { [B.rUpLeg]: { rot: [-1.0 * a, 0, -0.4 * a] }, [B.spine]: { rot: [0.2 * a, 0, 0] }, [B.rArm]: { rot: [0.6 * a, 0, 0] } } },
    { t: 0.6, phase: 'action', bones: { [B.rUpLeg]: { rot: [-0.6 * a, 0, 0] }, [B.lUpLeg]: { rot: [-0.6 * a, 0, 0] }, [B.hips]: { pos: [0, 0.1 * a, 0] } } },
    { t: 1, phase: 'settle', bones: { [B.rUpLeg]: { rot: [-0.7 * a, 0, 0.2 * a] }, [B.lUpLeg]: { rot: [-0.7 * a, 0, -0.2 * a] } } },
  ];
}

/** locomotion_modal: climb/swim/glide — minimal; gait/combat own the body. */
function poses_locomotion_modal(a: number): ActionPose[] {
  return [rest(), { t: 0.5, phase: 'action', bones: { [B.spine]: { rot: [0.1 * a, 0, 0] } } }, { t: 1, phase: 'settle', bones: {} }];
}

const ARCHETYPE_GEN: Record<ActionArchetype, (a: number) => ActionPose[]> = {
  swing_down: poses_swing_down,
  thrust: poses_thrust,
  crouch_reach_pluck: poses_crouch_reach_pluck,
  cast_channel: poses_cast_channel,
  manipulate_in_place: poses_manipulate_in_place,
  cast_and_wait: poses_cast_and_wait,
  lean_reach: poses_lean_reach,
  social_gesture: poses_social_gesture,
  mount: poses_mount,
  locomotion_modal: poses_locomotion_modal,
};

/** Pure: the pose sequence for an archetype at a tier (no THREE; testable). */
export function buildActionPoses(archetype: ActionArchetype, tier = 3): ActionPose[] {
  const gen = ARCHETYPE_GEN[archetype] || ARCHETYPE_GEN.manipulate_in_place;
  return gen(ampFor(tier));
}

// ── The verb → descriptor table (adding a verb = a row) ──────────────────────
export const ACTION_DESCRIPTORS: Record<string, ActionDescriptor> = {
  // labor / extraction
  chop:   { archetype: 'swing_down', leadingLimb: 'both_arms', phases: [180, 120, 260], juiceId: 'impact_wood', sfxId: 'axe_chop', vfx: 'woodchips' },
  log:    { archetype: 'swing_down', leadingLimb: 'both_arms', phases: [180, 120, 260], juiceId: 'impact_wood', sfxId: 'axe_chop', vfx: 'woodchips' },
  mine:   { archetype: 'swing_down', leadingLimb: 'both_arms', phases: [200, 130, 280], juiceId: 'impact_stone', sfxId: 'pick_strike', vfx: 'rock_debris' },
  till:   { archetype: 'swing_down', leadingLimb: 'both_arms', phases: [180, 120, 240], juiceId: 'impact_soil', sfxId: 'hoe_dig', vfx: 'dirt' },
  dig:    { archetype: 'thrust',     leadingLimb: 'right_arm', phases: [160, 140, 220], juiceId: 'impact_soil', sfxId: 'shovel_dig', vfx: 'dirt' },
  gather: { archetype: 'crouch_reach_pluck', leadingLimb: 'spine', phases: [220, 140, 200], juiceId: 'soft_pluck', sfxId: 'rustle', vfx: 'sparkle' },
  forage: { archetype: 'crouch_reach_pluck', leadingLimb: 'spine', phases: [220, 140, 200], juiceId: 'soft_pluck', sfxId: 'rustle', vfx: 'sparkle' },
  harvest:{ archetype: 'crouch_reach_pluck', leadingLimb: 'spine', phases: [200, 140, 200], juiceId: 'soft_pluck', sfxId: 'crop_snap', vfx: 'leaves' },
  plant:  { archetype: 'crouch_reach_pluck', leadingLimb: 'spine', phases: [220, 140, 220], juiceId: 'soft_plant', sfxId: 'soil_pat', vfx: 'dirt' },
  water:  { archetype: 'manipulate_in_place', leadingLimb: 'right_arm', phases: [160, 120, 180], juiceId: 'water_pour', sfxId: 'water_pour', vfx: 'splash' },
  fish:   { archetype: 'cast_and_wait', leadingLimb: 'right_arm', phases: [200, 160, 0], loop: 'line_tension', juiceId: 'whoosh', sfxId: 'reel' },
  // craft / station (reuse baked occupation clips where they exist)
  build:  { archetype: 'manipulate_in_place', leadingLimb: 'both_arms', phases: [160, 100, 200], clipId: 'construct', juiceId: 'impact_wood', sfxId: 'hammer', vfx: 'dust' },
  construct: { archetype: 'manipulate_in_place', leadingLimb: 'both_arms', phases: [160, 100, 200], clipId: 'construct', juiceId: 'impact_wood', sfxId: 'hammer', vfx: 'dust' },
  craft:  { archetype: 'manipulate_in_place', leadingLimb: 'both_arms', phases: [140, 90, 160], loop: 'hammer_tap', clipId: 'hammer', juiceId: 'craft_tick', sfxId: 'forge_ring', vfx: 'sparks' },
  forge:  { archetype: 'manipulate_in_place', leadingLimb: 'both_arms', phases: [140, 90, 160], loop: 'hammer_tap', clipId: 'hammer', juiceId: 'craft_tick', sfxId: 'forge_ring', vfx: 'sparks' },
  cook:   { archetype: 'manipulate_in_place', leadingLimb: 'right_arm', phases: [150, 110, 170], juiceId: 'craft_tick', sfxId: 'sizzle', vfx: 'steam' },
  mill:   { archetype: 'manipulate_in_place', leadingLimb: 'both_arms', phases: [160, 120, 180], juiceId: 'craft_tick', sfxId: 'grind' },
  repair: { archetype: 'manipulate_in_place', leadingLimb: 'both_arms', phases: [150, 100, 170], juiceId: 'craft_tick', sfxId: 'wrench' },
  serve:  { archetype: 'thrust', leadingLimb: 'right_arm', phases: [120, 90, 140], juiceId: 'success', sfxId: 'plate_set' },
  // magic / spell / sign / commune
  cast:        { archetype: 'cast_channel', leadingLimb: 'both_arms', phases: [200, 180, 240], juiceId: 'cast', sfxId: 'spell_cast', vfx: 'arcane' },
  compose_spell:{ archetype: 'cast_channel', leadingLimb: 'both_arms', phases: [220, 200, 240], juiceId: 'cast', sfxId: 'spell_cast', vfx: 'arcane' },
  commune:     { archetype: 'cast_channel', leadingLimb: 'both_arms', phases: [260, 240, 300], juiceId: 'milestone', sfxId: 'chime', vfx: 'sparkle' },
  place_sign:  { archetype: 'thrust', leadingLimb: 'right_arm', phases: [180, 140, 220], juiceId: 'impact_soil', sfxId: 'post_drive', vfx: 'dirt' },
  // social / npc
  talk:    { archetype: 'social_gesture', leadingLimb: 'head', phases: [200, 160, 200], juiceId: 'soft', sfxId: 'greet' },
  greet:   { archetype: 'social_gesture', leadingLimb: 'right_arm', phases: [180, 140, 180], juiceId: 'soft', sfxId: 'greet' },
  wave:    { archetype: 'social_gesture', leadingLimb: 'right_arm', phases: [160, 200, 160], loop: 'wave', juiceId: 'soft', sfxId: 'greet' },
  court:   { archetype: 'social_gesture', leadingLimb: 'head', phases: [220, 180, 220], juiceId: 'soft', sfxId: 'greet', vfx: 'heart' },
  mentor:  { archetype: 'social_gesture', leadingLimb: 'right_arm', phases: [200, 160, 200], juiceId: 'soft', sfxId: 'greet' },
  trade:   { archetype: 'manipulate_in_place', leadingLimb: 'both_arms', phases: [140, 100, 160], juiceId: 'coin', sfxId: 'coins' },
  applaud: { archetype: 'social_gesture', leadingLimb: 'both_arms', phases: [120, 240, 120], loop: 'clap', juiceId: 'success', sfxId: 'clap' },
  // immersive-sim
  hack:    { archetype: 'lean_reach', leadingLimb: 'right_arm', phases: [220, 200, 200], juiceId: 'tech_tick', sfxId: 'keys', vfx: 'glitch' },
  lockpick:{ archetype: 'lean_reach', leadingLimb: 'right_arm', phases: [240, 220, 200], juiceId: 'tech_tick', sfxId: 'pick' },
  pickpocket:{ archetype: 'lean_reach', leadingLimb: 'right_arm', phases: [200, 160, 180], juiceId: 'soft', sfxId: 'cloth' },
  // mount / consume
  mount:   { archetype: 'mount', leadingLimb: 'legs', phases: [240, 200, 200], juiceId: 'success', sfxId: 'mount' },
  dismount:{ archetype: 'mount', leadingLimb: 'legs', phases: [200, 180, 200], juiceId: 'soft', sfxId: 'dismount' },
  eat:     { archetype: 'manipulate_in_place', leadingLimb: 'right_arm', phases: [180, 200, 180], juiceId: 'soft', sfxId: 'eat', vfx: 'sparkle' },
  drink:   { archetype: 'manipulate_in_place', leadingLimb: 'right_arm', phases: [180, 200, 180], juiceId: 'soft', sfxId: 'drink' },
  take_photo: { archetype: 'lean_reach', leadingLimb: 'both_arms', phases: [160, 120, 160], juiceId: 'success', sfxId: 'shutter', vfx: 'flash' },
  // traversal (Part B) — dash/slide/climb/vault/mantle. locomotion_modal extends
  // gait/combat modes; these layer via the pose-broker 'traversal' source.
  dash:    { archetype: 'locomotion_modal', leadingLimb: 'legs', phases: [80, 120, 120], juiceId: 'whoosh', sfxId: 'dash', vfx: 'dust' },
  dodge:   { archetype: 'locomotion_modal', leadingLimb: 'legs', phases: [80, 120, 140], juiceId: 'whoosh', sfxId: 'dash', vfx: 'dust' },
  slide:   { archetype: 'locomotion_modal', leadingLimb: 'legs', phases: [120, 220, 180], juiceId: 'whoosh', sfxId: 'slide', vfx: 'dust' },
  climb:   { archetype: 'locomotion_modal', leadingLimb: 'both_arms', phases: [220, 0, 200], loop: 'climb', juiceId: 'soft', sfxId: 'scrape' },
  vault:   { archetype: 'locomotion_modal', leadingLimb: 'both_arms', phases: [140, 120, 140], juiceId: 'whoosh', sfxId: 'vault' },
  mantle:  { archetype: 'locomotion_modal', leadingLimb: 'both_arms', phases: [180, 160, 180], juiceId: 'soft', sfxId: 'vault' },
};

// Category fallback so NO verb is ever silent.
const CATEGORY_FALLBACK: Record<string, ActionDescriptor> = {
  labor:  { archetype: 'swing_down', leadingLimb: 'both_arms', phases: [180, 120, 240], juiceId: 'impact', sfxId: 'thud', vfx: 'dust' },
  craft:  { archetype: 'manipulate_in_place', leadingLimb: 'both_arms', phases: [150, 100, 170], juiceId: 'craft_tick', sfxId: 'work' },
  social: { archetype: 'social_gesture', leadingLimb: 'head', phases: [200, 160, 200], juiceId: 'soft', sfxId: 'greet' },
  world:  { archetype: 'thrust', leadingLimb: 'right_arm', phases: [160, 120, 180], juiceId: 'impact', sfxId: 'thud' },
};
const GENERIC: ActionDescriptor = { archetype: 'manipulate_in_place', leadingLimb: 'both_arms', phases: [150, 100, 160], juiceId: 'soft', sfxId: 'work' };

// rough verb→category for the fallback path
function categoryOf(verb: string): keyof typeof CATEGORY_FALLBACK {
  const v = verb.toLowerCase();
  if (/farm|build|mine|log|fish|mill|cook|gather|dig|till|plant|water|harvest|forage|chop|construct|forge|craft|repair|smith|haul|saw|scythe|sweep/.test(v)) return 'labor';
  if (/talk|greet|wave|court|mentor|trade|applaud|converse|intimidate|hire|inspect|emote/.test(v)) return 'social';
  if (/sign|photo|claim|commune|cast|spell|glyph|sing|answer|breed|hack|lockpick|pickpocket/.test(v)) return 'world';
  return 'craft';
}

/** Resolve a verb to a descriptor: specific → category fallback → generic. Never null. */
export function resolveActionDescriptor(verb: string): ActionDescriptor {
  if (!verb) return GENERIC;
  const key = verb.toLowerCase().replace(/[- ]/g, '_');
  return ACTION_DESCRIPTORS[key] || CATEGORY_FALLBACK[categoryOf(key)] || GENERIC;
}

// ── Clip construction (THREE) ────────────────────────────────────────────────
function posesToClip(name: string, poses: ActionPose[], durSec: number): THREE.AnimationClip {
  const trackMap = new Map<string, { times: number[]; quats: number[]; vecs: number[]; hasRot: boolean; hasPos: boolean }>();
  for (const pose of poses) {
    const tt = pose.t * durSec;
    for (const [bone, data] of Object.entries(pose.bones)) {
      let tr = trackMap.get(bone);
      if (!tr) { tr = { times: [], quats: [], vecs: [], hasRot: false, hasPos: false }; trackMap.set(bone, tr); }
      tr.times.push(tt);
      const q = new THREE.Quaternion();
      if (data.rot) { q.setFromEuler(new THREE.Euler(data.rot[0], data.rot[1], data.rot[2])); tr.hasRot = true; }
      tr.quats.push(q.x, q.y, q.z, q.w);
      const p = data.pos || [0, 0, 0];
      if (data.pos) tr.hasPos = true;
      tr.vecs.push(p[0], p[1], p[2]);
    }
  }
  const tracks: THREE.KeyframeTrack[] = [];
  for (const [bone, tr] of trackMap) {
    if (tr.hasRot) tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, tr.times, tr.quats));
    if (tr.hasPos) tracks.push(new THREE.VectorKeyframeTrack(`${bone}.position`, tr.times, tr.vecs));
  }
  return new THREE.AnimationClip(name, durSec, tracks);
}

/** Build a THREE clip for a verb. The total duration = sum of the descriptor phases. */
export function buildActionClip(verb: string, tier = 3): THREE.AnimationClip {
  const d = resolveActionDescriptor(verb);
  const durSec = Math.max(0.2, (d.phases[0] + d.phases[1] + d.phases[2]) / 1000);
  const poses = buildActionPoses(d.archetype, tier);
  return posesToClip(`action-${verb}`, poses, durSec);
}

/** Master verb list (coverage target). */
export const ACTION_VERBS = Object.keys(ACTION_DESCRIPTORS);
export const ACTION_ARCHETYPES: ActionArchetype[] = Object.keys(ARCHETYPE_GEN) as ActionArchetype[];
export const _internal = { B, ampFor, CATEGORY_FALLBACK, GENERIC, categoryOf };
