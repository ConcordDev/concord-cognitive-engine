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
 */

export const cameraLookState: {
  yaw: number;
  pitch: number;
  /** Sensitivity in radians per pixel of mouse movement. Tunable via settings. */
  sensitivity: number;
  lockedTargetId: string | null;
  lockedTargetPos: { x: number; y: number; z: number } | null;
  lockMode: 'soft' | 'hard' | null;
} = {
  yaw: 0,
  pitch: 0,
  sensitivity: 0.0025,
  lockedTargetId: null,
  lockedTargetPos: null,
  lockMode: null,
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

