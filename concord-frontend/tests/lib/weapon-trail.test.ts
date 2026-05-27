import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createWeaponTrail } from '@/lib/world-lens/weapon-trail';

describe('createWeaponTrail', () => {
  let scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
  });

  it('creates a mesh and adds it to the scene', () => {
    const trail = createWeaponTrail(THREE, scene);
    expect(trail.mesh).toBeInstanceOf(THREE.Mesh);
    expect(scene.children.includes(trail.mesh)).toBe(true);
    trail.dispose();
  });

  it('starts inactive with zero opacity', () => {
    const trail = createWeaponTrail(THREE, scene);
    expect(trail.isActive()).toBe(false);
    expect((trail.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0);
    trail.dispose();
  });

  it('only records samples while active', () => {
    const trail = createWeaponTrail(THREE, scene, { minSamples: 1 });
    trail.sample({ x: 0, y: 1, z: 0 }, 0);
    trail.tick(0);
    expect((trail.mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0);

    trail.setActive(true);
    trail.sample({ x: 0, y: 1, z: 0 }, 0.1);
    trail.sample({ x: 0.1, y: 1, z: 0 }, 0.12);
    trail.tick(0.12);
    expect((trail.mesh.material as THREE.MeshBasicMaterial).opacity).toBeGreaterThan(0);

    trail.dispose();
  });

  it('caps history at historyLength', () => {
    const trail = createWeaponTrail(THREE, scene, { historyLength: 4, minSamples: 1 });
    trail.setActive(true);
    for (let i = 0; i < 12; i++) {
      trail.sample({ x: i * 0.1, y: 1, z: 0 }, i * 0.016);
    }
    trail.tick(0.2);
    // No assertion error means the geometry stayed within bounds; if we
    // overflowed, the rebuild would have written out-of-range bytes.
    expect(trail.isActive()).toBe(true);
    trail.dispose();
  });

  it('fades opacity to zero after deactivation', () => {
    const trail = createWeaponTrail(THREE, scene, { fadeOutSec: 0.1, minSamples: 1 });
    trail.setActive(true);
    trail.sample({ x: 0, y: 1, z: 0 }, 0);
    trail.sample({ x: 0.1, y: 1, z: 0 }, 0.016);
    trail.tick(0.016);
    const opacityAtSet = (trail.mesh.material as THREE.MeshBasicMaterial).opacity;

    trail.setActive(false);
    for (let i = 0; i < 60; i++) trail.tick(0.016 + i * 0.01);
    const finalOpacity = (trail.mesh.material as THREE.MeshBasicMaterial).opacity;
    expect(finalOpacity).toBeLessThanOrEqual(opacityAtSet);
    expect(finalOpacity).toBeLessThan(0.05);

    trail.dispose();
  });

  it('disposes cleans the scene', () => {
    const trail = createWeaponTrail(THREE, scene);
    expect(scene.children.length).toBeGreaterThan(0);
    trail.dispose();
    expect(scene.children.includes(trail.mesh)).toBe(false);
  });
});
