/**
 * Client-side vehicle kinematics.
 *
 * Three vehicle classes with distinct flight envelopes:
 *   car    — ground-bound, max 40 m/s, gravity active
 *   glider — slow descent + lift on speed, max 60 m/s
 *   plane  — full 3DOF flight, max 150 m/s, throttle/pitch/roll
 *
 * Predicts client-side and reports pose to the server via
 * /api/vehicles/:id/pose. The server clamps player speed via city-presence
 * based on vehicleType (set at mount time), so a forged client cannot move
 * faster than its declared class.
 *
 * Rapier integration is intentionally NOT done here — the lib/world-lens/
 * physics-world.ts scaffold is currently dead code and bringing it in
 * requires collision tuning across all existing world geometry. This module
 * uses simple kinematic interpolation that doesn't need a physics world.
 */

export type VehicleType = "car" | "glider" | "plane";

export interface VehicleSpec {
  maxSpeed: number;       // m/s (client cap; server has its own)
  acceleration: number;   // m/s²
  turnRate: number;       // rad/s
  pitchRate?: number;     // rad/s (planes/gliders only)
  hasGravity: boolean;
  liftPerSpeedSquared?: number; // gliders/planes
}

export const VEHICLE_SPECS: Record<VehicleType, VehicleSpec> = {
  car:    { maxSpeed: 40,  acceleration: 8,  turnRate: 1.2, hasGravity: true },
  glider: { maxSpeed: 60,  acceleration: 4,  turnRate: 0.8, pitchRate: 0.5, hasGravity: true,  liftPerSpeedSquared: 0.012 },
  plane:  { maxSpeed: 150, acceleration: 15, turnRate: 1.0, pitchRate: 0.7, hasGravity: false, liftPerSpeedSquared: 0.025 },
};

export interface VehiclePose {
  x: number; y: number; z: number;
  rx: number; ry: number; rz: number;
  vx: number; vy: number; vz: number;
}

export interface VehicleInputs {
  throttle: number;   // [-1, 1]
  steer: number;      // [-1, 1]
  pitch?: number;     // [-1, 1] (gliders/planes)
  brake?: boolean;
}

const GRAVITY = 9.81;

/**
 * One step of vehicle kinematics. Does not own state — caller passes pose +
 * inputs and receives the next pose. Pure function; safe to memoize.
 */
export function stepVehicle(
  type: VehicleType,
  pose: VehiclePose,
  inputs: VehicleInputs,
  dt: number,
): VehiclePose {
  const spec = VEHICLE_SPECS[type];
  const next: VehiclePose = { ...pose };

  // Heading update from steer
  next.ry = pose.ry + inputs.steer * spec.turnRate * dt;

  // Pitch update for aerial vehicles
  if (spec.pitchRate && typeof inputs.pitch === "number") {
    next.rx = clamp(pose.rx + inputs.pitch * spec.pitchRate * dt, -Math.PI / 3, Math.PI / 3);
  }

  // Forward direction in world space
  const fx = Math.sin(next.ry) * Math.cos(next.rx);
  const fy = -Math.sin(next.rx);
  const fz = Math.cos(next.ry) * Math.cos(next.rx);

  // Apply throttle as longitudinal acceleration along forward vector.
  const accel = (inputs.brake ? -spec.acceleration * 1.5 : inputs.throttle * spec.acceleration);
  next.vx = pose.vx + fx * accel * dt;
  next.vy = pose.vy + fy * accel * dt;
  next.vz = pose.vz + fz * accel * dt;

  // Apply lift for gliders / planes — simple v² formula
  if (spec.liftPerSpeedSquared) {
    const speedSq = next.vx * next.vx + next.vy * next.vy + next.vz * next.vz;
    next.vy += spec.liftPerSpeedSquared * speedSq * Math.cos(next.rx) * dt;
  }

  // Gravity
  if (spec.hasGravity) {
    next.vy -= GRAVITY * dt;
  }

  // Cap speed to max
  const speed = Math.hypot(next.vx, next.vy, next.vz);
  if (speed > spec.maxSpeed) {
    const k = spec.maxSpeed / speed;
    next.vx *= k; next.vy *= k; next.vz *= k;
  }

  // Integrate position
  next.x = pose.x + next.vx * dt;
  next.y = pose.y + next.vy * dt;
  next.z = pose.z + next.vz * dt;

  // Ground clamp for car/glider
  if (spec.hasGravity && next.y < 0) {
    next.y = 0;
    if (next.vy < 0) next.vy = 0;
  }

  return next;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function emptyPose(): VehiclePose {
  return { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, vx: 0, vy: 0, vz: 0 };
}

/**
 * Wave 7b — the driver-loop primitive. Wraps the (previously dead-code) pure
 * stepVehicle kinematics into a stateful controller the input layer drives and
 * the renderer reads: `setInputs` from the keyboard, `tick(dt)` to integrate,
 * `getPose()` for the mesh, `syncTo(fn)` to push pose to the server
 * (world-vehicles.moveVehicle) on a throttle. The live keyboard binding +
 * mounted-state gating is the chair-tuned integration; this is the engine.
 */
export interface VehicleController {
  setInputs(i: Partial<VehicleInputs>): void;
  tick(dt: number): VehiclePose;
  getPose(): VehiclePose;
  reset(pose?: Partial<VehiclePose>): void;
}

export function createVehicleController(type: VehicleType, start?: Partial<VehiclePose>): VehicleController {
  let pose: VehiclePose = { ...emptyPose(), ...start };
  let inputs: VehicleInputs = { throttle: 0, steer: 0, pitch: 0, brake: false };
  return {
    setInputs(i) { inputs = { ...inputs, ...i }; },
    tick(dt) { pose = stepVehicle(type, pose, inputs, dt); return pose; },
    getPose() { return pose; },
    reset(p) { pose = { ...emptyPose(), ...p }; },
  };
}
