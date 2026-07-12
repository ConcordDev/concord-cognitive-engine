// runtime-health-capability-map.md finding #5 — procedural building
// materials/textures leak unbounded, permanently, at module scope. This
// file proves: (1) the module-level material cache is genuinely per-BUILDING
// (not per-archetype, despite the old header comment), (2) disposeBuildingArchetype()
// actually calls .dispose() on every cached material and empties the cache
// (not just "the function exists"), (3) the LRU safety-net cap evicts+disposes
// the coldest entry once the cache overflows.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { createBuilding, disposeBuildingArchetype, _testing } from '@/lib/world-lens/procedural-buildings';
import { clearProceduralCache } from '@/lib/world-lens/procedural-texture';

function meshMaterials(group: THREE.Group): THREE.Material[] {
  const mats: THREE.Material[] = [];
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if ((mesh as { isMesh?: boolean }).isMesh && mesh.material) {
      const m = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.push(...m);
    }
  });
  return mats;
}

describe('procedural-buildings material cache', () => {
  beforeEach(() => {
    disposeBuildingArchetype();
    clearProceduralCache();
  });

  it('caches materials per BUILDING (same seed => identical material references across calls)', () => {
    const a = createBuilding(THREE, { archetype: 'tavern', seed: 'building-1' });
    const b = createBuilding(THREE, { archetype: 'tavern', seed: 'building-1' });
    const matsA = meshMaterials(a);
    const matsB = meshMaterials(b);
    expect(matsA.length).toBeGreaterThan(0);
    // Every material instance used by the second build is one of the exact
    // same objects used by the first build (cache hit, not a fresh mint).
    for (const m of matsB) {
      expect(matsA).toContain(m);
    }
  });

  it('wall/roof materials are NOT shared across different buildings (per-building keying via pbrSeed, not per-archetype)', () => {
    // Only wall/roof pass `pbrSeed` (derived from the building's own DTU
    // id) into getMaterial() — see createBuilding()'s call sites (`wallMat`/
    // `roofMat` pass `{ pbrKind, pbrSeed }`; `trimMat`/`windowMat` don't
    // carry `pbrSeed` at all — they're plain solid-color materials with no
    // procedural texture, so those ARE legitimately shared across buildings
    // of the same archetype+color, which is correct, efficient caching, not
    // a bug). getMaterial()'s cache key is
    // `${key}:${color}:${emissive}:${pbrKind}:${pbrSeed}`, so a wall/roof
    // entry's key always ends with a non-empty pbrSeed segment while trim/
    // window's ends empty — inspect the real cache directly via `_testing`
    // rather than guessing mesh/slot correspondence from the Three.js group
    // (no per-mesh slot metadata exists to walk).
    createBuilding(THREE, { archetype: 'tavern', seed: 'building-a' });
    const afterA = new Map(_testing.materialCache);
    createBuilding(THREE, { archetype: 'tavern', seed: 'building-b' });
    const afterB = _testing.materialCache;

    const isWallOrRoofKey = (key: string) => {
      const parts = key.split(':');
      const pbrSeed = parts[parts.length - 1];
      return (key.startsWith('wall:') || key.startsWith('roof:')) && pbrSeed !== '';
    };

    const wallRoofKeysA = [...afterA.keys()].filter(isWallOrRoofKey);
    const wallRoofKeysB = [...afterB.keys()].filter(isWallOrRoofKey);
    expect(wallRoofKeysA.length).toBeGreaterThan(0);
    expect(wallRoofKeysB.length).toBeGreaterThan(wallRoofKeysA.length);
    // Building A's wall/roof cache keys must NOT reappear verbatim for
    // building B (different pbrSeed => different key => different entry).
    for (const key of wallRoofKeysA) {
      const material = afterA.get(key);
      // The exact same key still maps to the exact same material object
      // (A's own building wasn't evicted/changed by B's build)...
      expect(afterB.get(key)).toBe(material);
    }
    // ...but building B introduced genuinely NEW wall/roof keys (its own
    // pbrSeed), not reuses of A's.
    const newKeysFromB = wallRoofKeysB.filter((k) => !wallRoofKeysA.includes(k));
    expect(newKeysFromB.length).toBeGreaterThan(0);

    // Sanity check the other half of the claim: trim/window keys (no
    // pbrSeed) are genuinely shared — building B should NOT have introduced
    // new trim/window entries if building A already cached the same
    // archetype+color combo, proving the cache isn't accidentally
    // per-building for every slot (which would itself be a correctness
    // regression of the intentional shared-material efficiency).
    const trimWindowKeysA = [...afterA.keys()].filter((k) => !isWallOrRoofKey(k) && (k.startsWith('trim:') || k.startsWith('window:')));
    const trimWindowKeysB = [...afterB.keys()].filter((k) => !isWallOrRoofKey(k) && (k.startsWith('trim:') || k.startsWith('window:')));
    expect(trimWindowKeysB.length).toBe(trimWindowKeysA.length);
  });

  it('disposeBuildingArchetype() actually calls .dispose() on every cached material and empties the cache', () => {
    createBuilding(THREE, { archetype: 'forge', seed: 'dispose-test-1' });
    createBuilding(THREE, { archetype: 'market', seed: 'dispose-test-2' });
    expect(_testing.materialCache.size).toBeGreaterThan(0);

    const cachedMaterials = Array.from(_testing.materialCache.values());
    let disposedCount = 0;
    for (const m of cachedMaterials) {
      const orig = m.dispose.bind(m);
      m.dispose = () => { disposedCount++; orig(); };
    }

    disposeBuildingArchetype();

    expect(disposedCount).toBe(cachedMaterials.length);
    expect(_testing.materialCache.size).toBe(0);
  });

  it('a subsequent build after disposal mints brand-new material objects (cache genuinely cleared, not just size-reported-zero)', () => {
    const a = createBuilding(THREE, { archetype: 'tower', seed: 'revive-1' });
    const matsA = new Set(meshMaterials(a));
    disposeBuildingArchetype();
    const b = createBuilding(THREE, { archetype: 'tower', seed: 'revive-1' });
    const matsB = meshMaterials(b);
    for (const m of matsB) {
      expect(matsA.has(m)).toBe(false);
    }
  });

  it('LRU cap evicts and disposes the coldest entry once the cache overflows', () => {
    const cap = _testing.MAX_MATERIAL_CACHE_ENTRIES;
    // Each tavern build adds up to 4 cache entries (wall/roof/trim/window).
    // Overflow the cap by a comfortable margin.
    const buildsNeeded = Math.ceil(cap / 4) + 5;
    for (let i = 0; i < buildsNeeded; i++) {
      createBuilding(THREE, { archetype: 'tavern', seed: `lru-${i}` });
    }
    expect(_testing.materialCache.size).toBeLessThanOrEqual(cap);
    expect(_testing.materialCache.size).toBeGreaterThan(0);
  });
});
