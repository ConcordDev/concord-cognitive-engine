import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  constructionVisual,
  createConstructionProgressRenderer,
} from '@/lib/world-lens/construction-progress-renderer';

// WS2.3 — buildings under construction visibly rise. Pin the pure visual map +
// the renderer's reconcile/grow/finish lifecycle (no network — fetchBuildings seam).

describe('WS2.3 — constructionVisual (pure)', () => {
  it('a standing building shows no overlay', () => {
    const v = constructionVisual({ id: 'b', state: 'standing', construction_progress_pct: 100, height: 8 });
    expect(v.active).toBe(false);
  });

  it('a collapsed building shows no overlay', () => {
    expect(constructionVisual({ id: 'b', state: 'collapsed', construction_progress_pct: 0 }).active).toBe(false);
  });

  it('a construction site at 50% is active with half-revealed height', () => {
    const v = constructionVisual({ id: 'b', state: 'construction', construction_progress_pct: 50, height: 8 });
    expect(v.active).toBe(true);
    expect(v.fraction).toBeCloseTo(0.5, 5);
    expect(v.revealedHeight).toBeCloseTo(4, 5);
    expect(v.scaffoldOpacity).toBeGreaterThan(0); // scaffold still visible mid-build
  });

  it('progress 0..100 monotonically raises revealedHeight and fades scaffold', () => {
    const low = constructionVisual({ id: 'b', state: 'construction', construction_progress_pct: 10, height: 10 });
    const high = constructionVisual({ id: 'b', state: 'construction', construction_progress_pct: 90, height: 10 });
    expect(high.revealedHeight).toBeGreaterThan(low.revealedHeight);
    expect(high.scaffoldOpacity).toBeLessThan(low.scaffoldOpacity);
  });

  it('garbage / missing fields degrade to a foundation slab, never throws', () => {
    const v = constructionVisual({ id: 'b' } as never);
    expect(v.active).toBe(false); // no state + 0 pct + not construction → no overlay
    expect(Number.isFinite(v.revealedHeight)).toBe(true);
  });
});

describe('WS2.3 — createConstructionProgressRenderer lifecycle', () => {
  it('mounts an overlay for an in-progress site and removes it when standing', async () => {
    const group = new THREE.Group();
    let rows = [
      { id: 's1', state: 'construction', construction_progress_pct: 30, x: 5, y: 0, z: 5, width: 10, depth: 10, height: 8 },
    ];
    const r = createConstructionProgressRenderer(group, {
      worldId: 'w',
      fetchBuildings: async () => rows,
    });
    await r.refresh();
    expect(group.children.length).toBe(1); // one site overlay group

    // a few frames of growth do not throw
    for (let i = 0; i < 5; i++) r.update(0.016, i * 0.016);

    // building finishes → overlay disposed
    rows = [{ id: 's1', state: 'standing', construction_progress_pct: 100, x: 5, y: 0, z: 5, width: 10, depth: 10, height: 8 }];
    await r.refresh();
    expect(group.children.length).toBe(0);

    r.dispose();
    expect(() => r.dispose()).not.toThrow();
  });
});
