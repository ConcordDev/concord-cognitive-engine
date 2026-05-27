import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createBloodDecals } from '@/lib/world-lens/blood-decal';

describe('createBloodDecals', () => {
  let scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
  });

  it('starts empty', () => {
    const decals = createBloodDecals(THREE, scene);
    expect(decals.activeCount()).toBe(0);
    decals.dispose();
  });

  it('spawns a decal as a child of the scene', () => {
    const decals = createBloodDecals(THREE, scene);
    decals.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, 1);
    expect(decals.activeCount()).toBe(1);
    expect(scene.children.some((c) => c instanceof THREE.Mesh)).toBe(true);
    decals.dispose();
  });

  it('FIFO-evicts when capacity is exceeded', () => {
    const decals = createBloodDecals(THREE, scene, { capacity: 3 });
    decals.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    decals.spawn({ x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    decals.spawn({ x: 2, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    decals.spawn({ x: 3, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(decals.activeCount()).toBe(3);
    decals.dispose();
  });

  it('removes a decal after its lifetime expires', () => {
    const decals = createBloodDecals(THREE, scene, { lifetimeSec: 0.1 });
    const t0 = performance.now() / 1000;
    decals.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(decals.activeCount()).toBe(1);
    decals.tick(t0 + 10);
    expect(decals.activeCount()).toBe(0);
    decals.dispose();
  });

  it('fades opacity in the second half of lifetime', () => {
    // lifetime baseline is jittered ±15% per spawn; pick lifetimeSec = 10 so
    // both ticks land well inside the alive window regardless of jitter.
    const decals = createBloodDecals(THREE, scene, { lifetimeSec: 10 });
    const t0 = performance.now() / 1000;
    decals.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    const earlyMesh = scene.children[scene.children.length - 1] as THREE.Mesh;
    decals.tick(t0 + 0.1);
    const earlyOpacity = (earlyMesh.material as THREE.MeshBasicMaterial).opacity;
    decals.tick(t0 + 8.0);
    const lateOpacity = (earlyMesh.material as THREE.MeshBasicMaterial).opacity;
    expect(lateOpacity).toBeLessThan(earlyOpacity);
    decals.dispose();
  });

  it('orients to surface normal', () => {
    const decals = createBloodDecals(THREE, scene);
    decals.spawn({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    const mesh = scene.children[scene.children.length - 1] as THREE.Mesh;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
    // Decal's "forward" axis should align with the normal direction
    expect(Math.abs(forward.y)).toBeGreaterThan(0.95);
    decals.dispose();
  });

  it('dispose clears all decals from scene', () => {
    const decals = createBloodDecals(THREE, scene);
    decals.spawn({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    decals.spawn({ x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(decals.activeCount()).toBe(2);
    decals.dispose();
    expect(decals.activeCount()).toBe(0);
  });
});
