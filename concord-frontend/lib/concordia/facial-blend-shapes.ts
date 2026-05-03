/**
 * facial-blend-shapes.ts
 *
 * Emotion-driven facial blend shapes for character expressions.
 *
 * Problem: Characters have static faces. NPCs making threats have the
 * same neutral expression as NPCs greeting you. This breaks immersion —
 * the face is the primary signal of emotional state in human communication.
 *
 * Technique: Blend shape morph targets (also called "shape keys" in Blender,
 * "morph targets" in glTF). A mesh has N morph targets stored as vertex
 * position deltas. Each target's weight [0,1] controls how much that
 * deformation applies. Mixed together they produce any expression.
 *
 * This file:
 *   1. Defines standard blend shape names aligned with ARKit / glTF2 Face Cap.
 *   2. Maps emotional states to blend weight presets.
 *   3. Provides smooth interpolation between emotional states.
 *   4. Adds procedural micro-expressions: blink, saccade, muscle twitch.
 *
 * Integration: meshes exported from Blender with shape keys named per
 * BLEND_SHAPE_NAMES automatically work. Three.js exposes them as
 * `mesh.morphTargetInfluences[mesh.morphTargetDictionary[name]]`.
 */

import * as THREE from 'three';

// ── Standard blend shape names ────────────────────────────────────────────────
// Subset of ARKit 52-shape standard. Meshes must use these exact names.

export const BLEND_SHAPE_NAMES = [
  // Eyes
  'eyeBlink_L',      'eyeBlink_R',
  'eyeWide_L',       'eyeWide_R',
  'eyeSquint_L',     'eyeSquint_R',
  'eyeLookUp_L',     'eyeLookUp_R',
  'eyeLookDown_L',   'eyeLookDown_R',
  'eyeLookIn_L',     'eyeLookIn_R',
  'eyeLookOut_L',    'eyeLookOut_R',
  // Brows
  'browDown_L',      'browDown_R',
  'browInnerUp',
  'browOuterUp_L',   'browOuterUp_R',
  // Nose
  'noseSneer_L',     'noseSneer_R',
  // Cheeks
  'cheekPuff',
  'cheekSquint_L',   'cheekSquint_R',
  // Mouth
  'mouthClose',
  'mouthFunnel',     'mouthPucker',
  'mouthLeft',       'mouthRight',
  'mouthSmile_L',    'mouthSmile_R',
  'mouthFrown_L',    'mouthFrown_R',
  'mouthDimple_L',   'mouthDimple_R',
  'mouthStretch_L',  'mouthStretch_R',
  'mouthRollUpper',  'mouthRollLower',
  'mouthShrugUpper', 'mouthShrugLower',
  'mouthPress_L',    'mouthPress_R',
  'mouthLowerDown_L','mouthLowerDown_R',
  'mouthUpperUp_L',  'mouthUpperUp_R',
  // Jaw
  'jawOpen',
  'jawLeft',         'jawRight',
  'jawForward',
  // Tongue
  'tongueOut',
] as const;

export type BlendShapeName = typeof BLEND_SHAPE_NAMES[number];

/** Partial blend weight map — only specify non-zero shapes. */
export type BlendWeights = Partial<Record<BlendShapeName, number>>;

// ── Emotion presets ───────────────────────────────────────────────────────────

export type EmotionType =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'fearful'
  | 'disgusted'
  | 'surprised'
  | 'contempt'
  | 'focused'    // battle concentration
  | 'exhausted'
  | 'determined';

export const EMOTION_PRESETS: Record<EmotionType, BlendWeights> = {
  neutral: {},

  happy: {
    mouthSmile_L:    0.8,
    mouthSmile_R:    0.8,
    cheekSquint_L:   0.4,
    cheekSquint_R:   0.4,
    eyeSquint_L:     0.3,
    eyeSquint_R:     0.3,
    browOuterUp_L:   0.1,
    browOuterUp_R:   0.1,
  },

  sad: {
    mouthFrown_L:    0.7,
    mouthFrown_R:    0.7,
    browInnerUp:     0.6,
    browDown_L:      0.2,
    browDown_R:      0.2,
    mouthRollLower:  0.3,
    eyeLookDown_L:   0.2,
    eyeLookDown_R:   0.2,
  },

  angry: {
    browDown_L:      0.9,
    browDown_R:      0.9,
    noseSneer_L:     0.5,
    noseSneer_R:     0.5,
    mouthStretch_L:  0.3,
    mouthStretch_R:  0.3,
    mouthPress_L:    0.4,
    mouthPress_R:    0.4,
    eyeSquint_L:     0.5,
    eyeSquint_R:     0.5,
  },

  fearful: {
    eyeWide_L:       0.9,
    eyeWide_R:       0.9,
    browInnerUp:     0.7,
    browOuterUp_L:   0.5,
    browOuterUp_R:   0.5,
    mouthStretch_L:  0.6,
    mouthStretch_R:  0.6,
    jawOpen:         0.2,
  },

  disgusted: {
    noseSneer_L:     0.8,
    noseSneer_R:     0.8,
    mouthFrown_L:    0.5,
    mouthFrown_R:    0.5,
    mouthShrugUpper: 0.4,
    browDown_L:      0.3,
    browDown_R:      0.3,
    eyeSquint_L:     0.3,
    eyeSquint_R:     0.3,
  },

  surprised: {
    eyeWide_L:       1.0,
    eyeWide_R:       1.0,
    browOuterUp_L:   0.8,
    browOuterUp_R:   0.8,
    browInnerUp:     0.8,
    jawOpen:         0.6,
    mouthFunnel:     0.3,
  },

  contempt: {
    mouthSmile_L:    0.4,   // asymmetric smirk
    mouthSmile_R:    0.0,
    mouthDimple_L:   0.3,
    browDown_R:      0.2,
    eyeSquint_R:     0.2,
  },

  focused: {
    browDown_L:      0.5,
    browDown_R:      0.5,
    eyeSquint_L:     0.4,
    eyeSquint_R:     0.4,
    mouthPress_L:    0.3,
    mouthPress_R:    0.3,
    jawForward:      0.1,
  },

  exhausted: {
    eyeBlink_L:      0.4,  // heavy eyelids
    eyeBlink_R:      0.4,
    eyeLookDown_L:   0.3,
    eyeLookDown_R:   0.3,
    mouthFrown_L:    0.3,
    mouthFrown_R:    0.3,
    browDown_L:      0.2,
    browDown_R:      0.2,
    jawOpen:         0.1,  // slight mouth open
  },

  determined: {
    browDown_L:      0.4,
    browDown_R:      0.4,
    mouthPress_L:    0.5,
    mouthPress_R:    0.5,
    eyeSquint_L:     0.2,
    eyeSquint_R:     0.2,
    noseSneer_L:     0.1,
    noseSneer_R:     0.1,
  },
};

// ── Blend interpolation ───────────────────────────────────────────────────────

/**
 * Linearly interpolate between two blend weight maps.
 * Missing keys are treated as 0.
 */
export function lerpBlendWeights(a: BlendWeights, b: BlendWeights, t: number): BlendWeights {
  const result: BlendWeights = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<BlendShapeName>;

  for (const key of keys) {
    const va = (a as Record<string, number>)[key] ?? 0;
    const vb = (b as Record<string, number>)[key] ?? 0;
    const v  = va + (vb - va) * t;
    if (Math.abs(v) > 0.001) {
      (result as Record<string, number>)[key] = v;
    }
  }

  return result;
}

// ── Procedural micro-expressions ─────────────────────────────────────────────

export interface MicroExpressionState {
  blinkTimer:      number;
  blinkInterval:   number;  // seconds between blinks (2–8s typically)
  blinkDuration:   number;  // seconds for one blink (0.1–0.15s)
  blinkPhase:      number;  // 0 = eyes open, 0..1 = blink in progress
  saccadeTimer:    number;
  saccadeInterval: number;
  saccadeX:        number;
  saccadeY:        number;
}

export function createMicroExpressionState(): MicroExpressionState {
  return {
    blinkTimer:      0,
    blinkInterval:   3 + Math.random() * 4,  // 3–7 seconds
    blinkDuration:   0.12,
    blinkPhase:      0,
    saccadeTimer:    0,
    saccadeInterval: 1.5 + Math.random() * 2,
    saccadeX:        0,
    saccadeY:        0,
  };
}

/**
 * Update micro-expression state each frame.
 * Returns partial BlendWeights for eye blink + saccade.
 */
export function updateMicroExpressions(
  state: MicroExpressionState,
  delta: number,
  fatigueScale = 1.0, // 0=exhausted (more blinks), 1=fresh
): BlendWeights {
  const result: BlendWeights = {};

  state.blinkTimer += delta;

  // Start a blink
  if (state.blinkTimer >= state.blinkInterval) {
    state.blinkTimer    = 0;
    state.blinkInterval = (3 + Math.random() * 4) / (1 + (1 - fatigueScale) * 2);
    state.blinkPhase    = 0.001; // begin blink
  }

  // Advance blink animation
  if (state.blinkPhase > 0) {
    state.blinkPhase += delta / state.blinkDuration;
    if (state.blinkPhase >= 1) {
      state.blinkPhase = 0; // blink complete
    }
    // Blink shape: quick close (sin half-arch)
    const blinkAmount = Math.sin(state.blinkPhase * Math.PI);
    result.eyeBlink_L = blinkAmount;
    result.eyeBlink_R = blinkAmount;
  }

  // Saccade: micro eye movements
  state.saccadeTimer += delta;
  if (state.saccadeTimer >= state.saccadeInterval) {
    state.saccadeTimer    = 0;
    state.saccadeInterval = 1.5 + Math.random() * 2;
    state.saccadeX = (Math.random() - 0.5) * 0.3;
    state.saccadeY = (Math.random() - 0.5) * 0.2;
  }

  if (Math.abs(state.saccadeX) > 0.01) {
    if (state.saccadeX > 0) {
      result.eyeLookIn_L  = state.saccadeX;
      result.eyeLookOut_R = state.saccadeX;
    } else {
      result.eyeLookOut_L = -state.saccadeX;
      result.eyeLookIn_R  = -state.saccadeX;
    }
  }
  if (state.saccadeY > 0.01) {
    result.eyeLookUp_L = state.saccadeY;
    result.eyeLookUp_R = state.saccadeY;
  } else if (state.saccadeY < -0.01) {
    result.eyeLookDown_L = -state.saccadeY;
    result.eyeLookDown_R = -state.saccadeY;
  }

  return result;
}

// ── Facial animation controller ───────────────────────────────────────────────

/**
 * Controls the facial blend shapes of one character mesh.
 *
 * Usage:
 * ```ts
 * const face = new FacialController(headMesh);
 * face.setEmotion('angry');
 * // each frame:
 * face.update(delta, fatigue);
 * ```
 */
export class FacialController {
  private mesh:           THREE.Mesh;
  private currentWeights: BlendWeights = {};
  private targetWeights:  BlendWeights = {};
  private microState:     MicroExpressionState;
  private transitionSpeed = 2.0; // blend shapes transition at this rate (per second)

  constructor(mesh: THREE.Mesh) {
    this.mesh       = mesh;
    this.microState = createMicroExpressionState();
  }

  /** Transition to a named emotion preset. */
  setEmotion(emotion: EmotionType, transitionSpeed = 2.0): void {
    this.targetWeights  = { ...EMOTION_PRESETS[emotion] };
    this.transitionSpeed = transitionSpeed;
  }

  /** Set a custom blend weight target. */
  setWeights(weights: BlendWeights, transitionSpeed = 2.0): void {
    this.targetWeights   = { ...weights };
    this.transitionSpeed = transitionSpeed;
  }

  /**
   * Update each frame. Interpolates toward target and applies micro-expressions.
   *
   * @param delta    Frame time in seconds.
   * @param fatigue  Character fatigue 0–1 (affects blink rate, eye droop).
   */
  update(delta: number, fatigue = 1.0): void {
    const t = Math.min(this.transitionSpeed * delta, 1);
    this.currentWeights = lerpBlendWeights(this.currentWeights, this.targetWeights, t);

    const micro = updateMicroExpressions(this.microState, delta, fatigue);
    const combined = { ...this.currentWeights };

    // Micro-expressions override emotion blinks (don't double-blink)
    for (const key of Object.keys(micro) as BlendShapeName[]) {
      (combined as Record<string, number>)[key] =
        Math.max(
          (combined as Record<string, number>)[key] ?? 0,
          (micro as Record<string, number>)[key] ?? 0,
        );
    }

    this._applyWeights(combined);
  }

  private _applyWeights(weights: BlendWeights): void {
    const dict = this.mesh.morphTargetDictionary;
    const infl = this.mesh.morphTargetInfluences;
    if (!dict || !infl) return;

    // Reset all to 0 first
    for (let i = 0; i < infl.length; i++) infl[i] = 0;

    for (const [name, value] of Object.entries(weights)) {
      const idx = dict[name];
      if (idx !== undefined) infl[idx] = Math.max(0, Math.min(1, value));
    }
  }
}

// ── NPC emotion resolver ──────────────────────────────────────────────────────

export interface NPCEmotionalState {
  health:        number;  // 0–1
  stamina:       number;  // 0–1
  threatLevel:   number;  // 0–1 (nearby enemies)
  isInCombat:    boolean;
  recentDamage:  number;  // damage taken in last 2 seconds
  relationship:  number;  // -1 (hostile) to 1 (friendly)
}

/**
 * Resolve what emotion an NPC should display from its game state.
 * Called by the NPC AI system each tick.
 */
export function resolveNPCEmotion(state: NPCEmotionalState): EmotionType {
  if (state.isInCombat) {
    if (state.health < 0.2)        return 'fearful';
    if (state.stamina < 0.2)       return 'exhausted';
    if (state.recentDamage > 0.3)  return 'angry';
    return 'determined';
  }

  if (state.threatLevel > 0.6)     return 'fearful';
  if (state.threatLevel > 0.3)     return 'focused';
  if (state.health < 0.3)          return 'exhausted';

  if (state.relationship > 0.5)    return 'happy';
  if (state.relationship < -0.5)   return 'contempt';
  if (state.relationship < -0.3)   return 'angry';

  return 'neutral';
}
