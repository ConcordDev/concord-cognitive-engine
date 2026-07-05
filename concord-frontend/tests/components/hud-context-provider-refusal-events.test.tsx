/**
 * Fix 1 + Fix 4 (verification audit, 2026-07-05) — HUDContextProvider's
 * refusal-strength window-event wiring.
 *
 * The server only ever emits `refusal:compound-threshold`
 * (server/lib/refusal-field.js:134) — it never emits bare `refusal:compound`.
 * HUDContextProvider used to listen on BOTH names; the bare-`refusal:compound`
 * one was dead (nothing ever dispatches it) and has been removed, while the
 * useSocket.ts forwarder + this listener were both renamed to the real name.
 *
 * Separately, HUDContextProvider had a second, independently-dead listener
 * on `world:refusal-field` — that event IS real (server/lib/refusal-field.js
 * emits it on every field application, not just compound-threshold crossings)
 * but 6 OTHER components already consume it via subscribe() for their own
 * concerns (RefusalFieldHUD, CinematicTriggerBridge, EmergentJuiceBridge,
 * SystemFeed, RefusalFieldBanner, dome-barrier.ts) — HUDContextProvider's own
 * copy was redundant/unused for its refusalCompoundStrength slice (that slice
 * is specifically about the compound-threshold signal) and has been removed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { useHUDContext, HUDContextProvider } from '@/components/world/concordia-hud/HUDContextProvider';

describe('HUDContextProvider — refusal-strength window events', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, bloodlines: [], schemes: [], jobs: [], hooks: [], chains: [], sessions: [], features: [], months: [], blocks: [], rations: [] }),
    })));
    useHUDContext.setState({ refusalCompoundStrength: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('updates refusalCompoundStrength on the real server event name (refusal:compound-threshold)', () => {
    render(<HUDContextProvider />);
    act(() => {
      window.dispatchEvent(new CustomEvent('refusal:compound-threshold', { detail: { strength: 7 } }));
    });
    expect(useHUDContext.getState().refusalCompoundStrength).toBe(7);
  });

  it('does NOT react to the old, never-emitted bare "refusal:compound" name', () => {
    render(<HUDContextProvider />);
    act(() => {
      window.dispatchEvent(new CustomEvent('refusal:compound', { detail: { strength: 8 } }));
    });
    expect(useHUDContext.getState().refusalCompoundStrength).toBe(0);
  });

  it('does NOT react to world:refusal-field (dead listener removed — 6 other consumers own it)', () => {
    render(<HUDContextProvider />);
    act(() => {
      window.dispatchEvent(new CustomEvent('world:refusal-field', { detail: { strength: 9 } }));
    });
    expect(useHUDContext.getState().refusalCompoundStrength).toBe(0);
  });

  it('removes the refusal:compound-threshold listener on unmount', () => {
    const { unmount } = render(<HUDContextProvider />);
    unmount();
    act(() => {
      window.dispatchEvent(new CustomEvent('refusal:compound-threshold', { detail: { strength: 5 } }));
    });
    expect(useHUDContext.getState().refusalCompoundStrength).toBe(0);
  });
});
