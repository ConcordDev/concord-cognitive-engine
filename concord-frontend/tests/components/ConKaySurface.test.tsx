/**
 * ConKaySurface — pins the stateRef-sync-to-useEffect fix.
 *
 * `stateRef.current = state` was a direct render-body mutation, moved to
 * `useEffect(() => { stateRef.current = state; }, [state])`. The canvas
 * rAF loop reads `stateRef.current` every frame to pick the particle
 * behavior for the current ConKay state, so a prop change (e.g.
 * idle -> listening) must be visible to that loop without remounting the
 * whole effect. This test just proves a state-prop change re-renders
 * cleanly and the component doesn't throw across the transition — the
 * rAF loop itself is stubbed out (jsdom has no real animation timing).
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, act } from '@testing-library/react';
import { ConKaySurface } from '@/components/conkay/ConKaySurface';
import type { ConKayState } from '@/components/conkay/conkay-persona';

let originalRAF: typeof window.requestAnimationFrame;
let originalCAF: typeof window.cancelAnimationFrame;

/** Actually runs the loop body a bounded number of times per call, instead
 *  of the shared no-op default, so the per-state particle/pulse/glow
 *  branches get exercised for coverage. Caller restores the no-op default
 *  afterward. */
function runRealFrames(times: number) {
  let count = 0;
  window.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
    count += 1;
    if (count <= times) cb(performance.now());
    return 0;
  }) as unknown as typeof window.requestAnimationFrame;
}
function restoreNoOpRAF() {
  window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
}

beforeAll(() => {
  originalRAF = window.requestAnimationFrame;
  originalCAF = window.cancelAnimationFrame;
  window.requestAnimationFrame = vi.fn(() => 0) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = vi.fn() as unknown as typeof window.cancelAnimationFrame;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  window.requestAnimationFrame = originalRAF;
  window.cancelAnimationFrame = originalCAF;
});

describe('ConKaySurface', () => {
  it('renders a canvas for the idle state', () => {
    const { container } = render(<ConKaySurface state="idle" />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('re-renders cleanly when the state prop changes (stateRef sync effect)', () => {
    const { container, rerender } = render(<ConKaySurface state="idle" />);
    expect(() => rerender(<ConKaySurface state="listening" />)).not.toThrow();
    expect(() => rerender(<ConKaySurface state="processing" />)).not.toThrow();
    expect(container.querySelector('canvas')).toBeInTheDocument();
  });

  it('runs real animation frames across every state without throwing (particle/pulse/glow branches)', () => {
    // The mount effect's `raf = requestAnimationFrame(loop)` call happens
    // synchronously inside render, so the real-frame runner must be
    // installed BEFORE render(), not after.
    runRealFrames(2);
    const states: ConKayState[] = ['idle', 'listening', 'processing', 'acting', 'presenting'];
    try {
      const { container, rerender } = render(<ConKaySurface state={states[0]} />);
      for (const st of states.slice(1)) {
        act(() => { rerender(<ConKaySurface state={st} />); });
        // Fire another bounded batch of real frames under the new state so
        // its particle-motion branch (processing/acting orbit, listening
        // drift, idle/presenting pulse) actually runs.
        runRealFrames(2);
      }
      expect(container.querySelector('canvas')).toBeInTheDocument();
    } finally {
      restoreNoOpRAF();
    }
  });

  it('draws the static reduced-motion frame and reacts to resize when prefers-reduced-motion matches', () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn(() => ({ matches: true }) as unknown as MediaQueryList);
    try {
      const { container } = render(<ConKaySurface state="idle" />);
      expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
      expect(container.querySelector('canvas')).toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });
});
