/**
 * AnimStudio — cross-operation undo/redo, closing docs/WAVE4_INVENTORY.md's
 * "No full cross-operation undo/redo stack (only single-level per-layer
 * stroke undo)" row (animation-capability-map.md item 19).
 *
 * Pins:
 *   1. The Redo button's enabled/disabled state is driven by real backend
 *      responses (`canRedo` from anim-get / anim-undo / anim-redo) — never
 *      fabricated as always-on or always-off.
 *   2. A structural edit (frame-add) routes the Undo button to the real
 *      cross-operation primitive `anim-undo` (not the narrower per-stroke
 *      `anim-stroke-undo`), and a successful undo with `canRedo: true`
 *      enables Redo.
 *   3. Clicking Redo calls `anim-redo`, and a disabled Redo button
 *      (canRedo: false) never fires the macro at all.
 *   4. Drawing a stroke still routes Undo to the pre-existing, narrower
 *      `anim-stroke-undo` primitive — the new op-log doesn't swallow it.
 *
 * No fabricated data: every assertion is driven by a mocked lensRun()
 * returning exactly the shapes server/domains/animation.js's macros return.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { AnimStudio } from '@/components/animation/AnimStudio';

beforeAll(() => {
  // jsdom has no real 2D canvas context; AnimStudio already null-checks
  // getContext('2d') and no-ops its draw effect (same pattern as
  // tests/components/whiteboard-canvas-vote-click.test.tsx and
  // tests/components/ArtCanvasSymmetryClipboard.test.tsx).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // jsdom doesn't implement the Pointer Events capture API onPointerDown
  // calls (`e.currentTarget.setPointerCapture`); a bare no-op stub is
  // enough since no assertion here depends on real capture behavior.
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = vi.fn() as unknown as (pointerId: number) => void;
  }
});

// jsdom has no PointerEvent constructor, so fireEvent.pointerDown/Up fall
// back to a bare Event that drops clientX/clientY entirely. A MouseEvent
// typed as the pointer event name works because React's synthetic-event
// dispatch matches on the `type` string, not the constructor (same
// technique as ArtCanvasSymmetryClipboard.test.tsx).
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

function getButtonByLabel(text: string | RegExp): HTMLButtonElement {
  return screen.getByRole('button', { name: text }) as HTMLButtonElement;
}

const LAYER = { id: 'lyr_1', name: 'Layer 1', visible: true, opacity: 1, type: 'paintable' as const, strokes: [] };
const FRAME = { id: 'frm_1', exposure: 1, layers: [LAYER] };
const BASE_ANIM = {
  id: 'anm_1', title: 'Undo Test', width: 200, height: 100, fps: 12, background: '#ffffff',
  frames: [FRAME],
};

function ok<T>(result: T) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

describe('AnimStudio — cross-operation undo/redo', () => {
  beforeEach(() => { lensRunMock.mockReset(); });

  it('Redo starts disabled when anim-get reports canRedo:false (fresh session, nothing to redo)', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'anim-get') return ok({ animation: BASE_ANIM, canUndo: false, canRedo: false });
      if (action === 'playback-frames') return ok({ totalFrames: 1, durationSec: 0.08 });
      if (action === 'brush-list') return ok({ brushes: [] });
      return ok({});
    });
    render(<AnimStudio animId="anm_1" onExit={() => {}} />);
    await screen.findByText('Undo Test');
    expect(getButtonByLabel(/^redo$/i)).toBeDisabled();
  });

  it('Redo starts ENABLED when anim-get reports canRedo:true (resumed session with real pending history)', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'anim-get') return ok({ animation: BASE_ANIM, canUndo: true, canRedo: true });
      if (action === 'playback-frames') return ok({ totalFrames: 1, durationSec: 0.08 });
      if (action === 'brush-list') return ok({ brushes: [] });
      return ok({});
    });
    render(<AnimStudio animId="anm_1" onExit={() => {}} />);
    await screen.findByText('Undo Test');
    await waitFor(() => expect(getButtonByLabel(/^redo$/i)).not.toBeDisabled());
  });

  it('clicking Redo while disabled never calls anim-redo', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'anim-get') return ok({ animation: BASE_ANIM, canUndo: false, canRedo: false });
      if (action === 'playback-frames') return ok({ totalFrames: 1, durationSec: 0.08 });
      if (action === 'brush-list') return ok({ brushes: [] });
      return ok({});
    });
    render(<AnimStudio animId="anm_1" onExit={() => {}} />);
    await screen.findByText('Undo Test');
    const redoBtn = getButtonByLabel(/^redo$/i);
    expect(redoBtn).toBeDisabled();
    fireEvent.click(redoBtn);
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'anim-redo')).toBe(false);
  });

  it('a structural edit (frame-add) routes Undo to anim-undo, not anim-stroke-undo, and enables Redo on success', async () => {
    const NEW_FRAME = { id: 'frm_2', exposure: 1, layers: [{ ...LAYER, id: 'lyr_2', strokes: [] }] };
    let getCallCount = 0;
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'anim-get') {
        getCallCount += 1;
        // First load: fresh, nothing to undo/redo. Reload after undo below
        // reflects the real post-undo animation (back to 1 frame).
        return ok({
          animation: getCallCount === 1 ? BASE_ANIM : BASE_ANIM,
          canUndo: false, canRedo: false,
        });
      }
      if (action === 'playback-frames') return ok({ totalFrames: 1, durationSec: 0.08 });
      if (action === 'brush-list') return ok({ brushes: [] });
      if (action === 'frame-add') return ok({ frame: NEW_FRAME, index: 1 });
      if (action === 'anim-undo') return ok({ undone: 'frame-add', frameCount: 1, canUndo: false, canRedo: true });
      return ok({});
    });

    render(<AnimStudio animId="anm_1" onExit={() => {}} />);
    await screen.findByText('Undo Test');

    // Add a frame — a real structural edit.
    fireEvent.click(getButtonByLabel(/^frame$/i));
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'frame-add')).toBe(true));

    // Now Undo should call the cross-operation primitive, not the stroke one.
    fireEvent.click(getButtonByLabel(/^undo$/i));
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'anim-undo')).toBe(true));
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'anim-stroke-undo')).toBe(false);

    // The undo response reported canRedo:true — Redo should now be enabled.
    await waitFor(() => expect(getButtonByLabel(/^redo$/i)).not.toBeDisabled());
  });

  it('clicking Redo after a structural undo calls anim-redo', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'anim-get') return ok({ animation: BASE_ANIM, canUndo: false, canRedo: true });
      if (action === 'playback-frames') return ok({ totalFrames: 1, durationSec: 0.08 });
      if (action === 'brush-list') return ok({ brushes: [] });
      if (action === 'anim-redo') return ok({ redone: 'frame-add', frameCount: 2, canUndo: true, canRedo: false });
      return ok({});
    });

    render(<AnimStudio animId="anm_1" onExit={() => {}} />);
    await screen.findByText('Undo Test');
    const redoBtn = await waitFor(() => {
      const btn = getButtonByLabel(/^redo$/i);
      expect(btn).not.toBeDisabled();
      return btn;
    });

    fireEvent.click(redoBtn);
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'anim-redo')).toBe(true));
    // A new (re-applied) structural op clears the redo stack again.
    await waitFor(() => expect(getButtonByLabel(/^redo$/i)).toBeDisabled());
  });

  it('drawing a stroke still routes Undo to the pre-existing anim-stroke-undo primitive, not anim-undo', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'anim-get') return ok({ animation: BASE_ANIM, canUndo: false, canRedo: false });
      if (action === 'playback-frames') return ok({ totalFrames: 1, durationSec: 0.08 });
      if (action === 'brush-list') return ok({ brushes: [] });
      if (action === 'anim-stroke-commit') return ok({ strokeId: 'stk_1', layerId: 'lyr_1', strokeCount: 1 });
      return ok({});
    });

    const { container } = render(<AnimStudio animId="anm_1" onExit={() => {}} />);
    await screen.findByText('Undo Test');

    const canvas = getCanvas(container, 200, 100);
    firePointer(canvas, 'pointerdown', 10, 10);
    firePointer(canvas, 'pointerup', 50, 50);
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'anim-stroke-commit')).toBe(true));

    fireEvent.click(getButtonByLabel(/^undo$/i));
    await waitFor(() => expect(lensRunMock.mock.calls.some((c) => c[1] === 'anim-stroke-undo')).toBe(true));
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'anim-undo')).toBe(false);
    // Stroke undo never touches the structural redo stack.
    expect(getButtonByLabel(/^redo$/i)).toBeDisabled();
  });
});
