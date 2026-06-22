import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createElementVfx, _testing } from '@/lib/world-lens/element-vfx';

describe('createElementVfx', () => {
  let scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
  });

  it('registers all eight element kinds', () => {
    expect(Object.keys(_testing.SPECS).sort()).toEqual(
      ['bleed', 'energy', 'fire', 'ice', 'lightning', 'physical', 'poison', 'water'].sort(),
    );
  });

  it('spawns a Points object per burst', () => {
    const vfx = createElementVfx(THREE, scene);
    expect(vfx.activeCount()).toBe(0);
    vfx.spawn('fire', { x: 0, y: 0, z: 0 });
    expect(vfx.activeCount()).toBe(1);
    expect(scene.children.some((c) => c instanceof THREE.Points)).toBe(true);
    vfx.dispose();
  });

  it('removes a burst once its lifetime expires', () => {
    const vfx = createElementVfx(THREE, scene);
    const t0 = performance.now() / 1000;
    vfx.spawn('lightning', { x: 0, y: 1, z: 0 });
    expect(vfx.activeCount()).toBe(1);
    vfx.tick(t0 + 100);
    expect(vfx.activeCount()).toBe(0);
    vfx.dispose();
  });

  it('respects maxConcurrent and evicts oldest burst', () => {
    const vfx = createElementVfx(THREE, scene, { maxConcurrent: 3 });
    vfx.spawn('fire', { x: 0, y: 0, z: 0 });
    vfx.spawn('ice', { x: 1, y: 0, z: 0 });
    vfx.spawn('water', { x: 2, y: 0, z: 0 });
    vfx.spawn('poison', { x: 3, y: 0, z: 0 });
    expect(vfx.activeCount()).toBe(3);
    vfx.dispose();
  });

  it('assigns distinct colors per element', () => {
    const seen = new Set<number>();
    for (const key of Object.keys(_testing.SPECS) as Array<keyof typeof _testing.SPECS>) {
      seen.add(_testing.SPECS[key].color);
    }
    expect(seen.size).toBe(8);
  });

  it('uses additive blending for fire, lightning, water, energy', () => {
    expect(_testing.SPECS.fire.blending).toBe('additive');
    expect(_testing.SPECS.lightning.blending).toBe('additive');
    expect(_testing.SPECS.water.blending).toBe('additive');
    expect(_testing.SPECS.energy.blending).toBe('additive');
    expect(_testing.SPECS.ice.blending).toBe('normal');
    expect(_testing.SPECS.poison.blending).toBe('normal');
    expect(_testing.SPECS.physical.blending).toBe('normal');
  });

  it('fades opacity over the burst lifetime', () => {
    const vfx = createElementVfx(THREE, scene);
    const t0 = performance.now() / 1000;
    vfx.spawn('fire', { x: 0, y: 0, z: 0 });
    vfx.tick(t0 + 0.01);
    const burst = scene.children[scene.children.length - 1] as THREE.Points;
    const matEarly = burst.material as THREE.PointsMaterial;
    const earlyOpacity = matEarly.opacity;
    vfx.tick(t0 + 0.45);
    const matLate = burst.material as THREE.PointsMaterial;
    const lateOpacity = matLate.opacity;
    expect(earlyOpacity).toBeGreaterThanOrEqual(lateOpacity);
    vfx.dispose();
  });

  it('disposes cleans the scene', () => {
    const vfx = createElementVfx(THREE, scene);
    vfx.spawn('fire', { x: 0, y: 0, z: 0 });
    vfx.spawn('ice', { x: 0, y: 0, z: 0 });
    const beforeChildren = scene.children.length;
    vfx.dispose();
    expect(scene.children.length).toBeLessThan(beforeChildren);
    expect(vfx.activeCount()).toBe(0);
  });

  it('is no-op after dispose', () => {
    const vfx = createElementVfx(THREE, scene);
    vfx.dispose();
    vfx.spawn('fire', { x: 0, y: 0, z: 0 });
    expect(vfx.activeCount()).toBe(0);
  });
});
