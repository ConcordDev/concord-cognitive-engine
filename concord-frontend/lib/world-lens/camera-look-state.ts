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
 */

export const cameraLookState: {
  yaw: number;
  pitch: number;
  /** Sensitivity in radians per pixel of mouse movement. Tunable via settings. */
  sensitivity: number;
} = {
  yaw: 0,
  pitch: 0,
  sensitivity: 0.0025,
};

export function resetCameraLook(): void {
  cameraLookState.yaw = 0;
  cameraLookState.pitch = 0;
}
