// Building silhouette mapping + iconic-feature meshes. The mapping is pure data;
// the mesh builder is exercised with a stub THREE that records geometry types,
// so we assert the actual landmark shapes (dome/spire/colonnade/belfry) without
// a GL context. No mocks of our own code.

import { describe, it, expect } from 'vitest';
import { silhouetteForBuildingType, coerceMaterial } from '@/lib/world-lens/building-silhouette';
import { addIconicFeature } from '@/lib/world-lens/procedural-buildings';

// ── Pure mapping ────────────────────────────────────────────────────────────
describe('silhouetteForBuildingType', () => {
  it('gives the iconic landmarks their signature feature', () => {
    expect(silhouetteForBuildingType('observatory')).toEqual({ archetype: 'tower', feature: 'dome' });
    expect(silhouetteForBuildingType('cartographer_table')).toEqual({ archetype: 'tower', feature: 'spire' });
    expect(silhouetteForBuildingType('courthouse')).toEqual({ archetype: 'archive', feature: 'colonnade' });
    expect(silhouetteForBuildingType('schoolhouse')).toEqual({ archetype: 'tavern', feature: 'belfry' });
    expect(silhouetteForBuildingType('forge')).toEqual({ archetype: 'forge' });
  });

  it('resolves EVERY archetype to one of the 5 real procedural archetypes', () => {
    const valid = new Set(['tavern', 'archive', 'forge', 'market', 'tower']);
    const types = ['inn', 'house', 'market', 'tower', 'bank_house', 'powerhouse', 'agora', 'grange', 'mineshaft', 'unknown_type', ''];
    for (const t of types) {
      expect(valid.has(silhouetteForBuildingType(t).archetype)).toBe(true);
    }
    // Unknown / empty fall back, never throw.
    expect(silhouetteForBuildingType(undefined).archetype).toBe('market');
    expect(silhouetteForBuildingType('not_a_building').feature).toBeUndefined();
  });

  it('coerces stored materials to renderer material types (thatch → wood)', () => {
    expect(coerceMaterial('thatch')).toBe('wood');
    expect(coerceMaterial('stone')).toBe('stone');
    expect(coerceMaterial('steel')).toBe('steel');
    expect(coerceMaterial(undefined)).toBe('stone');
  });
});

// ── Iconic feature meshes (stub THREE) ──────────────────────────────────────
function makeMockTHREE() {
  class Vec { x = 0; y = 0; z = 0; set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; } }
  class Group { children: unknown[] = []; userData: unknown = {}; add(o: unknown) { this.children.push(o); } }
  class Mesh {
    geometry: { kind: string };
    position = new Vec();
    rotation = new Vec();
    scale = new Vec();
    castShadow = false; receiveShadow = false;
    constructor(geometry: { kind: string }) { this.geometry = geometry; }
  }
  const geom = (kind: string) => () => ({ kind });
  return {
    Group, Mesh, Vector3: Vec,
    BoxGeometry: function () { return { kind: 'Box' }; },
    ConeGeometry: function () { return { kind: 'Cone' }; },
    CylinderGeometry: function () { return { kind: 'Cylinder' }; },
    SphereGeometry: function () { return { kind: 'Sphere' }; },
    _geom: geom,
  } as unknown as typeof import('three');
}

function build(feature: 'dome' | 'spire' | 'colonnade' | 'belfry') {
  const THREE = makeMockTHREE();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = new (THREE as any).Group();
  const mat = {} as never;
  addIconicFeature(THREE, g, feature, 1, mat, mat);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (g.children as any[]).map((m) => ({ kind: m.geometry.kind, y: m.position.y }));
}

describe('addIconicFeature — landmark shapes', () => {
  it('dome: a hemisphere (Sphere) above the roofline, on a drum', () => {
    const parts = build('dome');
    const sphere = parts.find((p) => p.kind === 'Sphere');
    expect(sphere).toBeTruthy();
    expect(sphere!.y).toBeGreaterThan(8); // above the ~8·scale roof
    expect(parts.some((p) => p.kind === 'Cylinder')).toBe(true); // the drum
  });

  it('spire: a tall Cone reaching well above the roof', () => {
    const parts = build('spire');
    const cones = parts.filter((p) => p.kind === 'Cone');
    expect(cones.length).toBeGreaterThan(0);
    expect(Math.max(...cones.map((c) => c.y))).toBeGreaterThan(12); // a real spire
  });

  it('colonnade: a row of columns (≥6 Cylinders) + a pediment Cone', () => {
    const parts = build('colonnade');
    expect(parts.filter((p) => p.kind === 'Cylinder').length).toBeGreaterThanOrEqual(6);
    expect(parts.some((p) => p.kind === 'Cone')).toBe(true);   // pediment
    expect(parts.some((p) => p.kind === 'Box')).toBe(true);    // architrave
  });

  it('belfry: a box tower with a pyramidal Cone cap', () => {
    const parts = build('belfry');
    expect(parts.some((p) => p.kind === 'Box')).toBe(true);
    expect(parts.some((p) => p.kind === 'Cone')).toBe(true);
    expect(parts.some((p) => p.kind === 'Sphere')).toBe(true); // the bell
  });
});
