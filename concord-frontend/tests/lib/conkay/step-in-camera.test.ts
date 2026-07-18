// Phase S2-b — pure movement/look math behind ConKay's "step in" free-cam.
// These are the honest, load-bearing computations (a key press → a metres
// translation; a mouse drag → a clamped look rotation) that the r3f
// StepInControls shell drives via useFrame. Unit-tested here without WebGL.
import { describe, it, expect } from 'vitest';
import {
  stepMoveDelta,
  nextLook,
  lookDirection,
  MAX_PITCH,
} from '@/lib/conkay/step-in-camera';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

describe('stepMoveDelta — walk translation in metres', () => {
  it('forward at yaw=0 moves along -Z, distance = speed*dt', () => {
    const d = stepMoveDelta({ forward: true }, 0, 2, 0.5); // 1 metre
    expect(near(d.dx, 0)).toBe(true);
    expect(near(d.dy, 0)).toBe(true);
    expect(near(d.dz, -1)).toBe(true);
  });

  it('strafe right at yaw=0 moves along +X', () => {
    const d = stepMoveDelta({ right: true }, 0, 2, 0.5);
    expect(near(d.dx, 1)).toBe(true);
    expect(near(d.dz, 0)).toBe(true);
  });

  it('forward at yaw=+90° faces -X (turned left)', () => {
    const d = stepMoveDelta({ forward: true }, Math.PI / 2, 1, 1);
    expect(near(d.dx, -1)).toBe(true);
    expect(near(d.dz, 0)).toBe(true);
  });

  it('opposing keys cancel; vertical is its own axis', () => {
    const flat = stepMoveDelta({ forward: true, back: true }, 0, 5, 1);
    expect(near(flat.dx, 0) && near(flat.dz, 0)).toBe(true);
    const lift = stepMoveDelta({ up: true }, 0, 3, 0.5);
    expect(near(lift.dy, 1.5)).toBe(true);
    const drop = stepMoveDelta({ down: true }, 1.234, 3, 0.5);
    expect(near(drop.dy, -1.5)).toBe(true);
  });

  it('no keys held ⟹ zero delta; negative dt clamps to zero', () => {
    const still = stepMoveDelta({}, 1, 5, 0.2);
    expect(still.dx === 0 && still.dy === 0 && still.dz === 0).toBe(true);
    const back = stepMoveDelta({ forward: true }, 0, 5, -1);
    expect(back.dx === 0 && back.dy === 0 && back.dz === 0).toBe(true);
  });
});

describe('nextLook — drag-look with pitch clamp', () => {
  it('drag right lowers yaw (turns right); drag down lowers pitch (looks down)', () => {
    const r = nextLook(0, 0, 100, 0, 0.01);
    expect(r.yaw).toBeCloseTo(-1, 9);
    const d = nextLook(0, 0, 0, 100, 0.01);
    expect(r.yaw).toBeLessThan(0);
    expect(d.pitch).toBeCloseTo(-1, 9);
  });

  it('pitch never exceeds ±MAX_PITCH no matter how far you drag', () => {
    const up = nextLook(0, 0, 0, -100000, 0.01); // drag up hard
    const down = nextLook(0, 0, 0, 100000, 0.01); // drag down hard
    expect(up.pitch).toBeCloseTo(MAX_PITCH, 9);
    expect(down.pitch).toBeCloseTo(-MAX_PITCH, 9);
    expect(MAX_PITCH).toBeLessThan(Math.PI / 2); // strictly below straight-up
  });
});

describe('lookDirection — unit view vector', () => {
  it('yaw=0,pitch=0 looks toward -Z', () => {
    const v = lookDirection(0, 0);
    expect(near(v.x, 0) && near(v.y, 0) && near(v.z, -1)).toBe(true);
  });

  it('positive pitch lifts the view (y>0); the vector stays unit-length', () => {
    const v = lookDirection(0.7, 0.5);
    expect(v.y).toBeGreaterThan(0);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 9);
  });
});
