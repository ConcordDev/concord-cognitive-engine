import { describe, it, expect } from 'vitest';
import {
  parseCellKey,
  worldXToSample,
  terrainCellToHmSamples,
  bakeDeltasIntoHeightmap,
  deltaMapFromRows,
} from '@/lib/world-lens/terrain-deform-math';

// WS-A2 — pure heightmap-bake math. These functions keep the Rapier collider +
// the rendered mesh agreeing with the server's getElevationAt (base + delta).

const WORLD = 2000;
const MAXELEV = 80;
const CELL = 10;

describe('WS-A2 — terrain deform math (pure)', () => {
  it('parseCellKey handles negatives + rejects garbage', () => {
    expect(parseCellKey('3,-5')).toEqual({ cx: 3, cz: -5 });
    expect(parseCellKey('nope')).toBeNull();
  });

  it('worldXToSample maps world centre to mid heightmap + clamps the edges', () => {
    expect(worldXToSample(0, 256, WORLD)).toBe(128); // centre
    expect(worldXToSample(-99999, 256, WORLD)).toBe(0); // clamp low
    expect(worldXToSample(99999, 256, WORLD)).toBe(255); // clamp high
  });

  it('a deformation cell maps to at least one heightmap sample', () => {
    const samples = terrainCellToHmSamples(0, 0, CELL, 256, 256, WORLD);
    expect(samples.length).toBeGreaterThanOrEqual(1);
    // cell (0,0) spans world x∈[0,10) → just east of centre
    for (const s of samples) {
      expect(s.ix).toBeGreaterThanOrEqual(128);
      expect(s.ix).toBeLessThan(132);
    }
  });

  it('baking a dig delta LOWERS the covered samples; base is untouched', () => {
    const base = new Float32Array(256 * 256).fill(0.5);
    const deltas = new Map<string, number>([['0,0', -8]]); // dig 8m
    const out = bakeDeltasIntoHeightmap(base, 256, 256, deltas, CELL, MAXELEV, WORLD);
    // base unchanged (copy semantics)
    expect(base[128 * 256 + 128]).toBeCloseTo(0.5, 6);
    // covered sample lowered by 8/80 = 0.1
    const s = terrainCellToHmSamples(0, 0, CELL, 256, 256, WORLD)[0];
    expect(out[s.iz * 256 + s.ix]).toBeCloseTo(0.4, 5);
    // an untouched far sample is unchanged
    expect(out[0]).toBeCloseTo(0.5, 6);
  });

  it('baking clamps to the sane normalized band', () => {
    const base = new Float32Array(16 * 16).fill(0.0);
    const deltas = new Map<string, number>([['0,0', -9999]]);
    const out = bakeDeltasIntoHeightmap(base, 16, 16, deltas, CELL, MAXELEV, WORLD);
    for (const v of out) expect(v).toBeGreaterThanOrEqual(-0.5);
  });

  it('empty deltas → an unchanged copy', () => {
    const base = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const out = bakeDeltasIntoHeightmap(base, 2, 2, new Map(), CELL, MAXELEV, WORLD);
    for (let i = 0; i < base.length; i++) expect(out[i]).toBeCloseTo(base[i], 6);
    expect(out).not.toBe(base); // still a copy
  });

  it('deltaMapFromRows sums multiple rows per cell', () => {
    const m = deltaMapFromRows([
      { cell_x: 1, cell_z: 2, height_delta: -3 },
      { cell_x: 1, cell_z: 2, height_delta: -2 },
      { cell_x: 5, cell_z: 5, height_delta: 4 },
    ]);
    expect(m.get('1,2')).toBe(-5);
    expect(m.get('5,5')).toBe(4);
  });
});
