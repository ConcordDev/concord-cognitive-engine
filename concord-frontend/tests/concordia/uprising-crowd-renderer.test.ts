import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { crowdVisual, createUprisingCrowdRenderer } from '@/lib/world-lens/uprising-crowd-renderer';

// WS2.7 — uprisings render as a visible crowd at their rebels' centroid. Pin the
// pure visual map + the renderer's erupt→render→disperse lifecycle.

describe('WS2.7 — crowdVisual (pure)', () => {
  it('an uprising without a resolved position is not renderable (no fake crowd)', () => {
    expect(crowdVisual({ movementId: 'm', memberCount: 5, x: null, z: null }).renderable).toBe(false);
  });

  it('a positioned uprising is renderable with banners scaled to members', () => {
    const small = crowdVisual({ movementId: 'm', memberCount: 3, x: 0, z: 0 });
    const big = crowdVisual({ movementId: 'm', memberCount: 30, x: 0, z: 0 });
    expect(small.renderable).toBe(true);
    expect(big.bannerCount).toBeGreaterThan(small.bannerCount);
    expect(big.radius).toBeGreaterThan(small.radius);
  });

  it('banner count is capped and radius is clamped', () => {
    const huge = crowdVisual({ movementId: 'm', memberCount: 10000, x: 1, z: 1 });
    expect(huge.bannerCount).toBeLessThanOrEqual(12);
    expect(huge.radius).toBeLessThanOrEqual(12);
  });

  it('heat rises with grievance', () => {
    const calm = crowdVisual({ movementId: 'm', memberCount: 4, grievance: 1, x: 0, z: 0 });
    const furious = crowdVisual({ movementId: 'm', memberCount: 4, grievance: 10, x: 0, z: 0 });
    expect(furious.heat).toBeGreaterThan(calm.heat);
  });
});

describe('WS2.7 — createUprisingCrowdRenderer lifecycle', () => {
  it('spawns a crowd for an acting uprising and disperses it on resolution', async () => {
    const group = new THREE.Group();
    let rows = [{ movementId: 'm1', memberCount: 9, grievance: 8, x: 50, z: -20 }];
    const r = createUprisingCrowdRenderer(group, {
      worldId: 'w',
      fetchUprisings: async () => rows,
    });
    await r.refresh();
    expect(group.children.length).toBe(1);
    const crowd = group.children[0] as THREE.Group;
    expect(crowd.position.x).toBeCloseTo(50, 5);
    expect(crowd.position.z).toBeCloseTo(-20, 5);

    for (let i = 0; i < 5; i++) r.update(0.016, i * 0.1);

    // resolved → no longer returned → crowd disperses
    rows = [];
    await r.refresh();
    expect(group.children.length).toBe(0);

    r.dispose();
    expect(() => r.dispose()).not.toThrow();
  });

  it('skips null-position uprisings entirely', async () => {
    const group = new THREE.Group();
    const r = createUprisingCrowdRenderer(group, {
      worldId: 'w',
      fetchUprisings: async () => [{ movementId: 'm2', memberCount: 5, x: null, z: null }],
    });
    await r.refresh();
    expect(group.children.length).toBe(0);
    r.dispose();
  });
});
