// concord-frontend/lib/concordia/mounts/rider-ik.ts
//
// Rider-on-mount IK constraints.
//
// Two chains:
//   1) Pelvis → mount saddle anchor. Strict positional lock with a
//      vertical bounce-blend that scales with gait amplitude (gallop
//      bounces, walk doesn't). The hip yaws follow mount yaw.
//   2) Each hand → rein anchor (left + right of mount.head). Solved
//      via the existing FABRIK solver over the rider's arm chain.
//
// CLAUDE.md invariant (B4 will pin this with a frontend test): in
// stance-phase the saddle anchor's foot-contact must remain consistent
// — but stance physics is the mount's job, this module only tracks the
// already-correct mount pose.
//
// We DO NOT directly mutate the rider's full skeleton; we return the
// constraint targets so the AvatarSystem3D pipeline can integrate them
// with its other IK passes (combat aim, feet-on-ground, etc.).

import type { RiderSeatOffset, GaitMode } from "./mount-types";

export interface MountTransform {
  /** Mount root world position (origin at root bone). */
  pos: { x: number; y: number; z: number };
  /** Mount yaw in radians. */
  yaw: number;
  /**
   * World position of the saddle anchor bone. Provided by the mount's
   * skeleton-bound transform — the AvatarSystem3D pipeline traverses
   * the mount mesh to compute it.
   */
  saddleAnchorWorld: { x: number; y: number; z: number };
  /** World position of the reins anchor bone (typically head/neck). */
  reinsAnchorWorld: { x: number; y: number; z: number };
}

export interface BounceParams {
  gaitMode: GaitMode;
  /** Mount linear speed in m/s. */
  speedMps: number;
  /** Active gait phase ∈ [0, 1) — drives sinusoidal bounce. */
  gaitPhase: number;
}

export interface RiderIkTargets {
  /** Pelvis world target — rider hips snap here every frame. */
  pelvisTarget: { x: number; y: number; z: number };
  /** Pelvis yaw (radians) — match the mount's yaw. */
  pelvisYaw: number;
  /** Left hand target (left rein). */
  leftHandTarget: { x: number; y: number; z: number };
  /** Right hand target (right rein). */
  rightHandTarget: { x: number; y: number; z: number };
  /** Bounce magnitude applied this frame (debug). */
  bounceY: number;
}

const REIN_HALF_WIDTH = 0.25;

/**
 * Bounce amplitude (metres) for the rider hips, by gait. These are the
 * peak vertical excursions of the rider relative to the saddle anchor.
 * Walk has near-zero bounce; gallop has the most.
 */
const BOUNCE_AMPLITUDE: Record<GaitMode, number> = {
  walk:   0.005,
  trot:   0.045,
  canter: 0.060,
  gallop: 0.085,
};

const BOUNCE_FREQ_HZ: Record<GaitMode, number> = {
  walk:   1.6,
  trot:   2.4,
  canter: 2.0,
  gallop: 2.8,
};

/**
 * Compute the rider's pelvis bounce offset for the current frame.
 * Returns a positive value at the up-peak of the bounce cycle.
 */
export function computeBounceY(p: BounceParams): number {
  const amp = BOUNCE_AMPLITUDE[p.gaitMode] ?? 0;
  if (amp <= 0) return 0;
  // Phase already covers [0, 1); fold in BOUNCE_FREQ multiplier so
  // gallop at high speed bounces faster than the gait cycle alone.
  const wave = Math.sin(2 * Math.PI * (p.gaitPhase * BOUNCE_FREQ_HZ[p.gaitMode]));
  // Speed gating — under 1 m/s the bounce dampens to keep idle steady.
  const speedGate = Math.min(1, p.speedMps / 1.5);
  return wave * amp * speedGate;
}

/**
 * Compute IK targets for the rider given the mount transform + the
 * species-defined seat offset + the current bounce params. Returns
 * world-space targets the AvatarSystem3D pipeline plugs into FABRIK.
 */
export function computeRiderIkTargets(
  mount: MountTransform,
  seatOffset: RiderSeatOffset,
  bounce: BounceParams,
): RiderIkTargets {
  // Saddle anchor + species-tuned offset (rotated by mount yaw).
  const cy = Math.cos(mount.yaw);
  const sy = Math.sin(mount.yaw);
  const offX = seatOffset.x * cy - seatOffset.z * sy;
  const offZ = seatOffset.x * sy + seatOffset.z * cy;
  const bounceY = computeBounceY(bounce);
  const pelvisTarget = {
    x: mount.saddleAnchorWorld.x + offX,
    y: mount.saddleAnchorWorld.y + seatOffset.y + bounceY,
    z: mount.saddleAnchorWorld.z + offZ,
  };
  // Reins: left + right of the reins anchor, perpendicular to mount yaw.
  const perpX = -sy;
  const perpZ = cy;
  const leftHandTarget = {
    x: mount.reinsAnchorWorld.x + perpX * REIN_HALF_WIDTH,
    y: mount.reinsAnchorWorld.y,
    z: mount.reinsAnchorWorld.z + perpZ * REIN_HALF_WIDTH,
  };
  const rightHandTarget = {
    x: mount.reinsAnchorWorld.x - perpX * REIN_HALF_WIDTH,
    y: mount.reinsAnchorWorld.y,
    z: mount.reinsAnchorWorld.z - perpZ * REIN_HALF_WIDTH,
  };
  return {
    pelvisTarget,
    pelvisYaw: mount.yaw + seatOffset.yaw,
    leftHandTarget,
    rightHandTarget,
    bounceY,
  };
}

/**
 * Maximum vertical excursion expected for a given gait + speed. Used by
 * the camera follower to keep the rider centered without being driven
 * by the bounce wave.
 */
export function maxBounceFor(gaitMode: GaitMode): number {
  return BOUNCE_AMPLITUDE[gaitMode] ?? 0;
}
