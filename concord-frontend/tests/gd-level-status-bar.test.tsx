/**
 * GdLevelPanel — Tiled-style status bar.
 *
 * Pins the real interaction added in this pass: hovering the tilemap canvas
 * updates a live "Cell x, y" readout to the exact cell `onPointerDown` would
 * paint (not a decorative caption) — the same coordinate math the paint
 * handler uses, verified end-to-end through a real pointer event.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act, fireEvent } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { GdLevelPanel } from '@/components/game-design/GdLevelPanel';

const CELL = 26;
const LEVEL = {
  id: 'lvl_1', name: 'World 1-1', gameId: 'game_1', cols: 5, rows: 4,
  tileSize: 32, orientation: 'orthogonal',
  layers: [{ id: 'ly_1', name: 'Ground', kind: 'tile', visible: true, opacity: 1, tiles: new Array(20).fill(null) }],
};

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation((_domain: string, action: string) => {
    if (action === 'level-list') return ok({ levels: [{ id: 'lvl_1', name: 'World 1-1', cols: 5, rows: 4, layerCount: 1 }] });
    if (action === 'level-get') return ok({ level: LEVEL });
    if (action === 'tile-list') return ok({ all: [{ id: 'grass', name: 'Grass', color: '#4ade80', category: 'terrain' }], custom: [] });
    if (action === 'game-get') return ok({ entities: [] });
    if (action === 'autotile-rule-list') return ok({ rules: [] });
    return ok({});
  });

  // jsdom returns a zeroed rect by default; give the canvas a real box so
  // the panel's client->cell math (identical to the real paint handler's)
  // produces a deterministic cell.
  Element.prototype.getBoundingClientRect = vi.fn(() => ({
    left: 0, top: 0, width: LEVEL.cols * CELL, height: LEVEL.rows * CELL,
    right: LEVEL.cols * CELL, bottom: LEVEL.rows * CELL, x: 0, y: 0, toJSON() { return {}; },
  })) as unknown as typeof Element.prototype.getBoundingClientRect;
});
afterEach(() => { vi.clearAllMocks(); });

describe('GdLevelPanel — status bar', () => {
  it('shows the level size before any hover, then a live "Cell x, y" readout while hovering the canvas', async () => {
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<GdLevelPanel gameId="game_1" onChange={vi.fn()} />); });

    await waitFor(() => expect(view!.getByText('World 1-1')).toBeInTheDocument());
    await act(async () => { fireEvent.click(view!.getByText('Edit')); });

    await waitFor(() => expect(view!.container.querySelector('canvas')).toBeTruthy());
    expect(view!.getByText(/5×4 cells/)).toBeInTheDocument();

    const canvas = view!.container.querySelector('canvas')!;
    // jsdom has no PointerEvent constructor, so @testing-library/dom's
    // fireEvent.pointerMove falls back to a bare `Event` with no
    // clientX/clientY. Dispatch a real MouseEvent (which DOES carry
    // clientX/clientY per spec) under the "pointermove" type instead —
    // React's onPointerMove listens by native event-type string, so this
    // exercises the exact same handler with real coordinates.
    // Cell (2,1): clientX/Y inside that cell's box.
    await act(async () => {
      fireEvent(canvas, new MouseEvent('pointermove', {
        bubbles: true, cancelable: true, clientX: 2 * CELL + 5, clientY: 1 * CELL + 5,
      }));
    });

    await waitFor(() => expect(view!.getByText('Cell 2, 1')).toBeInTheDocument());
    expect(view!.queryByText(/5×4 cells/)).toBeNull();

    // A different pointer position updates the readout live (it's driven by
    // the real cursor position, not a one-time snapshot).
    await act(async () => {
      fireEvent(canvas, new MouseEvent('pointermove', {
        bubbles: true, cancelable: true, clientX: 0 * CELL + 5, clientY: 3 * CELL + 5,
      }));
    });
    await waitFor(() => expect(view!.getByText('Cell 0, 3')).toBeInTheDocument());
  });

  it('the status bar names the active layer and brush', async () => {
    let view: ReturnType<typeof render>;
    await act(async () => { view = render(<GdLevelPanel gameId="game_1" onChange={vi.fn()} />); });
    await waitFor(() => expect(view!.getByText('World 1-1')).toBeInTheDocument());
    await act(async () => { fireEvent.click(view!.getByText('Edit')); });
    await waitFor(() => expect(view!.container.querySelector('canvas')).toBeTruthy());

    expect(view!.getByText(/Ground \(tile\)/)).toBeInTheDocument();
    expect(view!.getByText('grass')).toBeInTheDocument();
  });
});
