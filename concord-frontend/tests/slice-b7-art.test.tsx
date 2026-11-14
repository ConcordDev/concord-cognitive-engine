/**
 * Slice B7 — FIX-art-008: a selection can MOVE the marks it contains
 * (drag them on the canvas — the commit rides the ids-aware
 * layer-transform verb) and the selected marks are listed by name in
 * the selection toolbar, not just counted. Delete already rode
 * element-delete from the same toolbar.
 *
 * Harness mirrors tests/components/ArtCanvasSymmetryClipboard.test.tsx
 * (null 2D context, MouseEvent-typed pointer events, 1:1 canvas rect).
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ArtCanvas } from '@/components/art/ArtCanvas';

beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = vi.fn() as unknown as (pointerId: number) => void;
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = vi.fn() as unknown as (pointerId: number) => void;
  }
});

function firePointer(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY: number) {
  fireEvent(el, new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true }));
}

function getCanvas(container: HTMLElement, width: number, height: number): HTMLCanvasElement {
  const canvas = container.querySelector('canvas')!;
  canvas.getBoundingClientRect = () => ({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  return canvas;
}

function getButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button'))
    .find((b) => b.textContent?.trim() === text || b.textContent?.trim().startsWith(text));
  if (!btn) throw new Error(`button with text "${text}" not found`);
  return btn as HTMLButtonElement;
}

const ARTWORK = {
  id: 'art_1', title: 'Test Piece', width: 400, height: 300, background: '#ffffff',
  layers: [{
    id: 'layer_1', name: 'Layer 1', visible: true, opacity: 1, blendMode: 'normal',
    strokes: [
      { id: 'stk_a', kind: 'stroke', tool: 'ink', color: '#111111', size: 6, opacity: 1, points: [[10, 10], [20, 20]] },
      { id: 'stk_b', kind: 'stroke', tool: 'pencil', color: '#222222', size: 3, opacity: 1, points: [[200, 200], [220, 220]] },
    ],
  }],
};

function baseImpl() {
  return (_domain: string, name: string) => {
    if (name === 'artwork-get') return Promise.resolve({ data: { ok: true, result: { artwork: ARTWORK } } });
    if (name === 'brush-presets') return Promise.resolve({ data: { ok: true, result: { brushes: [], blendModes: ['normal'] } } });
    if (name === 'palette-list') return Promise.resolve({ data: { ok: true, result: { palettes: [] } } });
    if (name === 'guides-get') return Promise.resolve({ data: { ok: true, result: { guides: { kind: 'off', cx: 200, cy: 150 }, kinds: [] } } });
    if (name === 'layer-transform') return Promise.resolve({ data: { ok: true, result: { transformed: 1 } } });
    return Promise.resolve({ data: { ok: false, error: 'unmocked: ' + name } });
  };
}

describe('FIX-art-008 selection move + mark list', () => {
  beforeEach(() => { lensRunMock.mockReset(); lensRunMock.mockImplementation(baseImpl()); });

  it('marquee-select lists the mark, and dragging it commits layer-transform with its id and the drag delta', async () => {
    const { container } = render(<ArtCanvas artworkId="art_1" onExit={() => undefined} />);
    await waitFor(() => getButtonByText(container, 'Select'));
    fireEvent.click(getButtonByText(container, 'Select'));

    const canvas = getCanvas(container, 400, 300);
    // Marquee around stk_a only.
    firePointer(canvas, 'pointerdown', 5, 5);
    firePointer(canvas, 'pointerup', 30, 30);
    expect(await screen.findByText('1 selected')).toBeTruthy();
    // The mark is listed by name (its tool), not just counted.
    expect(screen.getByText('ink')).toBeTruthy();

    // Drag from inside the selected mark: pointer down on it, move, up.
    firePointer(canvas, 'pointerdown', 15, 15);
    firePointer(canvas, 'pointermove', 55, 60);
    firePointer(canvas, 'pointerup', 55, 60);

    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'layer-transform');
      expect(call).toBeTruthy();
      expect(call?.[2]).toMatchObject({ artworkId: 'art_1', layerId: 'layer_1', dx: 40, dy: 45, scale: 1, ids: ['stk_a'] });
    });
  });

  it('a chip × drops that mark from the selection', async () => {
    const { container } = render(<ArtCanvas artworkId="art_1" onExit={() => undefined} />);
    await waitFor(() => getButtonByText(container, 'Select'));
    fireEvent.click(getButtonByText(container, 'Select'));
    const canvas = getCanvas(container, 400, 300);
    firePointer(canvas, 'pointerdown', 5, 5);
    firePointer(canvas, 'pointerup', 30, 30);
    expect(await screen.findByText('1 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove ink from selection' }));
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
  });
});
