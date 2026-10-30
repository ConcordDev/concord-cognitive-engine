import { describe, it, expect } from 'vitest';
import {
  clickSelection,
  selectAllIds,
  dragStarts,
  moveSelection,
  deleteSelection,
  duplicateSelection,
  type SketchElement,
} from '@/components/whiteboard/whiteboard-model';

const els: SketchElement[] = [
  { id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, stroke: '#fff', fill: 'transparent', strokeWidth: 1 },
  { id: 'b', type: 'ellipse', x: 100, y: 50, width: 10, height: 10, stroke: '#fff', fill: 'transparent', strokeWidth: 1 },
  { id: 'f', type: 'freehand', x: 5, y: 5, points: [{ x: 5, y: 5 }, { x: 15, y: 9 }], stroke: '#fff', fill: 'transparent', strokeWidth: 1 },
];

describe('whiteboard multi-selection model (Q57)', () => {
  it('plain click replaces the selection; click on empty canvas clears it', () => {
    expect([...clickSelection(new Set(['a']), 'b', false)]).toEqual(['b']);
    expect(clickSelection(new Set(['a']), null, false).size).toBe(0);
  });

  it('plain click on an already-selected element keeps the group (drag moves all)', () => {
    const cur = new Set(['a', 'b']);
    expect([...clickSelection(cur, 'a', false)].sort()).toEqual(['a', 'b']);
  });

  it('additive click toggles membership', () => {
    expect([...clickSelection(new Set(['a']), 'b', true)].sort()).toEqual(['a', 'b']);
    expect([...clickSelection(new Set(['a', 'b']), 'a', true)]).toEqual(['b']);
    // Additive click on empty canvas changes nothing.
    expect([...clickSelection(new Set(['a']), null, true)]).toEqual(['a']);
  });

  it('selectAllIds selects every element (⌘A)', () => {
    expect([...selectAllIds(els)].sort()).toEqual(['a', 'b', 'f']);
  });

  it('a group drag moves every selected element by the same delta, freehand points included', () => {
    const ids = new Set(['a', 'f']);
    const starts = dragStarts(els, ids);
    const moved = moveSelection(els, starts, 10, -5);
    expect(moved.find((e) => e.id === 'a')).toMatchObject({ x: 10, y: -5 });
    expect(moved.find((e) => e.id === 'b')).toMatchObject({ x: 100, y: 50 });
    expect(moved.find((e) => e.id === 'f')?.points).toEqual([{ x: 15, y: 0 }, { x: 25, y: 4 }]);
    // Dragging back to the grab point restores the exact start positions.
    const back = moveSelection(moved, starts, 0, 0);
    expect(back.find((e) => e.id === 'a')).toMatchObject({ x: 0, y: 0 });
  });

  it('deleteSelection removes exactly the selected elements', () => {
    expect(deleteSelection(els, new Set(['a', 'f'])).map((e) => e.id)).toEqual(['b']);
    expect(deleteSelection(els, new Set())).toBe(els);
  });

  it('duplicateSelection copies the selected elements offset by (+16, +16) with fresh ids', () => {
    let n = 0;
    const copies = duplicateSelection(els, new Set(['b', 'f']), () => `copy_${++n}`);
    expect(copies.map((c) => c.id)).toEqual(['copy_1', 'copy_2']);
    expect(copies[0]).toMatchObject({ type: 'ellipse', x: 116, y: 66 });
    expect(copies[1].points).toEqual([{ x: 21, y: 21 }, { x: 31, y: 25 }]);
  });
});
