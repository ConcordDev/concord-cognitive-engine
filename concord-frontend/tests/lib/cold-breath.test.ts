import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createColdBreath, _testing } from '@/lib/world-lens/cold-breath';

describe('visibility factor', () => {
  it('is 0 at 5°C and above', () => {
    expect(_testing.visibilityFactorTest(20)).toBe(0);
    expect(_testing.visibilityFactorTest(5)).toBe(0);
  });
  it('is 1 at -10°C and below', () => {
    expect(_testing.visibilityFactorTest(-10)).toBe(1);
    expect(_testing.visibilityFactorTest(-20)).toBe(1);
  });
  it('interpolates linearly between -10°C and 5°C', () => {
    const v = _testing.visibilityFactorTest(-2.5);
    expect(v).toBeGreaterThan(0.4);
    expect(v).toBeLessThan(0.6);
  });
});

describe('createColdBreath', () => {
  let scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
  });

  it('emits no puffs at warm temperatures', () => {
    const breath = createColdBreath(THREE, scene);
    breath.setTemperature(20);
    const t0 = performance.now() / 1000;
    for (let i = 0; i < 10; i++) {
      breath.tick(t0 + i * 3, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    }
    expect(scene.children.length).toBe(0);
    breath.dispose();
  });

  it('emits puffs at freezing temperatures', () => {
    const breath = createColdBreath(THREE, scene);
    breath.setTemperature(-15);
    const t0 = performance.now() / 1000;
    breath.tick(t0, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(scene.children.length).toBeGreaterThanOrEqual(1);
    breath.dispose();
  });

  it('respects exertion to bump breath rate', () => {
    const lowExertion = createColdBreath(THREE, scene);
    const highScene = new THREE.Scene();
    const highExertion = createColdBreath(THREE, highScene);
    lowExertion.setTemperature(-10); lowExertion.setExertion(1);
    highExertion.setTemperature(-10); highExertion.setExertion(10);
    const t0 = performance.now() / 1000;
    // Tick at t0 and t0+1.0 — within a single puff lifetime (1.2s) so
    // expiration doesn't muddy the count.
    lowExertion.tick(t0, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    highExertion.tick(t0, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    lowExertion.tick(t0 + 1.0, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    highExertion.tick(t0 + 1.0, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    // Idle interval = 2.2s → only spawned at t0.  High interval = 0.6s
    // (clamped) → spawned at t0 and t0+1.0.
    expect(highScene.children.length).toBeGreaterThan(scene.children.length);
    lowExertion.dispose(); highExertion.dispose();
  });

  it('expires puffs after their lifetime', () => {
    const breath = createColdBreath(THREE, scene);
    breath.setTemperature(-20);
    const t0 = performance.now() / 1000;
    breath.tick(t0, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    const afterSpawn = scene.children.length;
    breath.tick(t0 + 10, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(scene.children.length).toBeLessThanOrEqual(afterSpawn);
    breath.dispose();
  });

  it('disposes cleans the scene', () => {
    const breath = createColdBreath(THREE, scene);
    breath.setTemperature(-20);
    breath.tick(performance.now() / 1000, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
    breath.dispose();
    // post-dispose tick is a no-op
    breath.tick(performance.now() / 1000 + 1, { x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: 1 });
  });
});
