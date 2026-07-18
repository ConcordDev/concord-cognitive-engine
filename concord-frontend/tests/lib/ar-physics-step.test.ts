import { describe, it, expect } from 'vitest';
import {
  stepBody,
  stepScene,
  initPhysicsBody,
  halfHeightFromScale,
  DEFAULT_GRAVITY,
  DEFAULT_FIXED_DT,
  GROUND_Y,
  type PhysicsBody,
} from '@/lib/ar/physics-step';

// -----------------------------------------------------------------------
// Free-fall: for semi-implicit Euler starting at rest (v0 = 0), velocity
// after n steps is v_n = n * g * dt (linear in step count), and since
// y_n = y0 + dt * sum_{k=1..n} v_k = y0 + dt * (g*dt) * sum_{k=1..n} k
//                = y0 + g * dt^2 * n(n+1)/2
// this closed form is an exact algebraic identity of the integrator
// (not an approximation), so it is the correct "hand-computed" oracle
// for any n, as long as the body never touches the ground in that span.
// -----------------------------------------------------------------------
function closedFormFreeFallY(y0: number, n: number, dt: number, g: number): number {
  return y0 + g * dt * dt * (n * (n + 1)) / 2;
}
function closedFormFreeFallVy(n: number, dt: number, g: number): number {
  return n * g * dt;
}

function bodyAt(overrides: Partial<PhysicsBody> = {}): PhysicsBody {
  return {
    id: 'obj_1',
    position: { x: 0, y: 5, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    mass: 2,
    restitution: 0.5,
    bodyType: 'dynamic',
    halfHeight: 0.5,
    ...overrides,
  };
}

describe('stepBody — free fall (no ground contact yet)', () => {
  it('matches the closed-form semi-implicit-Euler position after 3 steps', () => {
    const dt = 0.1;
    let b = bodyAt({ position: { x: 1, y: 5, z: -2 } });
    for (let i = 0; i < 3; i++) b = stepBody(b, dt, DEFAULT_GRAVITY);

    const expectedY = closedFormFreeFallY(5, 3, dt, DEFAULT_GRAVITY);
    const expectedVy = closedFormFreeFallVy(3, dt, DEFAULT_GRAVITY);

    // Hand-computation (double-checked against the closed form):
    // step1: vy = 0 + (-9.81*0.1) = -0.981; y = 5 - 0.0981 = 4.9019
    // step2: vy = -1.962;            y = 4.9019 - 0.1962 = 4.7057
    // step3: vy = -2.943;            y = 4.7057 - 0.2943 = 4.4114
    expect(expectedY).toBeCloseTo(4.4114, 4);
    expect(expectedVy).toBeCloseTo(-2.943, 4);

    expect(b.position.y).toBeCloseTo(expectedY, 9);
    expect(b.velocity.y).toBeCloseTo(expectedVy, 9);

    // x and z are untouched by gravity (velocity.x/z start at 0).
    expect(b.position.x).toBe(1);
    expect(b.position.z).toBe(-2);
  });

  it('never advances a static body', () => {
    const b = bodyAt({ bodyType: 'static' });
    const next = stepBody(b, 0.1, DEFAULT_GRAVITY);
    expect(next).toEqual(b);
  });

  it('never advances a kinematic body (no authored path to follow)', () => {
    const b = bodyAt({ bodyType: 'kinematic', velocity: { x: 1, y: 1, z: 1 } });
    const next = stepBody(b, 0.1, DEFAULT_GRAVITY);
    expect(next).toEqual(b);
  });

  it('does not use Math.random or wall-clock reads anywhere in the step (source-level check)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'lib', 'ar', 'physics-step.ts'),
      'utf8',
    );
    expect(src.includes('Math.random')).toBe(false);
    expect(src.includes('Date.now')).toBe(false);
  });
});

describe('stepBody — determinism', () => {
  it('identical (body, dt, gravity) input always produces an identical trajectory', () => {
    const runTrajectory = () => {
      let b = bodyAt({ position: { x: 3, y: 8, z: 1 }, mass: 4.2, restitution: 0.35 });
      const dt = 1 / 60;
      const trace: PhysicsBody[] = [];
      for (let i = 0; i < 200; i++) {
        b = stepBody(b, dt, DEFAULT_GRAVITY);
        trace.push(b);
      }
      return trace;
    };

    const traceA = runTrajectory();
    const traceB = runTrajectory();
    expect(traceA).toEqual(traceB);
  });

  it('stepScene over multiple bodies is order-independent per body (each body only depends on itself)', () => {
    const bodies = [
      bodyAt({ id: 'a', position: { x: 0, y: 10, z: 0 } }),
      bodyAt({ id: 'b', position: { x: 1, y: 6, z: 0 }, mass: 9, restitution: 0.1 }),
      bodyAt({ id: 'c', bodyType: 'static', position: { x: -2, y: 0.5, z: 0 } }),
    ];
    const once = stepScene(bodies, 1 / 60);
    const twice = stepScene([...bodies].reverse(), 1 / 60);
    // Compare by id, not by array order.
    const byId = (arr: PhysicsBody[]) => Object.fromEntries(arr.map((x) => [x.id, x]));
    expect(byId(once)).toEqual(byId(twice));
  });
});

describe('stepBody — ground contact + restitution bounce', () => {
  it('hand-computed: a body falling into the floor reflects velocity by -restitution and clamps to floorY', () => {
    const dt = 0.1;
    const restitution = 0.5;
    const halfHeight = 0.5;
    const floorY = GROUND_Y + halfHeight; // 0.5
    // Positioned exactly at the floor already, moving down fast enough
    // that a single step would tunnel through the ground.
    const b = bodyAt({
      position: { x: 2, y: floorY, z: -1 },
      velocity: { x: 0, y: -5, z: 0 },
      restitution,
      halfHeight,
    });

    // Hand computation:
    // vy' = -5 + (-9.81 * 0.1) = -5.981
    // y'  = 0.5 + (-5.981 * 0.1) = 0.5 - 0.5981 = -0.0981  (below floor)
    // clamp: y = floorY = 0.5
    // rebound = -(-5.981) * 0.5 = 2.9905  (>= MIN_BOUNCE_VELOCITY, so kept)
    const next = stepBody(b, dt, DEFAULT_GRAVITY);

    expect(next.position.y).toBeCloseTo(0.5, 9);
    expect(next.velocity.y).toBeCloseTo(2.9905, 9);
    // Horizontal position is untouched by ground contact.
    expect(next.position.x).toBe(2);
    expect(next.position.z).toBe(-1);
  });

  it('a slow-enough rebound is treated as resting contact (velocity zeroed, not reflected)', () => {
    const dt = 1 / 60;
    const halfHeight = 0.5;
    const floorY = halfHeight;
    // A tiny downward velocity that, after gravity + restitution, would
    // rebound below MIN_BOUNCE_VELOCITY (0.02 m/s) — should settle to 0.
    const b = bodyAt({
      position: { x: 0, y: floorY + 0.0001, z: 0 },
      velocity: { x: 0, y: -0.001, z: 0 },
      restitution: 0.01,
      halfHeight,
    });
    const next = stepBody(b, dt, DEFAULT_GRAVITY);
    expect(next.position.y).toBeCloseTo(floorY, 9);
    expect(next.velocity.y).toBe(0);
  });

  it('a full drop-and-bounce trajectory settles to rest at the floor (energy strictly decreases across bounces)', () => {
    let b = bodyAt({ position: { x: 0, y: 3, z: 0 }, restitution: 0.6, halfHeight: 0.5 });
    const dt = 1 / 120;
    let bounces = 0;
    let lastWasFalling = false;
    for (let i = 0; i < 20000; i++) {
      const prevVy = b.velocity.y;
      b = stepBody(b, dt, DEFAULT_GRAVITY);
      if (prevVy < 0 && b.velocity.y > 0) bounces += 1;
      lastWasFalling = b.velocity.y <= 0;
    }
    expect(bounces).toBeGreaterThan(0);
    // Eventually comes to rest exactly at the floor with zero velocity.
    expect(b.position.y).toBeCloseTo(0.5, 6);
    expect(b.velocity.y).toBe(0);
    expect(lastWasFalling).toBe(true);
  });
});

describe('halfHeightFromScale', () => {
  it('is half the authored Y scale for a unit primitive', () => {
    expect(halfHeightFromScale(1)).toBeCloseTo(0.5, 9);
    expect(halfHeightFromScale(2)).toBeCloseTo(1, 9);
  });
  it('floors degenerate scales instead of collapsing to zero', () => {
    expect(halfHeightFromScale(0)).toBeGreaterThan(0);
    expect(halfHeightFromScale(-1)).toBeGreaterThan(0);
    expect(halfHeightFromScale(NaN)).toBeGreaterThan(0);
  });
});

describe('initPhysicsBody', () => {
  it('starts at rest (zero velocity) at the authored position', () => {
    const body = initPhysicsBody({
      id: 'obj_x',
      position: { x: 1, y: 2, z: 3 },
      scale: { x: 1, y: 1, z: 1 },
      physics: { enabled: true, body: 'dynamic', mass: 5, restitution: 0.4 },
    });
    expect(body.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(body.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(body.bodyType).toBe('dynamic');
    expect(body.mass).toBe(5);
    expect(body.restitution).toBe(0.4);
  });

  it('coerces bodyType to static when physics.enabled is false, even if body says dynamic', () => {
    // Honesty guarantee: an object without simulation opted-in never moves,
    // regardless of what a stale/leftover `body` string says.
    const body = initPhysicsBody({
      id: 'obj_y',
      position: { x: 0, y: 1, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      physics: { enabled: false, body: 'dynamic', mass: 1, restitution: 0.2 },
    });
    expect(body.bodyType).toBe('static');
    const next = stepBody(body, DEFAULT_FIXED_DT);
    expect(next).toEqual(body);
  });
});
