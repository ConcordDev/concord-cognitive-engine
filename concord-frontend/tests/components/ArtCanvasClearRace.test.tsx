/**
 * GB-1538 / FIX-art-009 — the Studio gallery card showed a stroke after
 * the layer was cleared and the canvas was blank. Domain probe
 * (server/tests/art-layer-clear-count.test.js) proves the server actions
 * themselves are consistent: create → 2 strokes → clear → list reads 0.
 * The live path was a race in ArtCanvas: stroke commits are
 * fire-and-forget async, so a layer-clear clicked while a commit was
 * still in flight reached the server FIRST and the late commit
 * resurrected the stroke. This pin holds a commit open, clicks Clear,
 * and asserts layer-clear is not sent until the commit settles — the
 * canvas now serialises stroke mutations through one queue.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';

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

function firePointer(el: Element, type: 'pointerdown' | 'pointerup', clientX: number, clientY: number) {
  const evt = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  fireEvent(el, evt);
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
    .find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`button with text "${text}" not found`);
  return btn as HTMLButtonElement;
}

const EMPTY_ARTWORK = {
  id: 'art_1',
  title: 'Test Piece',
  width: 400,
  height: 300,
  background: '#ffffff',
  layers: [
    { id: 'layer_1', name: 'Layer 1', visible: true, opacity: 1, blendMode: 'normal', strokes: [] },
  ],
};

describe('ArtCanvas — clear waits for in-flight stroke commits (FIX-art-009)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('layer-clear is not sent while a stroke commit is in flight, then follows it', async () => {
    let resolveCommit!: (v: unknown) => void;
    const commitGate = new Promise((res) => { resolveCommit = res; });
    const order: string[] = [];
    lensRunMock.mockImplementation((_domain: string, name: string) => {
      if (name === 'artwork-get') return Promise.resolve({ data: { ok: true, result: { artwork: EMPTY_ARTWORK } } });
      if (name === 'brush-presets') return Promise.resolve({ data: { ok: true, result: { brushes: [], blendModes: ['normal'] } } });
      if (name === 'palette-list') return Promise.resolve({ data: { ok: true, result: { palettes: [] } } });
      if (name === 'guides-get') return Promise.resolve({ data: { ok: true, result: { guides: null, kinds: [] } } });
      if (name === 'stroke-commit' || name === 'stroke-commit-pressure') {
        order.push('commit-sent');
        return commitGate.then(() => { order.push('commit-settled'); return { data: { ok: true, result: { strokeId: 'stk_1', strokeCount: 1 } } }; });
      }
      if (name === 'layer-clear') { order.push('clear-sent'); return Promise.resolve({ data: { ok: true, result: {} } }); }
      return Promise.resolve({ data: { ok: false, error: 'unmocked: ' + name } });
    });

    const { container } = render(<ArtCanvas artworkId="art_1" onExit={() => undefined} />);
    await waitFor(() => getButtonByText(container, 'Clear'));

    const canvas = getCanvas(container, 400, 300);
    firePointer(canvas, 'pointerdown', 10, 10);
    firePointer(canvas, 'pointerup', 60, 60);

    // The commit has been issued and is still in flight.
    await waitFor(() => expect(order).toContain('commit-sent'));

    // Clear is enabled by the optimistic stroke; click it now.
    fireEvent.click(getButtonByText(container, 'Clear'));

    // Give any unqueued path a chance to fire — layer-clear must NOT be
    // sent while the commit is unsettled.
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
    expect(order).not.toContain('clear-sent');

    // Settle the commit; the clear must now follow, in order.
    resolveCommit(undefined);
    await waitFor(() => expect(order).toContain('clear-sent'));
    expect(order.indexOf('commit-settled')).toBeLessThan(order.indexOf('clear-sent'));
  });
});
