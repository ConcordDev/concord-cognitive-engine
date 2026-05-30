import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { corpseVisual, createCorpseMeshRenderer } from '@/lib/world-lens/corpse-mesh-renderer';

// WS3.4 — butchered drops / corpses render as real 3D objects. Pin the pure
// tint map + the renderer's spawn→pulse→remove lifecycle.

describe('WS3.4 — corpseVisual (pure)', () => {
  it('same species → same deterministic tint', () => {
    const a = corpseVisual({ species_id: 'dire_elk' });
    const b = corpseVisual({ species_id: 'dire_elk' });
    expect(a.color).toBe(b.color);
  });

  it('different species → (almost always) different tint', () => {
    const a = corpseVisual({ species_id: 'dire_elk' });
    const b = corpseVisual({ species_id: 'marsh_strider' });
    expect(a.color).not.toBe(b.color);
  });

  it('missing species → neutral fallback, never throws', () => {
    const v = corpseVisual({});
    expect(typeof v.color).toBe('number');
    expect(v.scale).toBeGreaterThan(0);
  });
});

describe('WS3.4 — createCorpseMeshRenderer lifecycle', () => {
  it('spawns a corpse mesh at its position and removes it when gone', async () => {
    const group = new THREE.Group();
    let rows = [{ id: 'c1', species_id: 'dire_elk', x: 7, y: 0, z: -3, expires_at: 9_999_999_999 }];
    const r = createCorpseMeshRenderer(group, { worldId: 'w', fetchCorpses: async () => rows });
    await r.refresh();
    expect(group.children.length).toBe(1);
    const corpse = group.children[0] as THREE.Group;
    expect(corpse.position.x).toBeCloseTo(7, 5);
    expect(corpse.position.z).toBeCloseTo(-3, 5);

    for (let i = 0; i < 4; i++) r.update(0.016, i * 0.2);

    // butchered / expired → no longer returned → mesh removed
    rows = [];
    await r.refresh();
    expect(group.children.length).toBe(0);

    r.dispose();
    expect(() => r.dispose()).not.toThrow();
  });

  it('skips corpses with no position', async () => {
    const group = new THREE.Group();
    const r = createCorpseMeshRenderer(group, {
      worldId: 'w',
      fetchCorpses: async () => [{ id: 'c2', species_id: 'x' }],
    });
    await r.refresh();
    expect(group.children.length).toBe(0);
    r.dispose();
  });
});
