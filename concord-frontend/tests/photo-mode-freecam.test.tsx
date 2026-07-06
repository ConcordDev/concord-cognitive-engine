// Phase BE1 — confirm PhotoMode wires freecam + save-to-gallery + caption.
//
// The freecam test (2026-07-06 re-fix, verification-audit campaign) used to
// only regex-match PhotoMode.tsx's source text — it would still pass even if
// the keydown/wheel handlers were deleted, as long as the strings
// 'concordia:freecam' / "case 'w':" / "case 'q':" appeared anywhere in the
// file. Rewritten to render the real component, fire real KeyboardEvent /
// WheelEvent input via window.dispatchEvent (the same pattern this suite
// already uses for other window-level key handlers — see
// tests/components/AppShell.test.tsx's Ctrl+K / Escape tests), and assert the
// real 'concordia:freecam' CustomEvent actually fires with the real,
// engine-computed offsets — not just that the dispatch call exists in text.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, act } from '@testing-library/react';
import PhotoMode from '@/components/world/PhotoMode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, '..', 'components', 'world', 'PhotoMode.tsx');

describe('Phase BE1 — PhotoMode freecam + gallery', () => {
  const source = readFileSync(FILE, 'utf8');

  describe('freecam — real keydown/wheel wiring (rendered, not source-matched)', () => {
    let freecamSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      freecamSpy = vi.fn();
      window.addEventListener('concordia:freecam', freecamSpy as EventListener);
    });

    afterEach(() => {
      window.removeEventListener('concordia:freecam', freecamSpy as EventListener);
    });

    it('listens for WASD/QE/RF keys + wheel and dispatches a real concordia:freecam CustomEvent', () => {
      render(<PhotoMode open onClose={() => {}} canvasRef={null} />);

      // 'w' pans forward (z -= 0.5) — real dispatch, real payload.
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })); });
      expect(freecamSpy).toHaveBeenCalledTimes(1);
      expect((freecamSpy.mock.calls[0][0] as CustomEvent).detail.z).toBeCloseTo(-0.5);

      // 'q' rotates yaw left (yaw -= 0.05).
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q' })); });
      expect(freecamSpy).toHaveBeenCalledTimes(2);
      expect((freecamSpy.mock.calls[1][0] as CustomEvent).detail.yaw).toBeCloseTo(-0.05);

      // 'r' raises height (y += 0.3).
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' })); });
      expect(freecamSpy).toHaveBeenCalledTimes(3);
      expect((freecamSpy.mock.calls[2][0] as CustomEvent).detail.y).toBeCloseTo(0.3);

      // Mouse wheel zooms in (zoom -= 0.05 on deltaY < 0).
      act(() => { window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })); });
      expect(freecamSpy).toHaveBeenCalledTimes(4);
      expect((freecamSpy.mock.calls[3][0] as CustomEvent).detail.zoom).toBeCloseTo(0.95);

      // A key with no freecam binding does not dispatch.
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z' })); });
      expect(freecamSpy).toHaveBeenCalledTimes(4);
    });

    it('stops listening once PhotoMode is no longer open', () => {
      const { rerender } = render(<PhotoMode open onClose={() => {}} canvasRef={null} />);
      rerender(<PhotoMode open={false} onClose={() => {}} canvasRef={null} />);

      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'w' })); });
      expect(freecamSpy).not.toHaveBeenCalled();
    });
  });

  it('has a caption field with maxLength constraint', () => {
    expect(source).toMatch(/value=\{caption\}/);
    expect(source).toMatch(/maxLength=\{120\}/);
  });

  it('saveToGallery posts to /api/photos/save with the data URL', () => {
    expect(source).toMatch(/\/api\/photos\/save/);
    expect(source).toMatch(/dataUrl/);
  });

  it('exposes Save to gallery + Share publicly buttons', () => {
    expect(source).toMatch(/Save to gallery/);
    expect(source).toMatch(/Share publicly/);
  });
});
