// Phase S3-b — the live Iterate loop's pure spine: propose an iteration from an
// utterance (honest rejections included) and re-derive the artifact through the
// real detectArtifact registry. Pins that iterate never fabricates a change and
// that a re-derive is a REAL render of the new input (not a hand-patched copy).
import { describe, it, expect } from 'vitest';
import { proposeBuildingIteration, rederiveBuildingArtifact } from '@/lib/conkay/iterate-building';
import { detectArtifact, type ConkayBuildingArtifact } from '@/lib/conkay/artifact-kinds';

const SRC = {
  archetype: 'tower',
  feature: 'spire',
  name: 'Test Tower',
  position: { x: 0, y: 0, z: 0 },
  dimensions: { width: 6, height: 20, depth: 6 },
};

function buildArtifact(input: Record<string, unknown>): ConkayBuildingArtifact {
  const a = detectArtifact('game-design', 'building-publish', input, { ok: true, buildingId: 'b1' });
  if (!a || a.kind !== 'building') throw new Error('fixture failed to normalize');
  return a;
}

describe('proposeBuildingIteration — honest proposal or rejection', () => {
  it('valid utterance → a reviewable proposal with before/after + changed axes', () => {
    const p = proposeBuildingIteration(SRC, 'make it taller by 5m');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.before).toEqual({ width: 6, height: 20, depth: 6 });
    expect(p.after).toEqual({ width: 6, height: 25, depth: 6 });
    expect(p.changed).toEqual([{ axis: 'height', before: 20, after: 25, deltaM: 5 }]);
    expect(p.newInput.archetype).toBe('tower'); // non-dim fields preserved
    expect(p.summary).toContain('height');
  });

  it('unparseable utterance → no_intent rejection (never a silent/fake edit)', () => {
    const p = proposeBuildingIteration(SRC, 'hello there');
    expect(p).toMatchObject({ ok: false, reason: 'no_intent' });
    if (!p.ok) expect(p.message).toMatch(/didn.t catch/i);
  });

  it('artifact with no dimensions → no_dimensions rejection', () => {
    const p = proposeBuildingIteration({ archetype: 'tower' }, 'make it taller');
    expect(p).toMatchObject({ ok: false, reason: 'no_dimensions' });
  });

  it('a delta that clamps to a no-op → no_change (honest, not a fake rebuild)', () => {
    const atMax = { ...SRC, dimensions: { width: 6, height: 500, depth: 6 } };
    const p = proposeBuildingIteration(atMax, 'make it taller by 10m');
    expect(p).toMatchObject({ ok: false, reason: 'no_change' });
  });
});

describe('rederiveBuildingArtifact — real re-render of the new input', () => {
  it('produces a building artifact at the new dimensions, keeping the lineage id', () => {
    const prev = buildArtifact(SRC);
    const p = proposeBuildingIteration(SRC, 'make it taller by 5m');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const next = rederiveBuildingArtifact(prev, p.newInput)!;
    expect(next.kind).toBe('building');
    expect(next.buildings[0].dimensions).toEqual({ width: 6, height: 25, depth: 6 });
    expect(next.buildings[0].id).toBe('b1'); // lineage anchor preserved
    // provenance chains: the new artifact carries the new input for the NEXT iterate
    expect((next.sourceInput as { dimensions: { height: number } }).dimensions.height).toBe(25);
    // original artifact untouched
    expect(prev.buildings[0].dimensions.height).toBe(20);
  });
});
