import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useViewedPlayerProfile } from '@/hooks/useViewedPlayerProfile';

// V1.2 Wave A ("Society & Presence") — the dead-wire fix. Previously
// PlayerPresence.tsx's "View Profile" button dispatched
// `concordia:view-player-profile` (via components/world/WorldOsSurface.tsx's
// onViewProfile callback) but NOTHING captured the target playerId — the
// profile panel always rendered the caller's own profile regardless of
// which player was clicked. This hook is the fix: it subscribes to the real
// window CustomEvent and exposes the target id so the panel can pass it
// through as `targetUserId`.
describe('useViewedPlayerProfile — the concordia:view-player-profile dead-wire fix', () => {
  it('starts with no viewed profile (self-view by default)', () => {
    const { result } = renderHook(() => useViewedPlayerProfile());
    expect(result.current.viewedProfileUserId).toBeNull();
  });

  it('dispatching concordia:view-player-profile with a playerId sets viewedProfileUserId', () => {
    const { result } = renderHook(() => useViewedPlayerProfile());

    act(() => {
      window.dispatchEvent(
        new CustomEvent('concordia:view-player-profile', { detail: { playerId: 'player-42' } }),
      );
    });

    expect(result.current.viewedProfileUserId).toBe('player-42');
  });

  it('a later dispatch for a different player overwrites the previously viewed id', () => {
    const { result } = renderHook(() => useViewedPlayerProfile());

    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:view-player-profile', { detail: { playerId: 'p1' } }));
    });
    expect(result.current.viewedProfileUserId).toBe('p1');

    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:view-player-profile', { detail: { playerId: 'p2' } }));
    });
    expect(result.current.viewedProfileUserId).toBe('p2');
  });

  it('a dispatch with no playerId in detail is ignored (no crash, no clear)', () => {
    const { result } = renderHook(() => useViewedPlayerProfile());
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:view-player-profile', { detail: { playerId: 'p1' } }));
    });
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:view-player-profile', { detail: {} }));
    });
    expect(result.current.viewedProfileUserId).toBe('p1');
  });

  it('clearViewedProfile resets back to self-view (the CurrencyHUD "my own profile" entry point)', () => {
    const { result } = renderHook(() => useViewedPlayerProfile());
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:view-player-profile', { detail: { playerId: 'p1' } }));
    });
    expect(result.current.viewedProfileUserId).toBe('p1');

    act(() => { result.current.clearViewedProfile(); });
    expect(result.current.viewedProfileUserId).toBeNull();
  });

  it('unsubscribes on unmount — a later dispatch does not throw or affect anything', () => {
    const { unmount } = renderHook(() => useViewedPlayerProfile());
    unmount();
    expect(() => {
      window.dispatchEvent(new CustomEvent('concordia:view-player-profile', { detail: { playerId: 'p1' } }));
    }).not.toThrow();
  });
});
