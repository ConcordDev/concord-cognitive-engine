// lib/conkay/step-in-camera.ts
//
// Phase S2-b — the pure math behind the ConKay "step in" free-cam: the
// orbit → walk-at-real-scale affordance on inspectable artifacts. The r3f
// control component (StepInControls) is a thin shell around these functions;
// the honest, load-bearing part — where a key press becomes a world-space
// translation, and a mouse drag becomes a look rotation — lives here so it is
// directly unit-testable without a WebGL context.
//
// Convention (matches three.js): yaw is rotation about +Y with yaw=0 looking
// toward -Z; pitch is rotation about the local X (look up = +). A yaw-only
// horizontal basis keeps "forward" level with the ground (you walk, you don't
// fly into the floor when looking down) — vertical motion is its own axis.

/** Which movement keys are currently held. All optional (default false). */
export interface StepInKeys {
  forward?: boolean;
  back?: boolean;
  left?: boolean;
  right?: boolean;
  up?: boolean;
  down?: boolean;
}

/** Largest pitch magnitude (radians) — just under ±90° so the view never flips. */
export const MAX_PITCH = (85 * Math.PI) / 180;

/**
 * World-space translation for one frame of walk-cam movement.
 *
 * Forward/back + strafe move along the yaw-rotated HORIZONTAL basis (so looking
 * up/down never changes where "forward" goes); up/down move along world +Y.
 * Distance scales with `speedMps * dt`, i.e. metres — "real scale" is honest
 * because the artifact geometry is already in real units.
 *
 * @returns `{ dx, dy, dz }` metres to add to the camera position this frame.
 */
export function stepMoveDelta(
  keys: StepInKeys,
  yawRad: number,
  speedMps: number,
  dt: number,
): { dx: number; dy: number; dz: number } {
  const step = speedMps * Math.max(0, dt);
  const fwd = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
  const strafe = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const lift = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);

  // Horizontal forward = rotateY(yaw) · (0,0,-1) = (-sin, 0, -cos).
  const fx = -Math.sin(yawRad);
  const fz = -Math.cos(yawRad);
  // Right = cross(forward, up) = (cos, 0, -sin).
  const rx = Math.cos(yawRad);
  const rz = -Math.sin(yawRad);

  return {
    dx: step * (fwd * fx + strafe * rx),
    dy: step * lift,
    dz: step * (fwd * fz + strafe * rz),
  };
}

/**
 * Apply a mouse-drag delta (pixels) to the current look angles.
 * Dragging right turns right (yaw decreases); dragging down looks down (pitch
 * decreases). Pitch is clamped to ±MAX_PITCH so the camera can't invert.
 *
 * @returns the new `{ yaw, pitch }` (radians). Yaw is unwrapped (caller may mod).
 */
export function nextLook(
  yaw: number,
  pitch: number,
  dxPixels: number,
  dyPixels: number,
  sensitivity: number,
): { yaw: number; pitch: number } {
  const nextYaw = yaw - dxPixels * sensitivity;
  const nextPitch = clamp(pitch - dyPixels * sensitivity, -MAX_PITCH, MAX_PITCH);
  return { yaw: nextYaw, pitch: nextPitch };
}

/** The unit look direction for a given yaw/pitch (three.js convention). */
export function lookDirection(yaw: number, pitch: number): { x: number; y: number; z: number } {
  const cp = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
