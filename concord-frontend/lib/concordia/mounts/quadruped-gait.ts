// concord-frontend/lib/concordia/mounts/quadruped-gait.ts
//
// Concordia Procedural Mount System Phase B4 — quadruped gait synthesis.
//
// Procedural 4-leg locomotion. Inputs: species gait profile (walk/trot/
// gallop cycle blocks from the server) + frame state (speed, slope,
// fatigue). Outputs: per-leg phase + foot world position so the IK
// solver in `quadruped-ik.ts` can plant feet on the ground.
//
// CLAUDE.md invariant (B1): foot-slide in stance phase must stay < 2cm.
// We achieve that via:
//   1. Foot-planting via ground-raycast — when a leg enters stance
//      phase, capture the world-position; hold it constant until
//      lift-off.
//   2. Stride length scaled by frame dt × speed so the next leg's
//      stance starts at exactly stride_m ahead.
//   3. Phase advance is monotonic — no rewind on slowdown; we
//      interpolate cycle frequency instead.

import type { GaitCycleBlock, GaitMode, MountGaitProfile } from "./mount-types";

export type LegId = "fl" | "fr" | "rl" | "rr";
const LEGS: LegId[] = ["fl", "fr", "rl", "rr"];

export interface MountGaitInput {
  /** Per-frame elapsed seconds. */
  dt: number;
  /** Mount linear speed (m/s). */
  speedMps: number;
  /** Mount yaw (radians) — used to project stride into world space. */
  yaw: number;
  /** Mount root world position. */
  pos: { x: number; y: number; z: number };
  /** Slope along yaw (radians) — positive uphill. */
  slope?: number;
  /** Fatigue [0, 1] — high fatigue dampens stride amplitude. */
  fatigue?: number;
  /** Active gait mode. */
  gaitMode: GaitMode;
}

export interface LegFrame {
  legId: LegId;
  /** Per-leg phase ∈ [0, 1) within the cycle. */
  phase: number;
  /** True iff foot is in stance phase (touching ground). */
  inStance: boolean;
  /** Stance progress ∈ [0, 1] within stance phase (or 0 in swing). */
  stanceProgress: number;
  /** Swing progress ∈ [0, 1] within swing phase (or 0 in stance). */
  swingProgress: number;
  /** Foot world target. In stance: pinned to ground (set by IK pass). */
  footTarget: { x: number; y: number; z: number };
  /** Vertical lift above ground in swing phase. */
  swingHeightM: number;
}

export interface QuadrupedGaitState {
  /** Cycle phase ∈ [0, 1) — drives leg-phase math. */
  cyclePhase: number;
  /** Active gait mode (driven by speed via gaitForSpeed in mount-state-machine.ts). */
  gaitMode: GaitMode;
  /** Per-leg frame snapshot. */
  legs: Record<LegId, LegFrame>;
  /** Gait stride in metres (mode-dependent). */
  strideM: number;
}

export function makeInitialGaitState(gaitMode: GaitMode = "walk"): QuadrupedGaitState {
  const legs: Record<LegId, LegFrame> = {} as Record<LegId, LegFrame>;
  for (const id of LEGS) {
    legs[id] = {
      legId: id,
      phase: 0,
      inStance: true,
      stanceProgress: 0,
      swingProgress: 0,
      footTarget: { x: 0, y: 0, z: 0 },
      swingHeightM: 0,
    };
  }
  return { cyclePhase: 0, gaitMode, legs, strideM: 0 };
}

function cycleFor(profile: MountGaitProfile, mode: GaitMode): GaitCycleBlock {
  switch (mode) {
    case "walk":   return profile.walk;
    case "trot":   return profile.trot;
    case "canter": return profile.gallop; // server only ships walk/trot/gallop; canter aliases gallop with damped freq
    case "gallop": return profile.gallop;
  }
}

// Cycle-frequency curve: higher speed → faster cycle so foot strikes
// match. tuned around the warhorse 8.5 m/s gallop profile.
function frequencyFor(mode: GaitMode, speedMps: number, strideM: number): number {
  if (strideM <= 0) return 0;
  // strides per second = speed / stride_m
  const sps = speedMps / strideM;
  // For walk we cap floor + ceiling so a slow-walk doesn't go to zero
  // and pause feet on the ground forever.
  if (mode === "walk")   return Math.max(0.4, Math.min(2.0, sps));
  if (mode === "trot")   return Math.max(0.8, Math.min(3.0, sps));
  if (mode === "canter") return Math.max(1.2, Math.min(3.5, sps * 0.85));
  return Math.max(1.5, Math.min(4.5, sps));
}

/**
 * Advance the gait one frame. Returns a new (immutable) state.
 *
 * @param prev — previous frame's state
 * @param input — current-frame input
 * @param profile — species gait profile (from `mounts.get_gait`)
 */
export function stepGait(
  prev: QuadrupedGaitState,
  input: MountGaitInput,
  profile: MountGaitProfile,
): QuadrupedGaitState {
  const cycle = cycleFor(profile, input.gaitMode);
  const strideM = cycle.stride_m;
  const fatigue = Math.max(0, Math.min(1, input.fatigue ?? 0));
  const swingPeak = cycle.ground_clearance_m * (1 - 0.4 * fatigue);

  const freqHz = frequencyFor(input.gaitMode, Math.max(0, input.speedMps), strideM);
  // Cycle phase advance — clamp dt to avoid huge jumps on first frame.
  const dt = Math.max(0, Math.min(0.1, input.dt));
  const cyclePhase = (prev.cyclePhase + freqHz * dt) % 1;

  const legs: Record<LegId, LegFrame> = {} as Record<LegId, LegFrame>;
  const offsets = cycle.phase_offsets;
  for (let i = 0; i < LEGS.length; i++) {
    const id = LEGS[i];
    const phase = (cyclePhase + (offsets[i] || 0)) % 1;
    // Stance phase = first 60% of the cycle for biped trot ([0,0.5,0.5,0]),
    // 50% for gallop, 75% for slow walk. Approximate per-mode.
    const stanceFraction = input.gaitMode === "walk" ? 0.65
                         : input.gaitMode === "trot" ? 0.55
                         : 0.45;
    const inStance = phase < stanceFraction;
    const stanceProgress = inStance ? phase / stanceFraction : 0;
    const swingProgress = inStance ? 0 : (phase - stanceFraction) / (1 - stanceFraction);
    // Sinusoidal lift in swing phase — peaks at progress 0.5.
    const swingHeightM = inStance ? 0 : Math.sin(swingProgress * Math.PI) * swingPeak;
    legs[id] = {
      legId: id,
      phase,
      inStance,
      stanceProgress,
      swingProgress,
      footTarget: prev.legs[id]?.footTarget || { x: input.pos.x, y: input.pos.y, z: input.pos.z },
      swingHeightM,
    };
  }

  return { cyclePhase, gaitMode: input.gaitMode, legs, strideM };
}

/**
 * Foot-target update. Caller wires this AFTER the gait step:
 *   - When a leg crosses from swing → stance: capture the new world-
 *     position from a ground raycast. Pin until next swing.
 *   - When in swing: interpolate the foot toward the next stance
 *     target, ground-clearance lifted by `swingHeightM`.
 *
 * This module only owns the math; the actual `raycastGround` lives in
 * the world-lens physics layer. Caller passes `nextStanceFor(legId)`
 * which returns the pinned ground point for each leg's next plant.
 */
export interface FootPlanter {
  /** Latest world position the leg should plant on (raycast result). */
  nextStanceFor(legId: LegId): { x: number; y: number; z: number };
}

export function applyFootPlanting(
  state: QuadrupedGaitState,
  prev: QuadrupedGaitState,
  planter: FootPlanter,
): QuadrupedGaitState {
  for (const id of LEGS) {
    const cur = state.legs[id];
    const before = prev.legs[id];
    if (!before) continue;
    // Crossed into stance → capture pinned target.
    if (!before.inStance && cur.inStance) {
      cur.footTarget = planter.nextStanceFor(id);
    } else if (cur.inStance) {
      // Stay pinned to the previous target.
      cur.footTarget = before.footTarget;
    } else {
      // Swing — interpolate forward toward the next planned plant.
      // Use the leg's actual swingProgress (computed in stepGait against
      // the gait-mode-specific stance fraction) instead of hard-coded
      // 0.45/0.55 — for walk (stance 0.65) the old constants started t
      // at ~0.36 on the first swing frame and snapped the foot.
      const target = planter.nextStanceFor(id);
      const t = Math.max(0, Math.min(1, cur.swingProgress));
      cur.footTarget = {
        x: before.footTarget.x + (target.x - before.footTarget.x) * t,
        y: target.y + cur.swingHeightM,
        z: before.footTarget.z + (target.z - before.footTarget.z) * t,
      };
    }
  }
  return state;
}

export const _internals = { LEGS, frequencyFor };
