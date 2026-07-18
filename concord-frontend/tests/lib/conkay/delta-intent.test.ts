// Phase S3-a — the deterministic delta-intent floor for the "Iterate" wedge.
// Pins the honest mapping utterance → structured building-dimension delta, and
// crucially the STOP-POINT (invariant #4): an utterance with no explicit,
// unambiguous edit returns null — the artifact is left untouched, never a
// fabricated change.
import { describe, it, expect } from 'vitest';
import {
  parseBuildingDimIntent,
  applyDimensionDelta,
  describeDelta,
  MIN_DIM_M,
  MAX_DIM_M,
  type BuildingDimensions,
} from '@/lib/conkay/delta-intent';

const D: BuildingDimensions = { width: 5, height: 5, depth: 5 };

describe('parseBuildingDimIntent — SET explicit target', () => {
  it('"make it 10m tall" → set height 10', () => {
    expect(parseBuildingDimIntent('make it 10m tall')).toMatchObject({ axis: 'height', op: 'set', value: 10 });
  });
  it('"set width to 8" → set width 8', () => {
    expect(parseBuildingDimIntent('set width to 8')).toMatchObject({ axis: 'width', op: 'set', value: 8 });
  });
  it('"height = 12" → set height 12', () => {
    expect(parseBuildingDimIntent('height = 12')).toMatchObject({ axis: 'height', op: 'set', value: 12 });
  });
  it('"set everything to 10" is ambiguous → null (never guesses across all dims)', () => {
    expect(parseBuildingDimIntent('make it bigger to 10')).toBeNull();
  });
});

describe('parseBuildingDimIntent — ADD relative amount', () => {
  it('"make it taller by 2m" → add height +2', () => {
    expect(parseBuildingDimIntent('make it taller by 2m')).toMatchObject({ axis: 'height', op: 'add', value: 2 });
  });
  it('"add 3 metres to the depth" → add depth +3', () => {
    expect(parseBuildingDimIntent('add 3 metres to the depth')).toMatchObject({ axis: 'depth', op: 'add', value: 3 });
  });
  it('"reduce the height by 4" → add height −4', () => {
    expect(parseBuildingDimIntent('reduce the height by 4')).toMatchObject({ axis: 'height', op: 'add', value: -4 });
  });
});

describe('parseBuildingDimIntent — SCALE directional (no amount)', () => {
  it('"make it taller" → scale height up', () => {
    const d = parseBuildingDimIntent('make it taller')!;
    expect(d.axis).toBe('height');
    expect(d.op).toBe('scale');
    expect(d.value).toBeGreaterThan(1);
  });
  it('"a bit wider" → scale width up', () => {
    expect(parseBuildingDimIntent('a bit wider')).toMatchObject({ axis: 'width', op: 'scale' });
  });
  it('"make it shorter" → scale height down (<1)', () => {
    const d = parseBuildingDimIntent('make it shorter')!;
    expect(d.axis).toBe('height');
    expect(d.value).toBeLessThan(1);
  });
  it('"bigger" → scale all up; "smaller" → scale all down', () => {
    expect(parseBuildingDimIntent('bigger')).toMatchObject({ axis: 'all', op: 'scale' });
    const small = parseBuildingDimIntent('make it smaller')!;
    expect(small.axis).toBe('all');
    expect(small.value).toBeLessThan(1);
  });
});

describe('parseBuildingDimIntent — the STOP-POINT (no fabrication)', () => {
  it('utterances with no dimension edit return null', () => {
    expect(parseBuildingDimIntent('hello there')).toBeNull();
    expect(parseBuildingDimIntent('the height')).toBeNull(); // noun, no number, no direction
    expect(parseBuildingDimIntent('make it blue')).toBeNull();
    expect(parseBuildingDimIntent('')).toBeNull();
    // @ts-expect-error — defensive: non-string input
    expect(parseBuildingDimIntent(null)).toBeNull();
  });
  it('preserves the raw utterance for the confirm gate + provenance', () => {
    expect(parseBuildingDimIntent('  Make it TALLER  ')?.rawUtterance).toBe('Make it TALLER');
  });
});

describe('applyDimensionDelta — pure, clamped re-run input', () => {
  it('set replaces one axis; others untouched', () => {
    expect(applyDimensionDelta(D, { axis: 'height', op: 'set', value: 10, rawUtterance: '' })).toEqual({
      width: 5,
      height: 10,
      depth: 5,
    });
  });
  it('add is signed', () => {
    expect(applyDimensionDelta(D, { axis: 'height', op: 'add', value: -4, rawUtterance: '' }).height).toBe(1);
  });
  it('scale all multiplies every dimension', () => {
    expect(applyDimensionDelta({ width: 4, height: 4, depth: 4 }, { axis: 'all', op: 'scale', value: 1.25, rawUtterance: '' })).toEqual({
      width: 5,
      height: 5,
      depth: 5,
    });
  });
  it('clamps to [MIN_DIM_M, MAX_DIM_M] so a re-run is never degenerate/absurd', () => {
    expect(applyDimensionDelta(D, { axis: 'height', op: 'add', value: 10000, rawUtterance: '' }).height).toBe(MAX_DIM_M);
    expect(applyDimensionDelta({ width: 1, height: 1, depth: 1 }, { axis: 'height', op: 'add', value: -5, rawUtterance: '' }).height).toBe(MIN_DIM_M);
  });
});

describe('describeDelta — confirm-gate summary', () => {
  it('reads each op honestly', () => {
    expect(describeDelta({ axis: 'height', op: 'set', value: 10, rawUtterance: '' })).toBe('set height to 10 m');
    expect(describeDelta({ axis: 'height', op: 'add', value: 2, rawUtterance: '' })).toBe('+2 m height');
    expect(describeDelta({ axis: 'height', op: 'add', value: -4, rawUtterance: '' })).toBe('−4 m height');
    expect(describeDelta({ axis: 'all', op: 'scale', value: 1.25, rawUtterance: '' })).toBe('grow size 25%');
  });
});
