/**
 * World Lens plan Phase 6b — HUDContextProvider's `concordia:hide-hud`
 * bridge effect. This is now the ONE place that folds the manual "hide
 * HUD" window event (dispatched by world/page.tsx's H-key handler and by
 * PhotoMode.tsx on open/close) into the shared store's `manualHidden`
 * field, replacing two previously-independent listeners (page.tsx's own
 * local `useState`, and hooks/useWorldHudHidden.ts's separate copy for
 * globally-mounted chrome) that each tracked it separately.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { HUDContextProvider, useHUDContext } from '@/components/world/concordia-hud/HUDContextProvider';

describe('HUDContextProvider — manual HUD hide bridge (Phase 6b)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false } as Response)));
    act(() => {
      useHUDContext.setState({ manualHidden: true }); // deliberately pre-set to prove the mount reset below
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('resets manualHidden to false on mount (fresh-visit reset, matching the old page-local useState behavior)', () => {
    render(<HUDContextProvider />);
    expect(useHUDContext.getState().manualHidden).toBe(false);
  });

  it('flips manualHidden true/false on real concordia:hide-hud events', () => {
    render(<HUDContextProvider />);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:hide-hud', { detail: { hide: true } }));
    });
    expect(useHUDContext.getState().manualHidden).toBe(true);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:hide-hud', { detail: { hide: false } }));
    });
    expect(useHUDContext.getState().manualHidden).toBe(false);
  });

  it('ignores a malformed event with no boolean hide field', () => {
    render(<HUDContextProvider />);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:hide-hud', { detail: {} }));
    });
    expect(useHUDContext.getState().manualHidden).toBe(false);
  });

  it('removes the listener on unmount', () => {
    const { unmount } = render(<HUDContextProvider />);
    unmount();
    act(() => {
      useHUDContext.setState({ manualHidden: false });
      window.dispatchEvent(new CustomEvent('concordia:hide-hud', { detail: { hide: true } }));
    });
    expect(useHUDContext.getState().manualHidden).toBe(false);
  });
});
