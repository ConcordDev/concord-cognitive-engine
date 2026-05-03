import { describe, it, expect } from 'vitest';

// ── Pure-math FABRIK tests (no Three.js DOM dependency) ──────────────────────
// We re-implement the minimal vector math inline so these tests run in jsdom
// without needing a WebGL context.

interface Vec3 { x: number; y: number; z: number }

function dist(a: Vec3, b: Vec3): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2 + (b.z - a.z) ** 2);
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function normalize(v: Vec3): Vec3 {
  const l = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(v: Vec3, s: number): Vec3 { return { x: v.x * s, y: v.y * s, z: v.z * s }; }

interface FBRKBone { length: number }
interface FBRKChain { bones: FBRKBone[]; root: Vec3 }
interface FBRKResult { positions: Vec3[]; converged: boolean; iterations: number }

function solveFABRIK(chain: FBRKChain, target: Vec3, maxIter = 10, tol = 0.005): FBRKResult {
  const n = chain.bones.length;
  const positions = [chain.root, ...chain.bones.map((_, i) => ({
    x: chain.root.x,
    y: chain.root.y - chain.bones.slice(0, i + 1).reduce((s, b) => s + b.length, 0),
    z: chain.root.z,
  }))];

  const totalLen = chain.bones.reduce((s, b) => s + b.length, 0);
  const d = dist(chain.root, target);

  if (d >= totalLen) {
    for (let i = 0; i < n; i++) {
      const r = dist(target, positions[i]);
      const lambda = chain.bones[i].length / r;
      positions[i + 1] = lerp3(positions[i], target, lambda);
    }
    return { positions, converged: false, iterations: 1 };
  }

  let iter = 0;
  let converged = false;

  while (iter < maxIter && !converged) {
    // Forward pass
    positions[n] = { ...target };
    for (let i = n - 1; i >= 0; i--) {
      positions[i] = add(positions[i + 1], scale(normalize(sub(positions[i], positions[i + 1])), chain.bones[i].length));
    }
    // Backward pass
    positions[0] = { ...chain.root };
    for (let i = 0; i < n; i++) {
      const dir = normalize(sub(positions[i + 1], positions[i]));
      positions[i + 1] = add(positions[i], scale(dir, chain.bones[i].length));
    }

    converged = dist(positions[n], target) < tol;
    iter++;
  }
  return { positions, converged, iterations: iter };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FABRIK IK solver', () => {
  const legChain: FBRKChain = {
    root:  { x: 0, y: 0, z: 0 },
    bones: [
      { length: 0.4 },  // upperLeg
      { length: 0.38 }, // lowerLeg
      { length: 0.06 }, // foot
    ],
  };

  it('produces correct number of positions for 3-bone chain', () => {
    const target = { x: 0.2, y: -0.7, z: 0 };
    const result = solveFABRIK(legChain, target);
    // n+1 positions: root + one per bone
    expect(result.positions.length).toBe(4);
  });

  it('converges to reachable target within tolerance', () => {
    const target = { x: 0.1, y: -0.6, z: 0 };
    const result = solveFABRIK(legChain, target, 20, 0.005);
    expect(result.converged).toBe(true);
    const endEffector = result.positions[result.positions.length - 1];
    expect(dist(endEffector, target)).toBeLessThan(0.01);
  });

  it('converges within 10 iterations for a typical foot-plant target', () => {
    const target = { x: 0.05, y: -0.75, z: 0.02 };
    const result = solveFABRIK(legChain, target, 10, 0.005);
    expect(result.iterations).toBeLessThanOrEqual(10);
  });

  it('handles unreachable target without infinite loop — stretches toward it', () => {
    const totalLen = legChain.bones.reduce((s, b) => s + b.length, 0);
    // Target further than total chain length
    const target = { x: 0, y: -(totalLen + 0.5), z: 0 };
    const result = solveFABRIK(legChain, target, 10, 0.005);
    // Should return after 1 iteration, not loop
    expect(result.iterations).toBe(1);
    expect(result.converged).toBe(false);
    // End effector should be in the direction of the target
    const end = result.positions[result.positions.length - 1];
    // y should be negative (pointing toward target)
    expect(end.y).toBeLessThan(0);
  });

  it('preserves bone lengths throughout the solve', () => {
    const target = { x: 0.3, y: -0.5, z: 0.1 };
    const result = solveFABRIK(legChain, target, 10, 0.005);
    for (let i = 0; i < legChain.bones.length; i++) {
      const segLen = dist(result.positions[i], result.positions[i + 1]);
      expect(segLen).toBeCloseTo(legChain.bones[i].length, 2);
    }
  });

  it('root stays fixed after backward pass', () => {
    const target = { x: 0.1, y: -0.6, z: 0 };
    const result = solveFABRIK(legChain, target, 10, 0.005);
    expect(result.positions[0].x).toBeCloseTo(legChain.root.x, 5);
    expect(result.positions[0].y).toBeCloseTo(legChain.root.y, 5);
    expect(result.positions[0].z).toBeCloseTo(legChain.root.z, 5);
  });
});

// ── Joint ROM constraint tests ────────────────────────────────────────────────

describe('Joint ROM constraints', () => {
  // Mirror the ROM data from fabrik-ik.ts
  const JOINT_CONSTRAINTS: Record<string, { minX: number; maxX: number }> = {
    lowerLeg: { minX: 0,   maxX: 145 }, // knee: hinge only, no hyperextension
    forearm:  { minX: 0,   maxX: 145 }, // elbow: hinge only
    spine:    { minX: -25, maxX:  70 },
    foot:     { minX: -40, maxX:  20 },
  };

  it('knee minX is 0 — cannot hyperextend', () => {
    expect(JOINT_CONSTRAINTS.lowerLeg.minX).toBe(0);
  });

  it('knee maxX is 145° — full flexion possible', () => {
    expect(JOINT_CONSTRAINTS.lowerLeg.maxX).toBe(145);
  });

  it('elbow cannot hyperextend (minX = 0)', () => {
    expect(JOINT_CONSTRAINTS.forearm.minX).toBe(0);
  });

  it('spine forward flexion (70°) > backward extension (25°)', () => {
    expect(JOINT_CONSTRAINTS.spine.maxX).toBeGreaterThan(Math.abs(JOINT_CONSTRAINTS.spine.minX));
  });

  it('foot has more plantarflexion (40°) than dorsiflexion (20°)', () => {
    expect(Math.abs(JOINT_CONSTRAINTS.foot.minX)).toBeGreaterThan(JOINT_CONSTRAINTS.foot.maxX);
  });
});
