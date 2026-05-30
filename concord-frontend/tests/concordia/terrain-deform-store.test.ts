import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDeltaAt, setAllDeltas, setCellDelta, setCellSize, getCellSize,
  cellKeyForWorld, snapshotDeltas, subscribe, resetDeformStore,
} from '@/lib/world-lens/terrain-deform-store';
import { planChunkVertexUpdates } from '@/lib/world-lens/attach-terrain-deformation';

describe('WS-A3 — terrain deform store', () => {
  beforeEach(() => resetDeformStore());

  it('getDeltaAt is 0 when undeformed', () => {
    expect(getDeltaAt(123, 456)).toBe(0);
  });

  it('cellKeyForWorld floors by the active cell size', () => {
    setCellSize(10);
    expect(cellKeyForWorld(0, 0)).toBe('0,0');
    expect(cellKeyForWorld(15, 25)).toBe('1,2');
    expect(cellKeyForWorld(-5, -5)).toBe('-1,-1');
  });

  it('setAllDeltas replaces, getDeltaAt resolves a world point to its cell delta', () => {
    setCellSize(10);
    setAllDeltas(new Map([['0,0', -8], ['1,2', 4]]));
    expect(getDeltaAt(5, 5)).toBe(-8);   // cell 0,0
    expect(getDeltaAt(15, 25)).toBe(4);  // cell 1,2
    expect(getDeltaAt(999, 999)).toBe(0); // untouched
  });

  it('setCellDelta patches one cell + notifies subscribers; 0 removes it', () => {
    setCellSize(10);
    const changed: string[] = [];
    const unsub = subscribe((c) => changed.push(...c));
    expect(setCellDelta('3,3', -5)).toBe(true);
    expect(getDeltaAt(35, 35)).toBe(-5);
    expect(setCellDelta('3,3', -5)).toBe(false); // no-op when unchanged
    expect(setCellDelta('3,3', 0)).toBe(true);   // 0 clears
    expect(snapshotDeltas().has('3,3')).toBe(false);
    unsub();
    expect(changed).toContain('3,3');
  });

  it('reset clears deltas + restores default cell size', () => {
    setCellSize(25);
    setCellDelta('0,0', -3);
    resetDeformStore();
    expect(snapshotDeltas().size).toBe(0);
    expect(getCellSize()).toBe(10);
  });
});

describe('WS-A3 — planChunkVertexUpdates (pure mesh plan)', () => {
  it('returns increment = cumulative - applied so repeated events never double-count', () => {
    const verts = [
      { i: 0, wx: 5, wz: 5, curY: 40 },   // cell 0,0
      { i: 1, wx: 95, wz: 5, curY: 40 },  // cell 9,0 (untouched)
    ];
    const cumulative = new Map([['0,0', -8]]);
    const applied = new Map<string, number>();
    const r1 = planChunkVertexUpdates(verts, cumulative, applied, 10);
    expect(r1.updates).toEqual([{ i: 0, newY: 32 }]); // 40 + (-8 - 0)
    expect(r1.touchedCells.get('0,0')).toBe(-8);

    // Now applied catches up; a re-run with the SAME cumulative yields no update.
    const r2 = planChunkVertexUpdates(verts, cumulative, new Map([['0,0', -8]]), 10);
    expect(r2.updates).toEqual([]);

    // A deeper dig only applies the increment.
    const r3 = planChunkVertexUpdates(verts, new Map([['0,0', -12]]), new Map([['0,0', -8]]), 10);
    expect(r3.updates).toEqual([{ i: 0, newY: 36 }]); // 40 + (-12 - -8) = 40 - 4
  });
});
