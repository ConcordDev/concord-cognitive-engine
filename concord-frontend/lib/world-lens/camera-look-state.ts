/**
 * cameraLookState — shared mouse-look state between ConcordiaScene
 * (which writes to it on each pointer-lock mousemove) and AvatarSystem3D
 * (which reads it to align player rotation with camera yaw in first-person
 * and to find movement direction in follow mode).
 *
 * Module-level singleton because the two consumers are sibling components
 * that don't share refs and a per-frame window event would be chatty.
 *
 * `yaw` is in radians, accumulated additively from mouse movement.
 * `pitch` is clamped to [-1.2, 1.2] (~±69°).
 *
 * `lockedTargetId` is the soft-or-hard combat lock-on target id (NPC or
 * player). When set, the combat input controller defaults to it instead
 * of letting the server pick nearest-in-range, and the camera frames
 * it. Set to null to release the lock.
 *
 * `aimHitPoint`/`aimHitEntityId` — World Lens ranged-combat wiring.
 * ConcordiaScene owns the THREE.js camera + scene graph, so it's the only
 * component that can raycast from screen-center through the avatars/
 * buildings/terrain layers; it writes the resolved crosshair hit here on a
 * throttled per-frame cadence while a player-tracking camera mode is
 * active. CombatInputController (which has no scene access) reads
 * `aimHitEntityId` as the ranged-attack target override, and
 * AvatarSystem3D's discharge-flash block reads `aimHitPoint` as the
 * projectile tracer's endpoint — same cross-component bridge pattern this
 * module already established for yaw/pitch/lock-on.
 */

export const cameraLookState: {
  yaw: number;
  pitch: number;
  /** Sensitivity in radians per pixel of mouse movement. Tunable via settings. */
  sensitivity: number;
  lockedTargetId: string | null;
  lockedTargetPos: { x: number; y: number; z: number } | null;
  lockMode: 'soft' | 'hard' | null;
  /** Current crosshair (screen-center) raycast hit point in world space, or
   *  a far point along the aim ray when nothing was hit within range. Null
   *  before ConcordiaScene has run its first aim raycast. */
  aimHitPoint: { x: number; y: number; z: number } | null;
  /** avatarId of the NPC/other-player currently under the crosshair, if any. */
  aimHitEntityId: string | null;
} = {
  yaw: 0,
  pitch: 0,
  sensitivity: 0.0025,
  lockedTargetId: null,
  lockedTargetPos: null,
  lockMode: null,
  aimHitPoint: null,
  aimHitEntityId: null,
};

export function resetCameraLook(): void {
  cameraLookState.yaw = 0;
  cameraLookState.pitch = 0;
  cameraLookState.lockedTargetId = null;
  cameraLookState.lockedTargetPos = null;
  cameraLookState.lockMode = null;
}

export function setLockOnTarget(
  id: string | null,
  pos: { x: number; y: number; z: number } | null,
  mode: 'soft' | 'hard' | null = 'soft',
): void {
  cameraLookState.lockedTargetId = id;
  cameraLookState.lockedTargetPos = pos;
  cameraLookState.lockMode = id ? mode : null;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('concordia:lockon-changed', { detail: { id, mode } }));
  }
}

export function clearLockOnTarget(): void {
  setLockOnTarget(null, null, null);
}

