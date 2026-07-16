/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the fashion outfit collage-canvas panel (Wave 4 gap-closure,
// docs/lens-specs/fashion-capability-map.md item 5: "Visual drag-and-resize
// outfit collage canvas" — Whering "Dress Me" parity). Distinct from
// FashionOutfitsPanel's tag-select builder: this panel arranges an
// outfit's already-real items spatially on a canvas via drag (reposition)
// and a corner handle / arrow keys (resize), persisting every change
// through the real fashion.outfit-set-item-position macro — never a
// client-only position.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

import { FashionOutfitCollagePanel } from '@/components/fashion/FashionOutfitCollagePanel';

// jsdom doesn't implement the Pointer Events capture API the panel calls
// on pointerdown (`e.target.setPointerCapture`); stub it inert, matching
// the established pattern in tests/components/ArtCanvasSymmetryClipboard.test.tsx.
beforeAll(() => {
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = vi.fn() as unknown as (pointerId: number) => void;
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = vi.fn() as unknown as (pointerId: number) => void;
  }
});

// jsdom has no PointerEvent constructor, so fireEvent.pointerDown/Move/Up
// drop clientX/clientY. React's synthetic dispatch matches on the native
// event's `type` string, so a MouseEvent typed as a pointer event name
// carries real coordinates through — same technique as the ArtCanvas suite.
function firePointer(el: Element, type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY: number) {
  const evt = new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true });
  fireEvent(el, evt);
}

function stubRect(el: HTMLElement, width: number, height: number) {
  el.getBoundingClientRect = () => ({
    width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

const OUTFIT = { id: 'oft_1', name: 'Weekend fit', occasion: 'casual', itemIds: ['itm_1', 'itm_2'], itemNames: ['Tee', 'Jeans'], timesWorn: 0 };
const ITEMS = [
  { id: 'itm_1', name: 'Tee', category: 'top' },
  { id: 'itm_2', name: 'Jeans', category: 'bottom' },
];
const LAYOUT = [
  { itemId: 'itm_1', x: 40, y: 40, scale: 1, custom: false },
  { itemId: 'itm_2', x: 200, y: 40, scale: 1, custom: false },
];

function listResponse(outfits: Array<Record<string, unknown>> = []) {
  return { data: { ok: true, result: { outfits, count: outfits.length }, error: null } };
}
function detailResponse(items = ITEMS, layout = LAYOUT) {
  return { data: { ok: true, result: { outfit: OUTFIT, items, layout, totalCost: 0 }, error: null } };
}

async function openWeekendFit() {
  lensRun.mockResolvedValueOnce(listResponse([OUTFIT])).mockResolvedValueOnce(detailResponse());
  render(<FashionOutfitCollagePanel />);
  await screen.findByTestId('collage-outfit-oft_1');
  fireEvent.click(screen.getByText('Weekend fit'));
  const board = await screen.findByTestId('collage-canvas');
  stubRect(board, 640, 420);
  return board;
}

describe('FashionOutfitCollagePanel', () => {
  beforeEach(() => lensRun.mockReset());

  it('loads via outfit-list and renders outfit cards', async () => {
    lensRun.mockResolvedValueOnce(listResponse([OUTFIT]));
    render(<FashionOutfitCollagePanel />);
    await screen.findByTestId('collage-outfit-oft_1');
    expect(screen.getByText('Weekend fit')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('fashion', 'outfit-list', {});
  });

  it('an empty outfit list renders an honest empty state, not a fabricated canvas', async () => {
    lensRun.mockResolvedValueOnce(listResponse([]));
    render(<FashionOutfitCollagePanel />);
    await waitFor(() => expect(screen.getByText(/No outfits yet/)).toBeInTheDocument());
  });

  it('opens an outfit and renders its items on the canvas at their real layout positions', async () => {
    await openWeekendFit();
    const card1 = screen.getByTestId('collage-item-itm_1');
    expect(card1).toHaveStyle({ left: '40px', top: '40px' });
    expect(screen.getByText('Tee')).toBeInTheDocument();
    expect(screen.getByText('Jeans')).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('fashion', 'outfit-detail', { id: 'oft_1' });
  });

  it('dragging an item updates its position live and persists via outfit-set-item-position', async () => {
    const board = await openWeekendFit();
    const card = screen.getByTestId('collage-item-itm_1');

    lensRun.mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          outfitId: 'oft_1',
          item: { itemId: 'itm_1', x: 150, y: 90, scale: 1 },
          layout: [{ itemId: 'itm_1', x: 150, y: 90, scale: 1, custom: true }, LAYOUT[1]],
        },
        error: null,
      },
    });

    firePointer(card, 'pointerdown', 40, 40); // grabbed at its own top-left corner: offset (0,0)
    firePointer(board, 'pointermove', 150, 90); // live update during the gesture
    expect(card).toHaveStyle({ left: '150px', top: '90px' });
    firePointer(board, 'pointerup', 150, 90); // commit

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('fashion', 'outfit-set-item-position', { id: 'oft_1', itemId: 'itm_1', x: 150, y: 90 }),
    );
  });

  it('drag position is clamped to the visible canvas client-side', async () => {
    const board = await openWeekendFit();
    const card = screen.getByTestId('collage-item-itm_1');
    lensRun.mockResolvedValueOnce({
      data: { ok: true, result: { outfitId: 'oft_1', item: { itemId: 'itm_1', x: 640, y: 0, scale: 1 }, layout: [{ itemId: 'itm_1', x: 640, y: 0, scale: 1, custom: true }, LAYOUT[1]] }, error: null },
    });

    firePointer(card, 'pointerdown', 40, 40);
    firePointer(board, 'pointermove', 99999, -500); // way outside the canvas
    expect(card).toHaveStyle({ left: '640px', top: '0px' });
    firePointer(board, 'pointerup', 99999, -500);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('fashion', 'outfit-set-item-position', { id: 'oft_1', itemId: 'itm_1', x: 640, y: 0 }),
    );
  });

  it('dragging the resize handle updates scale live and persists it', async () => {
    const board = await openWeekendFit();
    const handle = screen.getByTestId('resize-handle-itm_1');
    const card = screen.getByTestId('collage-item-itm_1');

    lensRun.mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          outfitId: 'oft_1',
          item: { itemId: 'itm_1', x: 40, y: 40, scale: 1.5 },
          layout: [{ itemId: 'itm_1', x: 40, y: 40, scale: 1.5, custom: true }, LAYOUT[1]],
        },
        error: null,
      },
    });

    firePointer(handle, 'pointerdown', 0, 0);
    firePointer(board, 'pointermove', 60, 0); // +60px == +0.5 scale at BASE_SIZE 120
    expect(card).toHaveStyle({ width: '180px', height: '180px' }); // 120 * 1.5
    firePointer(board, 'pointerup', 60, 0);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('fashion', 'outfit-set-item-position', { id: 'oft_1', itemId: 'itm_1', scale: 1.5 }),
    );
  });

  it('resize handle drag never exceeds the scale bounds', async () => {
    const board = await openWeekendFit();
    const handle = screen.getByTestId('resize-handle-itm_1');
    lensRun.mockResolvedValueOnce({
      data: { ok: true, result: { outfitId: 'oft_1', item: { itemId: 'itm_1', x: 40, y: 40, scale: 2 }, layout: [{ itemId: 'itm_1', x: 40, y: 40, scale: 2, custom: true }, LAYOUT[1]] }, error: null },
    });

    firePointer(handle, 'pointerdown', 0, 0);
    firePointer(board, 'pointermove', 99999, 0); // huge drag, must clamp to SCALE_MAX
    firePointer(board, 'pointerup', 99999, 0);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('fashion', 'outfit-set-item-position', { id: 'oft_1', itemId: 'itm_1', scale: 2 }),
    );
  });

  it('the resize handle is keyboard-operable (arrow keys) and persists', async () => {
    await openWeekendFit();
    const handle = screen.getByTestId('resize-handle-itm_1');
    lensRun.mockResolvedValueOnce({
      data: {
        ok: true,
        result: { outfitId: 'oft_1', item: { itemId: 'itm_1', x: 40, y: 40, scale: 1.1 }, layout: [{ itemId: 'itm_1', x: 40, y: 40, scale: 1.1, custom: true }, LAYOUT[1]] },
        error: null,
      },
    });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('fashion', 'outfit-set-item-position', { id: 'oft_1', itemId: 'itm_1', scale: 1.1 }),
    );
  });

  it('surfaces an honest error on a failed position save instead of silently keeping it', async () => {
    await openWeekendFit();
    const handle = screen.getByTestId('resize-handle-itm_1');
    lensRun.mockResolvedValueOnce({ data: { ok: false, result: null, error: 'outfit not found' } });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    expect(await screen.findByRole('alert')).toHaveTextContent('outfit not found');
  });

  it('surfaces an honest error on a failed outfit-detail load', async () => {
    lensRun.mockResolvedValueOnce(listResponse([OUTFIT])).mockResolvedValueOnce({ data: { ok: false, result: null, error: 'outfit not found' } });
    render(<FashionOutfitCollagePanel />);
    await screen.findByTestId('collage-outfit-oft_1');
    fireEvent.click(screen.getByText('Weekend fit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('outfit not found');
  });
});
