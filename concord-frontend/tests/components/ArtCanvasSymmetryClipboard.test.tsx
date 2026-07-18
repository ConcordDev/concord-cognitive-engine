/**
 * WAVE4_INVENTORY closure — art.symmetry-mirror-stroke and art.stroke-batch
 * were real, working backend macros with no frontend caller (docs/lens-specs/
 * art-capability-map.md's own "deferred rather than half-built" / "genuinely
 * missing" findings). Both macros are wired now:
 *
 *  - ArtCanvas's commit() calls art.symmetry-mirror-stroke with the real
 *    committed strokeId whenever a mirror-shaped guide (vertical/horizontal/
 *    quadrant/radial) is active, then reloads so the persisted mirrors render.
 *  - A Copy/Paste flow serializes the selected strokes and posts them through
 *    art.stroke-batch on paste, offset so the pasted copies are visually
 *    distinct from the originals.
 *
 * This suite pins: guide-active commits DO call symmetry-mirror-stroke with
 * the right strokeId; guide-off commits do NOT (no wasted round-trip); and
 * copy-then-paste produces a real stroke-batch call with the serialized,
 * offset stroke data.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { ArtCanvas } from '@/components/art/ArtCanvas';

// jsdom has no real canvas 2D context (no `canvas` npm package installed);
// ArtCanvas already null-checks getContext('2d') and early-returns from its
// draw paths, so stubbing it to null keeps the run clean. Pattern matches
// tests/components/whiteboard-canvas-vote-click.test.tsx.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // jsdom doesn't implement the Pointer Events capture API ArtCanvas's
  // onPointerDown calls (`e.currentTarget.setPointerCapture`); a bare no-op
  // stub is enough since no assertion here depends on real capture behavior.
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = vi.fn() as unknown as (pointerId: number) => void;
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = vi.fn() as unknown as (pointerId: number) => void;
  }
});

// jsdom has no PointerEvent constructor, so @testing-library/react's
// fireEvent.pointerDown/Up fall back to a bare `Event` that drops clientX/
// clientY/pointerId entirely. Dispatching a real MouseEvent typed as the
// pointer event name gives React's synthetic-event dispatch (which matches
// on the `type` string, not the constructor) real clientX/clientY while the
// pointer-only fields (pressure, pointerType, pointerId) read back
// `undefined` — which is exactly the "not a pen, flat pressure" default path
// ArtCanvas already handles for mouse input.
function firePointer(el: Element, type: 'pointerdown' | 'pointerup', clientX: number, clientY: number) {
  const evt = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  fireEvent(el, evt);
}

function getCanvas(container: HTMLElement, width: number, height: number): HTMLCanvasElement {
  const canvas = container.querySelector('canvas')!;
  // jsdom's default getBoundingClientRect is an all-zero rect, which makes
  // ArtCanvas's toPoint() divide by a zero width/height. Give it a real,
  // artwork-matching rect (scale factor 1:1) so pointer coordinates map
  // predictably onto canvas coordinates for the selection hit-test.
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

const SEED_STROKE = {
  id: 'stk_seed', kind: 'stroke', tool: 'ink', color: '#111111', size: 6, opacity: 1,
  points: [[10, 10], [20, 20]],
};
const ARTWORK_WITH_STROKE = {
  ...EMPTY_ARTWORK,
  layers: [
    { id: 'layer_1', name: 'Layer 1', visible: true, opacity: 1, blendMode: 'normal', strokes: [SEED_STROKE] },
  ],
};

function baseImpl(artwork: typeof EMPTY_ARTWORK, guideKind: string) {
  return (_domain: string, name: string) => {
    if (name === 'artwork-get') return Promise.resolve({ data: { ok: true, result: { artwork } } });
    if (name === 'brush-presets') return Promise.resolve({ data: { ok: true, result: { brushes: [], blendModes: ['normal'] } } });
    if (name === 'palette-list') return Promise.resolve({ data: { ok: true, result: { palettes: [] } } });
    if (name === 'guides-get') return Promise.resolve({ data: { ok: true, result: { guides: { kind: guideKind, cx: 200, cy: 150 }, kinds: [] } } });
    return Promise.resolve({ data: { ok: false, error: 'unmocked: ' + name } });
  };
}

describe('ArtCanvas — symmetry-mirror-stroke wiring', () => {
  beforeEach(() => { lensRunMock.mockReset(); });

  it('committing a stroke while a symmetry guide is active calls symmetry-mirror-stroke with the real strokeId', async () => {
    lensRunMock.mockImplementation((domain: string, name: string, params?: unknown) => {
      if (name === 'stroke-commit') return Promise.resolve({ data: { ok: true, result: { strokeId: 'stk_new_1', strokeCount: 1 } } });
      if (name === 'symmetry-mirror-stroke') return Promise.resolve({ data: { ok: true, result: { mirrored: 1, strokeCount: 2 } } });
      return baseImpl(EMPTY_ARTWORK, 'vertical')(domain, name, params);
    });

    const { container } = render(<ArtCanvas artworkId="art_1" onExit={() => undefined} />);
    await waitFor(() => getButtonByText(container, 'Line'));
    fireEvent.click(getButtonByText(container, 'Line'));

    const canvas = getCanvas(container, 400, 300);
    firePointer(canvas, 'pointerdown', 10, 10);
    firePointer(canvas, 'pointerup', 100, 100);

    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'symmetry-mirror-stroke');
      expect(call).toBeTruthy();
      expect(call?.[2]).toMatchObject({ artworkId: 'art_1', layerId: 'layer_1', strokeId: 'stk_new_1' });
    });

    // The stroke actually committed through stroke-commit first.
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'stroke-commit')).toBe(true);
  });

  it('committing without an active guide does NOT call symmetry-mirror-stroke (no wasted round-trip)', async () => {
    lensRunMock.mockImplementation((domain: string, name: string, params?: unknown) => {
      if (name === 'stroke-commit') return Promise.resolve({ data: { ok: true, result: { strokeId: 'stk_new_2', strokeCount: 1 } } });
      return baseImpl(EMPTY_ARTWORK, 'off')(domain, name, params);
    });

    const { container } = render(<ArtCanvas artworkId="art_1" onExit={() => undefined} />);
    await waitFor(() => getButtonByText(container, 'Line'));
    fireEvent.click(getButtonByText(container, 'Line'));

    const canvas = getCanvas(container, 400, 300);
    firePointer(canvas, 'pointerdown', 10, 10);
    firePointer(canvas, 'pointerup', 100, 100);

    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'stroke-commit')).toBe(true);
    });
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'symmetry-mirror-stroke')).toBe(false);
  });

  it('a perspective guide (not a mirror axis) also does NOT call symmetry-mirror-stroke', async () => {
    lensRunMock.mockImplementation((domain: string, name: string, params?: unknown) => {
      if (name === 'stroke-commit') return Promise.resolve({ data: { ok: true, result: { strokeId: 'stk_new_3', strokeCount: 1 } } });
      return baseImpl(EMPTY_ARTWORK, 'perspective-1pt')(domain, name, params);
    });

    const { container } = render(<ArtCanvas artworkId="art_1" onExit={() => undefined} />);
    await waitFor(() => getButtonByText(container, 'Line'));
    fireEvent.click(getButtonByText(container, 'Line'));

    const canvas = getCanvas(container, 400, 300);
    firePointer(canvas, 'pointerdown', 10, 10);
    firePointer(canvas, 'pointerup', 100, 100);

    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'stroke-commit')).toBe(true);
    });
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'symmetry-mirror-stroke')).toBe(false);
  });
});

describe('ArtCanvas — copy/paste via stroke-batch', () => {
  beforeEach(() => { lensRunMock.mockReset(); });

  it('copy-select-paste produces a real stroke-batch call with the serialized, offset strokes', async () => {
    lensRunMock.mockImplementation((domain: string, name: string, params?: unknown) => {
      if (name === 'stroke-batch') return Promise.resolve({ data: { ok: true, result: { added: 1, strokeCount: 2 } } });
      return baseImpl(ARTWORK_WITH_STROKE, 'off')(domain, name, params);
    });

    const { container } = render(<ArtCanvas artworkId="art_1" onExit={() => undefined} />);
    await waitFor(() => getButtonByText(container, 'Select'));
    fireEvent.click(getButtonByText(container, 'Select'));

    const canvas = getCanvas(container, 400, 300);
    // Marquee from (0,0) to (50,50) — the seed stroke's bbox is [10,10,10,10],
    // which intersects it.
    firePointer(canvas, 'pointerdown', 0, 0);
    firePointer(canvas, 'pointerup', 50, 50);

    await waitFor(() => getButtonByText(container, 'Copy'));
    fireEvent.click(getButtonByText(container, 'Copy'));

    const pasteBtn = await waitFor(() => {
      const btn = getButtonByText(container, 'Paste');
      expect(btn.disabled).toBe(false);
      return btn;
    });
    fireEvent.click(pasteBtn);

    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'stroke-batch');
      expect(call).toBeTruthy();
      expect(call?.[2]).toMatchObject({
        artworkId: 'art_1',
        layerId: 'layer_1',
        strokes: [
          expect.objectContaining({
            id: 'stk_seed', kind: 'stroke', tool: 'ink', color: '#111111', size: 6, opacity: 1,
            points: [[34, 34], [44, 44]],
          }),
        ],
      });
    });
  });

  it('Paste is disabled with an empty clipboard (no wasted call)', async () => {
    lensRunMock.mockImplementation((domain: string, name: string, params?: unknown) => baseImpl(ARTWORK_WITH_STROKE, 'off')(domain, name, params));

    const { container } = render(<ArtCanvas artworkId="art_1" onExit={() => undefined} />);
    await waitFor(() => getButtonByText(container, 'Paste'));
    const pasteBtn = getButtonByText(container, 'Paste');
    expect(pasteBtn.disabled).toBe(true);

    fireEvent.click(pasteBtn);
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'stroke-batch')).toBe(false);
  });
});
