/**
 * gait-synthesis.ts
 *
 * Derives all character bone rotations from physics parameters.
 * No keyframes. No mocap assets.
 *
 * Core insight: mocap captures movement that human bodies physically allow.
 * By encoding those same biomechanical constraints as parameters
 * (speed, slope, load, fatigue, body type, style) we can generate every
 * natural human gait from first principles.
 *
 * References: Winter (2009) Biomechanics of Human Movement,
 * Perry & Burnfield (2010) Gait Analysis, Dempster (1955) segment mass data.
 */

import * as THREE from 'three';
import { type MovementStyleConfig } from './movement-styles';

// Defined locally to avoid circular import with AvatarSystem3D.
export type BodyType = 'slim' | 'average' | 'stocky' | 'tall';

// ── Body stride length by type (metres) ──────────────────────────────────────
// Derived from leg-length / height ratio and normal adult walking research.

const BODY_STRIDE_LENGTHS: Record<BodyType, number> = {
  slim:    0.70,
  average: 0.75,
  stocky:  0.72,
  tall:    0.85,
};

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface GaitParams {
  /** Actual movement speed in m/s (0 = idle, 5 = walk, 12 = sprint). */
  speed:    number;
  /** Direction of travel in radians relative to character facing (0 = forward, π/2 = strafe right). */
  direction: number;
  /** Ground slope in radians at current position (+ = uphill). */
  slope:    number;
  /** Total load carried in kg (sum of equipped weapon mass etc.). */
  load:     number;
  /** Fatigue coefficient 0–1 (maps from currentStamina / maxStamina). 1 = fresh. */
  fatigue:  number;
  bodyType: BodyType;
  style:    MovementStyleConfig;
}

/**
 * Per-bone Euler rotation deltas (radians) for one frame of gait.
 * These are SET on the bone (not additive) — the gait pose is the ground truth.
 * IK and CoM balance adjustments are applied afterward as additive corrections.
 */
export interface GaitPose {
  hips:         THREE.Euler;
  /** Vertical offset applied to hips group position (hip bob). */
  hipOffset:    THREE.Vector3;
  spine:        THREE.Euler;
  chest:        THREE.Euler;
  neck:         THREE.Euler;
  leftUpperLeg:  THREE.Euler;
  leftLowerLeg:  THREE.Euler;
  leftFoot:      THREE.Euler;
  rightUpperLeg: THREE.Euler;
  rightLowerLeg: THREE.Euler;
  rightFoot:     THREE.Euler;
  leftUpperArm:  THREE.Euler;
  leftForearm:   THREE.Euler;
  rightUpperArm: THREE.Euler;
  rightForearm:  THREE.Euler;
}

// ── Phase tracking ────────────────────────────────────────────────────────────

/**
 * Advance stride phase by actual distance covered this frame.
 * This ensures leg movement is proportional to real displacement —
 * no skating regardless of speed change.
 *
 * Returns new phase in [0, 1).
 */
export function advanceGaitPhase(
  phase:    number,
  speed:    number,
  bodyType: BodyType,
  delta:    number,
): number {
  const strideLen = BODY_STRIDE_LENGTHS[bodyType] ?? 0.75;
  const advance   = (speed * delta) / strideLen;
  return (phase + advance) % 1.0;
}

// ── Core synthesis ────────────────────────────────────────────────────────────

/**
 * Synthesize a complete body pose for one gait frame.
 *
 * @param params  Physics + style parameters describing the character state.
 * @param phase   Stride phase in [0, 1) — use advanceGaitPhase() each frame.
 */
export function synthesizeGait(params: GaitParams, phase: number): GaitPose {
  const { speed, slope, load, fatigue, style } = params;

  const speedNorm = Math.min(Math.max(speed / 12, 0), 1);

  // Stride geometry
  const strideLen  = style.strideLengthScale * (0.4 + speedNorm * 0.6);
  const thighSwing = strideLen * (0.4 + speedNorm * 0.35);

  // Phase angles — left and right legs are 180° out of phase
  const legPhaseL = phase * Math.PI * 2;
  const legPhaseR = legPhaseL + Math.PI;

  // ── Hip dynamics ─────────────────────────────────────────────────────────
  const hipSway   = style.hipSwayAmplitude * (0.05 + speedNorm * 0.04);
  const hipBob    = speedNorm * 0.03 * Math.max(0, 1 - load / 20);

  // ── Slope & load compensation ─────────────────────────────────────────────
  // Uphill: lean forward; downhill: lean back; load: slight crouch
  const slopeComp  = slope * 0.6;
  const loadCrouch = (load / 50) * 0.1;

  // ── Knee flexion ──────────────────────────────────────────────────────────
  // Knee bends more as speed increases and during the swing phase of each leg
  const kneeFlexBase = 0.15 + speedNorm * 0.25;

  // ── Arm swing ─────────────────────────────────────────────────────────────
  // Arms counter-swing relative to legs; amplitude scales with speed and style
  const armSwing = style.armSwingAmplitude * (0.2 + speedNorm * 0.3);

  // ── Fatigue effects ───────────────────────────────────────────────────────
  // Tired characters have smaller swing amplitude and drooping posture
  const fatigueScale = 0.5 + fatigue * 0.5;
  const fatigueDroop = (1 - fatigue) * 0.06;

  return {
    hips: new THREE.Euler(
      slopeComp - loadCrouch + fatigueDroop,
      Math.sin(legPhaseL) * hipSway * 0.5,
      Math.sin(legPhaseL) * hipSway,
    ),

    hipOffset: new THREE.Vector3(
      0,
      Math.abs(Math.sin(legPhaseL)) * hipBob - loadCrouch * 0.5,
      0,
    ),

    spine: new THREE.Euler(
      slopeComp * 0.4 + style.combatStanceOffset + fatigueDroop * 0.5,
      -Math.sin(legPhaseL) * 0.05,
      0,
    ),

    chest: new THREE.Euler(
      style.combatStanceOffset * 0.5 + fatigueDroop * 0.3,
      -Math.sin(legPhaseL) * 0.04,
      0,
    ),

    neck: new THREE.Euler(
      style.headBobFrequency * Math.sin(legPhaseL * 2) * 0.02 * speedNorm - fatigueDroop * 0.4,
      0,
      0,
    ),

    // ── Left leg ───────────────────────────────────────────────────────────
    leftUpperLeg: new THREE.Euler(
      Math.sin(legPhaseL) * thighSwing * fatigueScale,
      0,
      Math.sin(legPhaseL) * hipSway * 0.2,
    ),

    leftLowerLeg: new THREE.Euler(
      // Knee flexes most during swing phase (when thigh is moving forward)
      kneeFlexBase + Math.max(0, -Math.sin(legPhaseL)) * (0.3 + speedNorm * 0.5) * fatigueScale,
      0,
      0,
    ),

    leftFoot: new THREE.Euler(
      // Slight toe-off during push phase, heel-strike during landing
      -Math.sin(legPhaseL) * 0.1 - slopeComp * 0.3,
      0,
      0,
    ),

    // ── Right leg (180° mirror) ────────────────────────────────────────────
    rightUpperLeg: new THREE.Euler(
      Math.sin(legPhaseR) * thighSwing * fatigueScale,
      0,
      -Math.sin(legPhaseR) * hipSway * 0.2,
    ),

    rightLowerLeg: new THREE.Euler(
      kneeFlexBase + Math.max(0, -Math.sin(legPhaseR)) * (0.3 + speedNorm * 0.5) * fatigueScale,
      0,
      0,
    ),

    rightFoot: new THREE.Euler(
      -Math.sin(legPhaseR) * 0.1 - slopeComp * 0.3,
      0,
      0,
    ),

    // ── Arms counter-swing ────────────────────────────────────────────────────
    // Left arm swings BACKWARD when left leg is FORWARD, and vice versa.
    // This is the natural angular-momentum counter-rotation of human gait.
    // Formula: leftUpperArm.x = -sin(legPhaseL); rightUpperArm.x = sin(legPhaseL).
    leftUpperArm: new THREE.Euler(
      -Math.sin(legPhaseL) * armSwing * fatigueScale,
      0,
      style.combatStanceOffset * 0.2,
    ),

    // Elbow bends when arm is swinging forward (arm.x > 0 → sin(legPhaseL) > 0 → arm forward for right)
    leftForearm: new THREE.Euler(
      0.1 + Math.max(0, -Math.sin(legPhaseL)) * armSwing * 0.3,
      0,
      0,
    ),

    rightUpperArm: new THREE.Euler(
      Math.sin(legPhaseL) * armSwing * fatigueScale,
      0,
      -style.combatStanceOffset * 0.2,
    ),

    rightForearm: new THREE.Euler(
      0.1 + Math.max(0, Math.sin(legPhaseL)) * armSwing * 0.3,
      0,
      0,
    ),
  };
}

/**
 * Synthesize an idle breathing pose (no locomotion).
 * Chest rises and falls; slight postural sway.
 */
export function synthesizeIdle(
  elapsed:  number,
  style:    MovementStyleConfig,
  fatigue:  number,
): Partial<GaitPose> {
  const breathAmp = style.idleBreathScale * 0.012;
  const fatigueDroop = (1 - fatigue) * 0.05;

  return {
    chest: new THREE.Euler(fatigueDroop, 0, 0),
    spine: new THREE.Euler(style.combatStanceOffset + fatigueDroop * 0.5, 0, 0),
    neck:  new THREE.Euler(-fatigueDroop * 0.3, 0, 0),
    hipOffset: new THREE.Vector3(0, Math.sin(elapsed * 0.8) * breathAmp, 0),
    // Slight weight shift every few seconds
    hips: new THREE.Euler(0, 0, Math.sin(elapsed * 0.3) * 0.008),
  };
}

/**
 * Track 1 — additive breathing over ALL states. Returns the chest bone's
 * scale.y for this frame: a subtle rise/fall that rides on top of whatever pose
 * (walk, run, combat-idle, true idle) the gait/idle synthesis already applied,
 * so a standing guard, a walking merchant, and a combat-ready fighter all
 * visibly breathe — not just the dedicated idle state. Pure + total.
 *
 *   idle/standing → slow + deep (rest breathing)
 *   moving        → faster + shallower (exertion)
 *
 * phaseOffset desynchronises a crowd so NPCs don't all inhale on the same frame.
 */
export function breathingChestScaleY(
  elapsed: number,
  idleBreathScale: number,
  moving: boolean,
  phaseOffset = 0,
): number {
  const rate = moving ? 1.6 : 0.8;                       // breaths/sec proxy
  const amp = (moving ? 0.0025 : 0.004) * idleBreathScale; // shallower under exertion
  return 1 + Math.sin(elapsed * rate + phaseOffset) * amp;
}

/** Deterministic per-entity breathing phase (0..2π) so a crowd breathes out of sync. */
export function breathPhaseFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100000;
  return (h / 100000) * Math.PI * 2;
}

// ── Pose blending ─────────────────────────────────────────────────────────────

function _lerpEuler(a: THREE.Euler, b: THREE.Euler, t: number): THREE.Euler {
  return new THREE.Euler(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

/** Linearly interpolate between two GaitPoses for smooth style/speed transitions. */
export function blendGaitPoses(a: GaitPose, b: GaitPose, t: number): GaitPose {
  return {
    hips:         _lerpEuler(a.hips, b.hips, t),
    hipOffset:    new THREE.Vector3().lerpVectors(a.hipOffset, b.hipOffset, t),
    spine:        _lerpEuler(a.spine, b.spine, t),
    chest:        _lerpEuler(a.chest, b.chest, t),
    neck:         _lerpEuler(a.neck, b.neck, t),
    leftUpperLeg: _lerpEuler(a.leftUpperLeg, b.leftUpperLeg, t),
    leftLowerLeg: _lerpEuler(a.leftLowerLeg, b.leftLowerLeg, t),
    leftFoot:     _lerpEuler(a.leftFoot, b.leftFoot, t),
    rightUpperLeg: _lerpEuler(a.rightUpperLeg, b.rightUpperLeg, t),
    rightLowerLeg: _lerpEuler(a.rightLowerLeg, b.rightLowerLeg, t),
    rightFoot:    _lerpEuler(a.rightFoot, b.rightFoot, t),
    leftUpperArm: _lerpEuler(a.leftUpperArm, b.leftUpperArm, t),
    leftForearm:  _lerpEuler(a.leftForearm, b.leftForearm, t),
    rightUpperArm: _lerpEuler(a.rightUpperArm, b.rightUpperArm, t),
    rightForearm: _lerpEuler(a.rightForearm, b.rightForearm, t),
  };
}

/** Apply a GaitPose to a bone map (Three.js Object3D lookup). */
export function applyGaitPose(
  pose:    GaitPose | Partial<GaitPose>,
  getMesh: (name: string) => THREE.Object3D | undefined,
): void {
  const apply = (name: string, euler: THREE.Euler | undefined) => {
    if (!euler) return;
    const obj = getMesh(name);
    if (obj) {
      obj.rotation.x = euler.x;
      obj.rotation.y = euler.y;
      obj.rotation.z = euler.z;
    }
  };

  apply('hips',         pose.hips);
  apply('spine',        pose.spine);
  apply('chest',        pose.chest);
  apply('neck',         pose.neck);
  apply('leftUpperLeg', pose.leftUpperLeg);
  apply('leftLowerLeg', pose.leftLowerLeg);
  apply('leftFoot',     pose.leftFoot);
  apply('rightUpperLeg', pose.rightUpperLeg);
  apply('rightLowerLeg', pose.rightLowerLeg);
  apply('rightFoot',    pose.rightFoot);
  apply('leftUpperArm', pose.leftUpperArm);
  apply('leftForearm',  pose.leftForearm);
  apply('rightUpperArm', pose.rightUpperArm);
  apply('rightForearm', pose.rightForearm);

  if (pose.hipOffset) {
    const hips = getMesh('hips');
    if (hips) {
      hips.position.y += pose.hipOffset.y;
    }
  }
}
