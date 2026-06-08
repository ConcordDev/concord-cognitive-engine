// ConKay Phase 3 — exploded view honesty + correctness.
//
// The R3F render needs WebGL (not headless), but the load-bearing logic IS
// verifiable: computeExplodedLayout derives the exploded part set from a REAL
// ar.render drawList — one part per real object, pushed out from the assembly's
// center of mass. We also assert (by reading the source) that the parts come
// from the macro/descriptor, not a hardcoded mock array.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeExplodedLayout } from '@/components/conkay/ConKayArtifactExploded';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '../../components/conkay/ConKayArtifactExploded.tsx');

describe('computeExplodedLayout', () => {
  it('produces exactly one part per real drawList object, preserving id/kind/color', () => {
    const drawList = [
      { id: 'logo', kind: 'model', color: '#ff0000', transform: { position: { x: 1, y: 0, z: 0 } } },
      { id: 'sign', kind: 'text', color: '#00ff00', transform: { position: { x: -1, y: 0, z: 0 } } },
      { id: 'base', kind: 'primitive', color: '#0000ff', transform: { position: { x: 0, y: 1, z: 0 } } },
    ];
    const parts = computeExplodedLayout(drawList);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.id)).toEqual(['logo', 'sign', 'base']);
    expect(parts.map((p) => p.kind)).toEqual(['model', 'text', 'primitive']);
    expect(parts[0].color).toBe('#ff0000');
  });

  it('pushes each part OUTWARD from the center of mass (exploded ≠ original)', () => {
    const drawList = [
      { id: 'a', transform: { position: { x: 2, y: 0, z: 0 } } },
      { id: 'b', transform: { position: { x: -2, y: 0, z: 0 } } },
    ];
    const parts = computeExplodedLayout(drawList, 3);
    // center is origin; 'a' was at +x, so its exploded target keeps +x sign and
    // sits farther out than collapsed-toward-center.
    expect(parts[0].to[0]).toBeGreaterThan(0);
    expect(parts[1].to[0]).toBeLessThan(0);
    // from = authored position (the real assembled location)
    expect(parts[0].from).toEqual([2, 0, 0]);
  });

  it('fans coincident parts out by index so nothing stays stacked', () => {
    const drawList = [
      { id: 'x', transform: { position: { x: 0, y: 0, z: 0 } } },
      { id: 'y', transform: { position: { x: 0, y: 0, z: 0 } } },
      { id: 'z', transform: { position: { x: 0, y: 0, z: 0 } } },
    ];
    const parts = computeExplodedLayout(drawList, 2);
    const keys = new Set(parts.map((p) => p.to.join(',')));
    expect(keys.size).toBe(3); // all three land at distinct exploded positions
  });

  it('returns an empty layout for an empty/absent drawList (no mock fallback)', () => {
    expect(computeExplodedLayout([])).toEqual([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(computeExplodedLayout(undefined as any)).toEqual([]);
  });

  it('sources parts from the real ar.render macro — no hardcoded part array', () => {
    const src = readFileSync(SRC, 'utf8');
    expect(src).toMatch(/lensRun(<[^>]*>)?\(\s*['"]ar['"]\s*,\s*['"]render['"]/);
    expect(src).toMatch(/result\??\.drawList/);
    // Honest empty state instead of inventing parts.
    expect(src).toMatch(/No AR artifact to inspect/);
  });
});
