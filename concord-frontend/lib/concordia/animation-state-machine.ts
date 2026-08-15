/**
 * animation-state-machine.ts
 *
 * Pure-logic locomotion state selection for the Three.js client.
 *
 * Port of world-lens-godot/avatar/animation_state_machine.gd — same six
 * states (idle/walk/run/jump/fall/land), same thresholds, same blend-band
 * math, same precedence (action override > airborne > land-hold >
 * server locomotion hint > inferred speed). No THREE, no DOM, no mixer:
 * every function is total + testable with a kinematic snapshot.
 *
 * Thresholds are NOT invented here. They are the numbers the Godot file
 * already documents as Three.js parity:
 *   IDLE_MAX_SPEED = 0.05  — character_controller.gd idle/walk cutoff
 *   RUN_MIN_SPEED  = 8.5   — midpoint between AvatarSystem3D MOVE_SPEED
 *                            (5.0) and RUN_SPEED (12.0)
 *   BLEND_BAND     = 1.5   — crossfade width either side of a boundary
 *   LAND_HOLD_MS   = 150   — transient post-touchdown hold
 *
 * JUMP / FALL / LAND had no Three.js equivalent when the Godot machine
 * shipped (airborne motion was a continuous Y-offset, never a discrete
 * clip). This module closes that gap so both clients agree on the label
 * and the blend weights for a given kinematic snapshot.
 */

export const LOCOMOTION_STATES = ['idle', 'walk', 'run', 'jump', 'fall', 'land'] as const;
export type LocomotionState = (typeof LOCOMOTION_STATES)[number];

/** m/s. Mirrors character_controller.gd / animation_state_machine.gd. */
export const IDLE_MAX_SPEED = 0.05;

/** m/s. Honest midpoint between MOVE_SPEED (5.0) and RUN_SPEED (12.0). */
export const RUN_MIN_SPEED = 8.5;

/** m/s of crossfade band on either side of a locomotion boundary. */
export const BLEND_BAND = 1.5;

/** ms the transient "land" state holds after touchdown. */
export const LAND_HOLD_MS = 150;

const LOCOMOTION_SET: ReadonlySet<string> = new Set(LOCOMOTION_STATES);
const HINT_SET: ReadonlySet<string> = new Set(['idle', 'walk', 'run']);

export interface StateMachineInput {
  /** World-space velocity. Horizontal speed = xz length; vertical = y. */
  velocity?: { x: number; y: number; z: number };
  /** Horizontal speed in m/s. Used when `velocity` is absent. */
  speed?: number;
  /** Vertical velocity in m/s, +up. Used when `velocity` is absent. */
  verticalVelocity?: number;
  /** Snake_case alias — Godot parity. */
  vertical_velocity?: number;
  isAirborne?: boolean;
  /** Snake_case alias — Godot parity. */
  is_airborne?: boolean;
  /**
   * ms since the last airborne→grounded edge. Omit / negative means
   * "not recently landed" (never enters the land state).
   */
  msSinceGrounded?: number;
  ms_since_grounded?: number;
  /**
   * One-shot override (combat swing, emote, gather, sit, …). Anything
   * outside LOCOMOTION_STATES replaces locomotion at full weight.
   */
  action?: string;
  /**
   * Server-authoritative idle/walk/run label (city:positions.users[].locomotion
   * / classifyLocomotion). When present and one of those three, WINS over
   * inferred-speed for STATE selection — never overrides jump/fall/land,
   * and blend weights still crossfade off the locally inferred speed.
   */
  locomotionHint?: string;
  locomotion_hint?: string;
}

export type BlendWeights = Record<string, number> & {
  idle: number;
  walk: number;
  run: number;
  jump: number;
  fall: number;
  land: number;
};

export interface StateMachineResult {
  state: string;
  blend: BlendWeights;
  isOverride: boolean;
}

function emptyBlend(): BlendWeights {
  return { idle: 0, walk: 0, run: 0, jump: 0, fall: 0, land: 0 };
}

function single(state: string): BlendWeights {
  const out = emptyBlend();
  out[state] = 1;
  return out;
}

function extractKinematics(input: StateMachineInput): {
  speed: number;
  verticalVelocity: number;
  isAirborne: boolean;
} {
  const isAirborne = !!(input.isAirborne ?? input.is_airborne ?? false);
  if (input.velocity) {
    const v = input.velocity;
    return {
      speed: Math.hypot(v.x, v.z),
      verticalVelocity: v.y,
      isAirborne,
    };
  }
  const rawSpeed = input.speed ?? 0;
  return {
    speed: Number.isFinite(rawSpeed) ? Math.max(0, rawSpeed) : 0,
    verticalVelocity: input.verticalVelocity ?? input.vertical_velocity ?? 0,
    isAirborne,
  };
}

export function locomotionLabel(speed: number): LocomotionState {
  if (speed < IDLE_MAX_SPEED) return 'idle';
  if (speed < RUN_MIN_SPEED) return 'walk';
  return 'run';
}

/**
 * Crossfade weights across the idle/walk/run continuum. Ramps linearly
 * over BLEND_BAND either side of each boundary instead of a hard pop.
 * Jump/fall/land stay 0 — those are discrete, not speed-blended.
 */
export function locomotionBlend(speed: number): BlendWeights {
  let idleW = 0;
  let walkW = 0;
  let runW = 0;

  const walkBandEnd = IDLE_MAX_SPEED + BLEND_BAND;
  const runBandStart = RUN_MIN_SPEED - BLEND_BAND;

  if (speed <= IDLE_MAX_SPEED) {
    idleW = 1;
  } else if (speed < walkBandEnd) {
    const t = (speed - IDLE_MAX_SPEED) / BLEND_BAND;
    idleW = 1 - t;
    walkW = t;
  } else if (speed <= runBandStart) {
    walkW = 1;
  } else if (speed < RUN_MIN_SPEED) {
    const t2 = (speed - runBandStart) / BLEND_BAND;
    walkW = 1 - t2;
    runW = t2;
  } else {
    runW = 1;
  }

  return { idle: idleW, walk: walkW, run: runW, jump: 0, fall: 0, land: 0 };
}

/**
 * Select the current animation state + blend weights.
 *
 * Precedence (highest → lowest):
 *   1. non-locomotion `action` override (full weight, isOverride=true)
 *   2. airborne → jump if verticalVel > 0 else fall
 *   3. land hold (0 ≤ msSinceGrounded < LAND_HOLD_MS)
 *   4. server locomotion hint (idle/walk/run only) for STATE, blends from speed
 *   5. inferred-from-speed idle/walk/run
 */
export function selectState(input: StateMachineInput): StateMachineResult {
  const action = input.action ? String(input.action) : '';
  if (action && !LOCOMOTION_SET.has(action)) {
    return { state: action, blend: single(action), isOverride: true };
  }

  const kin = extractKinematics(input);
  const msSinceGrounded = input.msSinceGrounded ?? input.ms_since_grounded ?? -1;

  if (kin.isAirborne) {
    const airState: LocomotionState = kin.verticalVelocity > 0 ? 'jump' : 'fall';
    return { state: airState, blend: single(airState), isOverride: false };
  }

  if (msSinceGrounded >= 0 && msSinceGrounded < LAND_HOLD_MS) {
    return { state: 'land', blend: single('land'), isOverride: false };
  }

  const hint = String(input.locomotionHint ?? input.locomotion_hint ?? '');
  if (HINT_SET.has(hint)) {
    return { state: hint, blend: locomotionBlend(kin.speed), isOverride: false };
  }

  return {
    state: locomotionLabel(kin.speed),
    blend: locomotionBlend(kin.speed),
    isOverride: false,
  };
}

export const ANIM_STATE_MACHINE = Object.freeze({
  LOCOMOTION_STATES,
  IDLE_MAX_SPEED,
  RUN_MIN_SPEED,
  BLEND_BAND,
  LAND_HOLD_MS,
});
