/**
 * StudyCanvas — the real drawing medium behind Artistry's F2 Kleki-floor
 * fix. Covers: a stroke, per-layer undo, add/toggle layers, and the
 * composite-and-upload save path returning an artistry-img: ref through
 * the existing artistry.project-image-upload macro.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

const { lensRun } = vi.hoisted(() => ({ lensRun: vi.fn() }));
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { StudyCanvas } from '@/components/artistry/StudyCanvas';

function fake2d() {
  const fn = () => {};
  return new Proxy({ getImageData: () => ({ data: new Uint8ClampedArray(4) }) }, {
    get(target, prop) {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
      return fn;
    },
    set() { return true; },
  });
}

beforeEach(() => {
  lensRun.mockReset();
  HTMLCanvasElement.prototype.getContext = (() => fake2d()) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,xx';
  HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 640, bottom: 440, width: 640, height: 440, x: 0, y: 0, toJSON() { return {}; },
  });
});

describe('StudyCanvas', () => {
  it('opens as a dialog with one layer and an initially-disabled undo', () => {
    const view = render(<StudyCanvas onSaved={vi.fn()} onClose={vi.fn()} />);
    expect(view.getByTestId('study-canvas')).toBeInTheDocument();
    expect(view.getByRole('dialog', { name: 'Draw a new study' })).toBeInTheDocument();
    expect(view.getByTestId('study-canvas-undo')).toBeDisabled();
    expect(view.getByTestId('study-canvas-layer-layer-1')).toBeInTheDocument();
  });

  it('a stroke enables undo, and undo re-disables it', () => {
    const view = render(<StudyCanvas onSaved={vi.fn()} onClose={vi.fn()} />);
    const canvas = view.getByTestId('study-canvas-layer-layer-1');
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(canvas);
    expect(view.getByTestId('study-canvas-undo')).toBeEnabled();
    fireEvent.click(view.getByTestId('study-canvas-undo'));
    expect(view.getByTestId('study-canvas-undo')).toBeDisabled();
  });

  it('adds a layer, switches the active one, and can toggle its visibility', () => {
    const view = render(<StudyCanvas onSaved={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(view.getByTestId('study-canvas-add-layer'));
    expect(view.getByTestId(/study-canvas-select-layer-2-/)).toBeInTheDocument();
    const secondLayerSelect = view.getByText('Layer 2');
    fireEvent.click(secondLayerSelect);
    const toggle = view.getAllByTestId(/study-canvas-toggle-/)[1];
    fireEvent.click(toggle);
    expect(view.getByLabelText('Toggle Layer 2 visibility')).toBeInTheDocument();
  });

  it('color and brush-size controls update their inputs', () => {
    const view = render(<StudyCanvas onSaved={vi.fn()} onClose={vi.fn()} />);
    const colorInput = view.getByTestId('study-canvas-color') as HTMLInputElement;
    fireEvent.change(colorInput, { target: { value: '#ff0000' } });
    expect(colorInput.value).toBe('#ff0000');
    const sizeInput = view.getByTestId('study-canvas-size') as HTMLInputElement;
    fireEvent.change(sizeInput, { target: { value: '22' } });
    expect(sizeInput.value).toBe('22');
  });

  it('SAVE: composites, rasterizes, uploads via project-image-upload, and bubbles the ref up', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { image: { ref: 'artistry-img:drw_1' } }, error: null } });
    const onSaved = vi.fn();
    const view = render(<StudyCanvas onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.click(view.getByTestId('study-canvas-save'));
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [ref, fileName] = onSaved.mock.calls[0];
    expect(ref).toBe('artistry-img:drw_1');
    expect(fileName).toMatch(/^study-drawing-\d+\.png$/);
    const call = lensRun.mock.calls[0];
    expect(call[0]).toBe('artistry');
    expect(call[1]).toBe('project-image-upload');
    expect(call[2]).toMatchObject({ mimeType: 'image/png', data: 'data:image/png;base64,xx' });
  });

  it('SAVE: a refused upload surfaces role=alert and does not call onSaved', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, result: null, error: 'image_too_large' } });
    const onSaved = vi.fn();
    const view = render(<StudyCanvas onSaved={onSaved} onClose={vi.fn()} />);
    fireEvent.click(view.getByTestId('study-canvas-save'));
    expect(await view.findByRole('alert')).toHaveTextContent(/image_too_large/);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('CLOSE: the X button and Escape call onClose; a backdrop click does NOT (F5 — no backdrop dismissal)', () => {
    const onClose = vi.fn();
    const view = render(<StudyCanvas onSaved={vi.fn()} onClose={onClose} />);
    fireEvent.click(view.getByLabelText('Close drawing tool'));
    expect(onClose).toHaveBeenCalledTimes(1);
    const dialog = view.getByTestId('study-canvas');
    // A backdrop click must not dismiss unsaved work.
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
