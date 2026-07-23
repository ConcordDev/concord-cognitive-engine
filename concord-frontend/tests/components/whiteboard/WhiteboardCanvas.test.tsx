/**
 * WhiteboardCanvas — R1-2 wave 3 premium pass.
 *
 * Two real, previously-missing behaviors:
 *
 *   1. Pan. The "Reset view" button has always reset `pan` to {0,0}, but
 *      nothing could ever move it away from {0,0} — no drag-to-pan or
 *      wheel-to-pan gesture existed anywhere in the component. Fixed:
 *      Space+drag (or middle-mouse-drag) pans, and a plain wheel/trackpad
 *      scroll pans too; Ctrl/Cmd+wheel zooms toward the cursor. This test
 *      proves the pan value is real and load-bearing by dragging, then
 *      double-clicking a known shape at its *panned* screen position and
 *      confirming both the hit-test (world-space) and the sticky editor's
 *      on-screen position (screen-space) agree with the new pan.
 *   2. Inline sticky-note editing. `window.prompt` (a native dialog no
 *      reference whiteboard app uses) is replaced with an in-canvas
 *      textarea, matching Figma/FigJam's edit-immediately idiom. An
 *      untouched/blank note is dropped rather than left as clutter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';

import { WhiteboardCanvas, type Shape } from '@/components/whiteboard/WhiteboardCanvas';

let originalRAF: typeof window.requestAnimationFrame;
let originalCAF: typeof window.cancelAnimationFrame;

beforeEach(() => {
  originalRAF = window.requestAnimationFrame;
  originalCAF = window.cancelAnimationFrame;
  window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = vi.fn() as unknown as typeof window.cancelAnimationFrame;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    setTransform: vi.fn(),
    canvas: { width: 600, height: 400 },
  })) as typeof HTMLCanvasElement.prototype.getContext;
});

afterEach(() => {
  window.requestAnimationFrame = originalRAF;
  window.cancelAnimationFrame = originalCAF;
});

const STICKY: Shape = { id: 'sticky-1', kind: 'sticky', x: 50, y: 50, w: 120, h: 80, text: 'existing note', color: '#fef08a' };

describe('WhiteboardCanvas — pan', () => {
  it('Space+drag moves the pan, and the new pan is used consistently by both hit-testing and on-screen rendering', () => {
    const { container } = render(<WhiteboardCanvas initialShapes={[STICKY]} />);
    const canvas = container.querySelector('canvas')!;

    // Hold Space, drag by (40, 25).
    fireEvent.keyDown(window, { code: 'Space' });
    fireEvent.mouseDown(canvas, { clientX: 300, clientY: 300 });
    fireEvent.mouseMove(canvas, { clientX: 340, clientY: 325 });
    fireEvent.mouseUp(canvas);
    fireEvent.keyUp(window, { code: 'Space' });

    // The sticky sits at world (50,50)-(170,130). With pan now (40,25),
    // its on-screen box is (90,75)-(210,155). A double-click at screen
    // (100,90) maps back to world (60,65) — inside the sticky.
    fireEvent.doubleClick(canvas, { clientX: 100, clientY: 90 });

    const editor = screen.getByPlaceholderText('Type a note…') as HTMLTextAreaElement;
    expect(editor.value).toBe('existing note');
    expect(editor.style.left).toBe('90px');
    expect(editor.style.top).toBe('75px');
  });

  it('a plain wheel scroll (no modifier) pans instead of zooming', () => {
    const { container } = render(<WhiteboardCanvas initialShapes={[STICKY]} />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.wheel(canvas, { deltaX: -30, deltaY: -20 });
    // pan.x -= deltaX => +30; pan.y -= deltaY => +20. Sticky's on-screen
    // box shifts to (80,70)-(200,150).
    fireEvent.doubleClick(canvas, { clientX: 90, clientY: 85 });

    const editor = screen.getByPlaceholderText('Type a note…') as HTMLTextAreaElement;
    expect(editor.style.left).toBe('80px');
    expect(editor.style.top).toBe('70px');

    // Zoom indicator is untouched by a plain scroll.
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('Ctrl+wheel zooms (shown in the zoom indicator) instead of panning', () => {
    const { container } = render(<WhiteboardCanvas initialShapes={[STICKY]} />);
    const canvas = container.querySelector('canvas')!;
    expect(screen.getByText('100%')).toBeInTheDocument();

    fireEvent.wheel(canvas, { deltaY: -50, ctrlKey: true });
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
  });

  it('shows a discoverable Space+drag hint', () => {
    render(<WhiteboardCanvas />);
    expect(screen.getByText('Space')).toBeInTheDocument();
    expect(screen.getByText(/drag to pan/)).toBeInTheDocument();
  });
});

describe('WhiteboardCanvas — inline sticky editing', () => {
  it('placing a sticky opens an inline editor instead of window.prompt', () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const { container } = render(<WhiteboardCanvas />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.click(screen.getByTitle('Sticky note'));
    fireEvent.mouseDown(canvas, { clientX: 200, clientY: 150 });

    expect(promptSpy).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText('Type a note…')).toBeInTheDocument();
  });

  it('typing text and blurring commits it, and it can be re-opened via double-click', () => {
    const onChange = vi.fn();
    const { container } = render(<WhiteboardCanvas onChange={onChange} />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.click(screen.getByTitle('Sticky note'));
    fireEvent.mouseDown(canvas, { clientX: 200, clientY: 150 });
    const editor = screen.getByPlaceholderText('Type a note…');
    fireEvent.change(editor, { target: { value: 'buy milk' } });
    fireEvent.blur(editor);

    expect(screen.queryByPlaceholderText('Type a note…')).not.toBeInTheDocument();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Shape[];
    expect(lastCall.find((s) => s.kind === 'sticky')?.text).toBe('buy milk');

    // Re-open by double-clicking the same spot — the sticky tool auto-reverts
    // to Select after placing, matching Figma's "place, then immediately
    // interact" flow, so no extra tool switch is needed here.
    fireEvent.doubleClick(canvas, { clientX: 200, clientY: 150 });
    expect((screen.getByPlaceholderText('Type a note…') as HTMLTextAreaElement).value).toBe('buy milk');
  });

  it('leaving a fresh sticky blank drops it instead of leaving clutter', () => {
    const onChange = vi.fn();
    const { container } = render(<WhiteboardCanvas onChange={onChange} />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.click(screen.getByTitle('Sticky note'));
    fireEvent.mouseDown(canvas, { clientX: 200, clientY: 150 });
    fireEvent.blur(screen.getByPlaceholderText('Type a note…'));

    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Shape[];
    expect(lastCall.some((s) => s.kind === 'sticky')).toBe(false);
  });

  it('Escape discards edits to an existing note and restores its original text', () => {
    const onChange = vi.fn();
    const { container } = render(<WhiteboardCanvas initialShapes={[STICKY]} onChange={onChange} />);
    const canvas = container.querySelector('canvas')!;

    fireEvent.doubleClick(canvas, { clientX: 100, clientY: 90 });
    const editor = screen.getByPlaceholderText('Type a note…');
    fireEvent.change(editor, { target: { value: 'overwritten' } });
    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(screen.queryByPlaceholderText('Type a note…')).not.toBeInTheDocument();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as Shape[];
    expect(lastCall.find((s) => s.id === 'sticky-1')?.text).toBe('existing note');
  });
});
