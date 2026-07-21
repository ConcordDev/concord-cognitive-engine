/**
 * World Lens plan Phase 6a (Dynamic HUD authoritative) — the idle-timer
 * signal on HUDContextProvider. Per the owner's "if not needed in 5
 * seconds, hide it" rule: `isIdle` flips true once no pointer/keyboard/
 * wheel/touch activity has been seen for IDLE_TIMEOUT_MS, EXCEPT:
 *   - never while `inputMode` is 'combat' or 'dialogue' (re-checked
 *     continuously, not just latched at the moment the timer fires), and
 *   - never at all under effective reduced-motion (idle-fade is itself a
 *     motion effect; consumers should never see `isIdle: true` in that case).
 *
 * This is a real behavioral test (HUDContextProvider is a lightweight,
 * DOM-only side-effect component — no Three.js — so it renders fine in
 * jsdom), not a source-pin, matching the precedent already established
 * for this same component in hud-context-provider-clock-realtime.test.tsx
 * and hud-context-provider-refusal-events.test.tsx.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { HUDContextProvider, useHUDContext, HUD_CONTEXT_CONSTANTS } from '@/components/world/concordia-hud/HUDContextProvider';
import { useUIStore } from '@/store/ui';
import { ACCESSIBILITY_DEFAULTS } from '@/store/slices/accessibility';

describe('HUDContextProvider — idle-timer signal (Phase 6a)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false } as Response)));
    act(() => {
      useHUDContext.setState({ isIdle: false, inputMode: 'exploration' });
      useUIStore.setState({ accessibility: { ...ACCESSIBILITY_DEFAULTS, reducedMotion: false }, osReducedMotion: false });
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('starts not idle', () => {
    render(<HUDContextProvider />);
    expect(useHUDContext.getState().isIdle).toBe(false);
  });

  it('flips isIdle true once IDLE_TIMEOUT_MS elapses with no activity', () => {
    render(<HUDContextProvider />);
    act(() => {
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS + HUD_CONTEXT_CONSTANTS.IDLE_CHECK_INTERVAL_MS);
    });
    expect(useHUDContext.getState().isIdle).toBe(true);
  });

  it('does NOT go idle before IDLE_TIMEOUT_MS has elapsed', () => {
    render(<HUDContextProvider />);
    act(() => {
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS - HUD_CONTEXT_CONSTANTS.IDLE_CHECK_INTERVAL_MS);
    });
    expect(useHUDContext.getState().isIdle).toBe(false);
  });

  it('real pointer/keyboard/wheel/touch activity resets the idle clock', () => {
    render(<HUDContextProvider />);
    // Run down to just before the threshold, then touch each tracked
    // activity kind in turn — each one must push the clock back out.
    for (const evt of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
      act(() => {
        vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS - 500);
      });
      expect(useHUDContext.getState().isIdle).toBe(false);
      act(() => {
        window.dispatchEvent(new Event(evt));
      });
    }
    // Immediately after the last activity event, still not idle.
    act(() => {
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_CHECK_INTERVAL_MS);
    });
    expect(useHUDContext.getState().isIdle).toBe(false);
  });

  it('never goes idle while inputMode is combat, even after a long silence', () => {
    render(<HUDContextProvider />);
    act(() => {
      useHUDContext.setState({ inputMode: 'combat' });
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS * 3);
    });
    expect(useHUDContext.getState().isIdle).toBe(false);
  });

  it('never goes idle while inputMode is dialogue, even after a long silence', () => {
    render(<HUDContextProvider />);
    act(() => {
      useHUDContext.setState({ inputMode: 'dialogue' });
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS * 3);
    });
    expect(useHUDContext.getState().isIdle).toBe(false);
  });

  it('un-fades within one check tick when combat starts while already idle', () => {
    render(<HUDContextProvider />);
    act(() => {
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS + HUD_CONTEXT_CONSTANTS.IDLE_CHECK_INTERVAL_MS);
    });
    expect(useHUDContext.getState().isIdle).toBe(true);

    act(() => {
      useHUDContext.setState({ inputMode: 'combat' });
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_CHECK_INTERVAL_MS);
    });
    expect(useHUDContext.getState().isIdle).toBe(false);
  });

  it('resumes idling after combat ends and inactivity continues', () => {
    render(<HUDContextProvider />);
    act(() => {
      useHUDContext.setState({ inputMode: 'combat' });
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS * 2);
    });
    expect(useHUDContext.getState().isIdle).toBe(false);

    act(() => {
      useHUDContext.setState({ inputMode: 'exploration' });
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_CHECK_INTERVAL_MS);
    });
    expect(useHUDContext.getState().isIdle).toBe(true);
  });

  it('never sets isIdle true under effective reduced-motion (user setting)', () => {
    act(() => {
      useUIStore.setState({ accessibility: { ...ACCESSIBILITY_DEFAULTS, reducedMotion: true } });
    });
    render(<HUDContextProvider />);
    act(() => {
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS * 5);
    });
    expect(useHUDContext.getState().isIdle).toBe(false);
  });

  it('never sets isIdle true under effective reduced-motion (OS-level preference)', () => {
    act(() => {
      useUIStore.setState({ osReducedMotion: true });
    });
    render(<HUDContextProvider />);
    act(() => {
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS * 5);
    });
    expect(useHUDContext.getState().isIdle).toBe(false);
  });

  it('force-clears a stale isIdle:true when reduced-motion becomes active mid-session', () => {
    render(<HUDContextProvider />);
    act(() => {
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS + HUD_CONTEXT_CONSTANTS.IDLE_CHECK_INTERVAL_MS);
    });
    expect(useHUDContext.getState().isIdle).toBe(true);

    act(() => {
      useUIStore.setState({ accessibility: { ...ACCESSIBILITY_DEFAULTS, reducedMotion: true } });
    });
    expect(useHUDContext.getState().isIdle).toBe(false);
  });

  it('stops flipping isIdle after unmount (interval + listeners torn down)', () => {
    const { unmount } = render(<HUDContextProvider />);
    unmount();
    act(() => {
      useHUDContext.setState({ isIdle: false });
      vi.advanceTimersByTime(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS * 3);
    });
    expect(useHUDContext.getState().isIdle).toBe(false);
  });

  it('exports IDLE_TIMEOUT_MS / IDLE_CHECK_INTERVAL_MS on HUD_CONTEXT_CONSTANTS', () => {
    expect(typeof HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS).toBe('number');
    expect(typeof HUD_CONTEXT_CONSTANTS.IDLE_CHECK_INTERVAL_MS).toBe('number');
    expect(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS).toBeGreaterThanOrEqual(5000);
    expect(HUD_CONTEXT_CONSTANTS.IDLE_TIMEOUT_MS).toBeLessThanOrEqual(8000);
  });
});
