import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createProjectileTracerSystem } from '@/lib/world-lens/projectile-tracer';

describe('createProjectileTracerSystem', () => {
  let scene: THREE.Scene;

  beforeEach(() => {
    scene = new THREE.Scene();
  });

  it('pre-allocates a pool of invisible lines added to the scene', () => {
    const sys = createProjectileTracerSystem(THREE, scene, { poolSize: 4 });
    expect(scene.children.length).toBe(4);
    for (const child of scene.children) {
      expect(child).toBeInstanceOf(THREE.Line);
      expect(child.visible).toBe(false);
    }
    sys.dispose();
  });

  it('fire() sets the line endpoints and makes it visible at full opacity', () => {
    const sys = createProjectileTracerSystem(THREE, scene, { poolSize: 2 });
    sys.fire({ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 });
    const line = scene.children[0] as THREE.Line;
    expect(line.visible).toBe(true);
    const pos = (line.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute;
    expect(pos.getX(0)).toBe(0);
    expect(pos.getX(1)).toBe(10);
    expect((line.material as THREE.LineBasicMaterial).opacity).toBeCloseTo(0.9, 5);
    sys.dispose();
  });

  it('draws the tracer at full length instantly — no travel-time animation', () => {
    // The server resolves ranged hits as an instant distance check, so the
    // tracer must never show a growing/traveling segment; both endpoints
    // are set in the same fire() call, before any tick().
    const sys = createProjectileTracerSystem(THREE, scene, { poolSize: 1 });
    sys.fire({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
    const pos = (scene.children[0] as THREE.Line).geometry.attributes.position as THREE.BufferAttribute;
    // No tick() call yet — the full-length segment is already there.
    expect(pos.getX(1)).toBe(5);
    sys.dispose();
  });

  it('fades opacity to zero and hides the line after fadeSec', () => {
    const sys = createProjectileTracerSystem(THREE, scene, { poolSize: 1, fadeSec: 0.1 });
    // firedAt is stamped from performance.now()/1000 inside fire(), so tick()
    // must be driven from the same clock, not an arbitrary small nowSec.
    const nowSec = performance.now() / 1000;
    sys.fire({ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 });
    sys.tick(nowSec + 0.05);
    const line = scene.children[0] as THREE.Line;
    const midOpacity = (line.material as THREE.LineBasicMaterial).opacity;
    expect(midOpacity).toBeGreaterThan(0);
    expect(midOpacity).toBeLessThan(0.9);

    sys.tick(nowSec + 0.2);
    expect((line.material as THREE.LineBasicMaterial).opacity).toBe(0);
    expect(line.visible).toBe(false);
    sys.dispose();
  });

  it('cycles through the pool round-robin so rapid fire never allocates new geometry', () => {
    const sys = createProjectileTracerSystem(THREE, scene, { poolSize: 2 });
    const startCount = scene.children.length;
    sys.fire({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    sys.fire({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    sys.fire({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }); // wraps back to slot 0
    expect(scene.children.length).toBe(startCount); // no new geometry created
    const wrapped = (scene.children[0] as THREE.Line).geometry.attributes.position as THREE.BufferAttribute;
    expect(wrapped.getX(1)).toBe(3); // slot 0 now holds the 3rd shot's endpoint
    sys.dispose();
  });

  it('dispose() removes every pooled line from the scene and frees geometry/material', () => {
    const sys = createProjectileTracerSystem(THREE, scene, { poolSize: 3 });
    expect(scene.children.length).toBe(3);
    sys.dispose();
    expect(scene.children.length).toBe(0);
  });
});
