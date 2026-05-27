import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { decorateInterior, type InteriorArchetype } from '@/lib/world-lens/interior-decor';
import { createInstancedMeshPool } from '@/lib/world-lens/instanced-mesh-pool';

describe('decorateInterior', () => {
  it('builds a group for tavern archetype', () => {
    const decor = decorateInterior(THREE, { archetype: 'tavern', seed: 1 });
    expect(decor.group).toBeInstanceOf(THREE.Group);
    expect(decor.propCount()).toBeGreaterThan(0);
    decor.dispose();
  });

  it('builds distinct groups per archetype', () => {
    const archetypes: InteriorArchetype[] = ['tavern', 'archive', 'forge', 'market', 'tower'];
    for (const a of archetypes) {
      const decor = decorateInterior(THREE, { archetype: a, seed: 1 });
      expect(decor.group.name).toBe(`interior-decor-${a}`);
      expect(decor.propCount()).toBeGreaterThan(0);
      decor.dispose();
    }
  });

  it('dispose removes meshes from parent', () => {
    const scene = new THREE.Scene();
    const decor = decorateInterior(THREE, { archetype: 'tavern' });
    scene.add(decor.group);
    expect(scene.children.includes(decor.group)).toBe(true);
    decor.dispose();
    expect(scene.children.includes(decor.group)).toBe(false);
  });

  it('tavern includes a fireplace point light', () => {
    const decor = decorateInterior(THREE, { archetype: 'tavern' });
    let foundLight = false;
    decor.group.traverse((obj) => {
      if (obj instanceof THREE.PointLight) foundLight = true;
    });
    expect(foundLight).toBe(true);
    decor.dispose();
  });

  it('archive has scrolls (multiple meshes)', () => {
    const decor = decorateInterior(THREE, { archetype: 'archive' });
    let meshCount = 0;
    decor.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshCount++;
    });
    expect(meshCount).toBeGreaterThan(20); // 2 shelves × multiple scrolls
    decor.dispose();
  });
});

describe('InstancedMeshPool.cullToCamera', () => {
  it('hides instances outside the frustum', () => {
    const scene = new THREE.Scene();
    const geom = new THREE.BoxGeometry();
    const mat = new THREE.MeshBasicMaterial();
    const pool = createInstancedMeshPool(THREE, scene, geom, mat, 16);
    // Add 4 instances: 2 inside camera view, 2 behind
    pool.add({ position: { x:  0, y: 0, z:  10 } });
    pool.add({ position: { x:  2, y: 0, z:  10 } });
    pool.add({ position: { x:  0, y: 0, z: -10 } });
    pool.add({ position: { x:  2, y: 0, z: -10 } });
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, 10);
    camera.updateMatrixWorld();
    const visible = pool.cullToCamera(camera);
    expect(visible).toBe(2);
    expect(pool.mesh.count).toBe(2);
    pool.dispose();
  });

  it('shows all instances when all are in front', () => {
    const scene = new THREE.Scene();
    const pool = createInstancedMeshPool(
      THREE, scene,
      new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 8,
    );
    pool.add({ position: { x: 0, y: 0, z: 5 } });
    pool.add({ position: { x: 1, y: 0, z: 6 } });
    pool.add({ position: { x: -1, y: 0, z: 7 } });
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, 10);
    camera.updateMatrixWorld();
    const visible = pool.cullToCamera(camera);
    expect(visible).toBe(3);
    pool.dispose();
  });
});
