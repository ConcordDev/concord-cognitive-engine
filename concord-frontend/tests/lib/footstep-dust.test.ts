import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createFootDust, _testing } from '@/lib/world-lens/footstep-dust';

describe('createFootDust', () => {
  let scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
  });

  it('defines dust colors for all 9 terrain materials', () => {
    expect(Object.keys(_testing.DUST_COLORS).length).toBe(9);
  });

  it('starts empty', () => {
    const dust = createFootDust(THREE, scene);
    expect(dust.activeCount()).toBe(0);
    dust.dispose();
  });

  it('spawns a puff and adds it to scene', () => {
    const dust = createFootDust(THREE, scene);
    dust.spawn({ x: 0, y: 0, z: 0 }, 'sand');
    expect(dust.activeCount()).toBe(1);
    expect(scene.children.some((c) => c instanceof THREE.Points)).toBe(true);
    dust.dispose();
  });

  it('uses material-specific color', () => {
    const dust = createFootDust(THREE, scene);
    dust.spawn({ x: 0, y: 0, z: 0 }, 'sand');
    const points = scene.children[scene.children.length - 1] as THREE.Points;
    const mat = points.material as THREE.PointsMaterial;
    expect(mat.color.getHex()).toBe(_testing.DUST_COLORS.sand);
    dust.dispose();
  });

  it('FIFO-evicts at maxConcurrent', () => {
    const dust = createFootDust(THREE, scene, { maxConcurrent: 2 });
    dust.spawn({ x: 0, y: 0, z: 0 }, 'grass');
    dust.spawn({ x: 1, y: 0, z: 0 }, 'sand');
    dust.spawn({ x: 2, y: 0, z: 0 }, 'stone');
    expect(dust.activeCount()).toBe(2);
    dust.dispose();
  });

  it('removes puff after lifetime', () => {
    const dust = createFootDust(THREE, scene);
    const t0 = performance.now() / 1000;
    dust.spawn({ x: 0, y: 0, z: 0 }, 'mud');
    expect(dust.activeCount()).toBe(1);
    dust.tick(t0 + 10);
    expect(dust.activeCount()).toBe(0);
    dust.dispose();
  });

  it('dispose cleans all puffs', () => {
    const dust = createFootDust(THREE, scene);
    dust.spawn({ x: 0, y: 0, z: 0 }, 'grass');
    dust.spawn({ x: 0, y: 0, z: 0 }, 'sand');
    expect(dust.activeCount()).toBe(2);
    dust.dispose();
    expect(dust.activeCount()).toBe(0);
  });

  it('is no-op after dispose', () => {
    const dust = createFootDust(THREE, scene);
    dust.dispose();
    dust.spawn({ x: 0, y: 0, z: 0 }, 'grass');
    expect(dust.activeCount()).toBe(0);
  });
});
