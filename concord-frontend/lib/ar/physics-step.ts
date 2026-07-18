/**
 * AR Scene Studio — deterministic physics-simulation step function.
 *
 * `server/domains/ar.js#sceneSave` persists a real, user-authored
 * `physics{enabled,body,mass,restitution}` field per scene object (mig
 * 332), but nothing in the viewport ever advanced it — the scene rendered
 * static forever (see `docs/lens-specs/ar-capability-map.md` row 4).
 *
 * This module is the pure integration math for a fixed-timestep,
 * gravity-driven physics *simulation* of those already-persisted params.
 * It is intentionally isolated from React/`@react-three/fiber` so it can
 * be unit-tested without a DOM or a WebGL context.
 *
 * Honesty properties (see CLAUDE.md "honest by construction"):
 *  - This is a SIMULATION, not a physical measurement — every consumer
 *    surface must label it as such.
 *  - No pseudo-random number generation anywhere in the step, and no
 *    wall-clock reads inside the integration itself (the caller supplies
 *    `dt`). Same (body, dt, gravity) always produces the same next body —
 *    bit-for-bit deterministic, which is the honesty guarantee: an
 *    identical authored scene always simulates the identical trajectory.
 *  - Only bodies the caller marks eligible (physics.enabled === true AND
 *    physics.body === 'dynamic') are ever advanced. Static and kinematic
 *    bodies pass through `stepBody` completely unchanged — this module
 *    never invents motion for data the author didn't opt into simulating.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PhysicsBodyType = 'static' | 'dynamic' | 'kinematic';

export interface PhysicsBody {
  /** Scene-object id this body mirrors — carried through untouched. */
  id: string;
  position: Vec3;
  velocity: Vec3;
  /** Authored `physics.mass` (kg-equivalent, informational — see note below). */
  mass: number;
  /** Authored `physics.restitution`, clamped [0, 1] by the caller/server. */
  restitution: number;
  /** Authored `physics.body`. Only 'dynamic' bodies are advanced by gravity. */
  bodyType: PhysicsBodyType;
  /**
   * Half-extent of the object's AABB along Y (world units), derived from
   * the authored scale. Ground contact is tested against this, not a
   * point, so a tall object's *base* touches the floor, not its center.
   */
  halfHeight: number;
}

/** Standard Earth gravity magnitude, applied along -Y (m/s^2). */
export const DEFAULT_GRAVITY = -9.81;

/** The AR anchor plane SceneStudio's viewport already draws at y=0. */
export const GROUND_Y = 0;

/** Fixed simulation timestep (60Hz) — the accumulator always steps by this. */
export const DEFAULT_FIXED_DT = 1 / 60;

/**
 * Absolute floor (m/s) below which a bounce is always treated as resting
 * contact — a backstop for very small dt/gravity combinations where the
 * dt-scaled threshold below would otherwise round to ~0.
 */
export const MIN_BOUNCE_VELOCITY = 0.02;

/**
 * Safety margin (unitless, >0.5) used to derive the dt-scaled resting
 * threshold below. Analytically load-bearing — see `restVelocityThreshold`.
 */
const REST_FIXED_POINT_MARGIN = 0.6;

/**
 * The discrete "integrate → clamp-to-floor → reflect" loop this module
 * uses (no continuous contact/normal-force solve) has a real numerical
 * property: for a body resting exactly at the floor, one frame of gravity
 * injects a downward impulse of magnitude `dv = |gravity| * dt`; reflecting
 * that through restitution `r` and repeating settles to a STABLE, NONZERO
 * fixed point at `v* = r * dv / (1 + r)`, which is strictly less than
 * `dv / 2` for every `r` in `[0, 1)` (and equals `dv / 2` exactly at the
 * perfectly-elastic edge case `r = 1`). A flat, dt-independent bounce
 * threshold can therefore sit BELOW that fixed point for some `(dt,
 * restitution)` combination and the body would oscillate forever at a
 * small but never-zero velocity instead of settling — this was caught by
 * `tests/lib/ar-physics-step.test.ts`'s settling test before shipping.
 * Scaling the threshold by `REST_FIXED_POINT_MARGIN * dv` (with
 * `REST_FIXED_POINT_MARGIN > 0.5`) provably exceeds `v*` for every
 * restitution in `[0, 1]` at whatever dt the caller actually uses, so a
 * resting body always reaches exact zero in finite time.
 */
function restVelocityThreshold(dt: number, gravity: number): number {
  return Math.max(MIN_BOUNCE_VELOCITY, Math.abs(gravity) * dt * REST_FIXED_POINT_MARGIN);
}

/**
 * Advance one dynamic body by one fixed timestep using semi-implicit
 * (symplectic) Euler integration: velocity is updated from acceleration
 * first, then position is updated from the NEW velocity. Symplectic Euler
 * is unconditionally more energy-stable than explicit Euler for
 * oscillating/bouncing systems at a fixed dt, which matters here because
 * restitution bounces are exactly that.
 *
 * Note on mass: under uniform gravity, acceleration is mass-independent
 * (Galileo — a 1kg and a 1000kg object in free fall accelerate
 * identically), so `mass` does not change this body's own trajectory. It
 * is still read and carried through `PhysicsBody` because it is real
 * authored data (used for e.g. momentum/energy readouts and would gate
 * any future body-to-body collision response); not using it to bend
 * free-fall would be *incorrect* physics, not a shortcut.
 *
 * Pure function — no randomness, no wall-clock reads, no closed-over
 * mutable state. `stepBody(b, dt, g)` is byte-identical for byte-identical
 * inputs, which is the module's determinism contract.
 */
export function stepBody(body: PhysicsBody, dt: number, gravity: number = DEFAULT_GRAVITY): PhysicsBody {
  if (body.bodyType !== 'dynamic') {
    // Static bodies never move. Kinematic bodies are (in a full engine)
    // driven by an authored path/animation this data model doesn't carry
    // yet — leaving them untouched is the honest choice: inventing a
    // trajectory nobody authored would be exactly the fabrication
    // CLAUDE.md forbids.
    return body;
  }

  const floorY = GROUND_Y + body.halfHeight;

  // Resting-contact short-circuit: a real physics engine holds a resting
  // body up with a continuous normal force that exactly cancels gravity.
  // A naive per-step "integrate then clamp" loop has no such force, so a
  // body sitting exactly at the floor with ~zero velocity would otherwise
  // re-accelerate downward every single frame and re-trigger a tiny
  // restitution bounce forever, never actually reaching zero. Skipping
  // integration for a frame that starts already-at-rest is the standard,
  // honest stand-in for that normal force — it does not add motion, it
  // suppresses the ground itself from re-injecting it.
  const alreadyResting = body.position.y <= floorY + 1e-9
    && Math.abs(body.velocity.y) < restVelocityThreshold(dt, gravity);
  if (alreadyResting) {
    return {
      ...body,
      position: { ...body.position, y: floorY },
      velocity: { ...body.velocity, y: 0 },
    };
  }

  // 1) integrate velocity under gravity.
  const vx = body.velocity.x;
  let vy = body.velocity.y + gravity * dt;
  const vz = body.velocity.z;

  // 2) integrate position from the UPDATED velocity (semi-implicit Euler).
  const x = body.position.x + vx * dt;
  let y = body.position.y + vy * dt;
  const z = body.position.z + vz * dt;

  // 3) ground contact, tested against the body's AABB (its half-height),
  // not a point — the object's base rests on y=0, not its origin.
  if (y <= floorY) {
    y = floorY;
    if (vy < 0) {
      const rebound = -vy * body.restitution;
      vy = rebound < restVelocityThreshold(dt, gravity) ? 0 : rebound;
    }
  }

  return {
    ...body,
    position: { x, y, z },
    velocity: { x: vx, y: vy, z: vz },
  };
}

/** Advance every body in a scene by one fixed timestep. Pure, order-independent. */
export function stepScene(bodies: PhysicsBody[], dt: number, gravity: number = DEFAULT_GRAVITY): PhysicsBody[] {
  return bodies.map((b) => stepBody(b, dt, gravity));
}

/**
 * Bounding-box half-extent along Y for a scene object's authored scale.
 * SceneStudio's primitives (box/sphere/cone/cylinder/torus) are all
 * unit-sized (radius/half-extent 0.5) before the authored `scale` is
 * applied, so half-height = scale.y * 0.5. Floored so a zero/negative
 * scale never collapses ground contact to a divide-by-zero-adjacent case.
 */
export function halfHeightFromScale(scaleY: number): number {
  return Math.max(0.05, (Number.isFinite(scaleY) ? scaleY : 1) * 0.5);
}

/**
 * Build the initial simulation body for a scene object. Velocity always
 * starts at rest (0,0,0) — the authored scene has no velocity field, so
 * "at rest at the authored position" is the only honest starting state.
 */
export function initPhysicsBody(obj: {
  id: string;
  position: Vec3;
  scale: Vec3;
  physics: { enabled: boolean; body: string; mass: number; restitution: number };
}): PhysicsBody {
  return {
    id: obj.id,
    position: { ...obj.position },
    velocity: { x: 0, y: 0, z: 0 },
    mass: obj.physics.mass,
    restitution: obj.physics.restitution,
    bodyType: obj.physics.enabled ? (obj.physics.body as PhysicsBodyType) : 'static',
    halfHeight: halfHeightFromScale(obj.scale?.y ?? 1),
  };
}
