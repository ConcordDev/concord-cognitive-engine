// concord-frontend/lib/concordia/mounts/mount-types.ts
//
// TypeScript types for the Concordia Procedural Mount System.
// Mirrors the server-side mount_species + mount_gait_profiles +
// mounted_instances rows. Returned by the macros:
//   mounts.list_species, get_species, get_gait, get_active_mount.

export type SizeClass = "small" | "medium" | "large" | "huge";

export type GaitMode = "walk" | "trot" | "canter" | "gallop";

export interface RiderSeatOffset {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface GaitCycleBlock {
  /** Per-leg phase offsets, FL FR RL RR. Trot = [0, 0.5, 0.5, 0]. */
  phase_offsets: [number, number, number, number];
  /** Stride length in metres. */
  stride_m: number;
  /** Foot ground-clearance in metres at peak swing. */
  ground_clearance_m: number;
}

export interface MountGaitProfile {
  id: string;
  speciesId: string;
  walk: GaitCycleBlock;
  trot: GaitCycleBlock;
  gallop: GaitCycleBlock;
  /** Minimum turning radius in metres (used by steering + IK). */
  turnRadiusM: number;
}

export interface MountSpecies {
  speciesId: string;
  displayName: string;
  sizeClass: SizeClass;
  baseSpeedMps: number;
  baseStamina: number;
  carryCapacityKg: number;
  gaitProfileId: string;
  riderSeatOffset: RiderSeatOffset;
  saddleAnchorBone: string;
  reinsAnchorBone: string;
  flightCapable: boolean;
  aestheticTags: string[];
}

export interface ActiveMountPayload {
  ok: boolean;
  mounted: boolean;
  instance?: { id: string; mountedAt: number };
  companion?: { id: string; name: string; creatureId: string };
  speciesId?: string;
  species?: MountSpecies;
  gait?: MountGaitProfile;
  seatOffset?: RiderSeatOffset;
}

/** Mounted state machine — see mount-state-machine.ts.
 *  Phase U adds wandering / fleeing / feeding for substrate-driven
 *  loose mount behaviour. */
export type MountedState =
  | "unmounted"
  | "mounting"
  | "mounted_idle"
  | "mounted_walk"
  | "mounted_trot"
  | "mounted_gallop"
  | "mounted_combat"
  | "dismounting"
  | "wandering"
  | "fleeing"
  | "feeding";

export interface MountedFrame {
  /** Mount world position. */
  mountPos: { x: number; y: number; z: number };
  /** Mount yaw in radians. */
  mountYaw: number;
  /** Mount linear velocity (m/s). */
  speed: number;
  /** Active gait phase ∈ [0, 1) for the current cycle. */
  gaitPhase: number;
  /** Active gait mode at this frame. */
  gaitMode: GaitMode;
}
