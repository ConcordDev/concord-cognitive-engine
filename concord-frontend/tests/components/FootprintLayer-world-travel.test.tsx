/**
 * Runtime-health capability map finding #11 — FootprintLayer used to read
 * `concordia:activeWorldId` from localStorage in a mount-only effect, so
 * traveling to a different world in the SAME tab (portals / Concord Link /
 * fast-travel, no navigation away from /lenses/world) left it permanently
 * querying `/api/tracking/recent/<OLD world>` for the rest of the session.
 * It's now driven by useActiveWorldId(), which is reactive to the
 * `concordia:active-world-changed` CustomEvent dispatched by useWorldTravel —
 * this test pins that a same-tab travel event triggers a fresh, correctly
 * world-scoped fetch, not just a swap of where the stale read happens.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
}));

import { FootprintLayer } from '@/components/world/FootprintLayer';
import { ACTIVE_WORLD_CHANGED_EVENT } from '@/hooks/useActiveWorldId';

describe('FootprintLayer — same-tab world travel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('concordia:activeWorldId', 'concordia-hub');
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.startsWith('/api/tracking/recent/')) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, gated: false, tracks: [] }) });
      }
      // /api/config/client and anything else — harmless default.
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    delete (window as { __concordiaPlayerPos?: unknown }).__concordiaPlayerPos;
  });

  it('re-fetches tracks scoped to the new world when the player travels mid-session', async () => {
    render(<FootprintLayer />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/tracking/recent/concordia-hub'))).toBe(true));

    const tunyaCallsBefore = fetchMock.mock.calls.filter((c) => String(c[0]).startsWith('/api/tracking/recent/tunya')).length;
    expect(tunyaCallsBefore).toBe(0);

    // Synchronous act (no async/await inside): the world-changed listener's
    // setState runs its effects — including the immediate-refetch effect —
    // before this call returns, so no real time passes. footprintMs's backstop
    // interval (30s default) cannot possibly have ticked yet; if the assertion
    // below passes, only the dedicated `useEffect(() => { refresh(); },
    // [worldId])` companion effect could be responsible. That effect exists
    // because useRealtimeRefresh reads its refresh callback via a ref, so a
    // worldId change alone doesn't retrigger its subscribe effect — without
    // the companion, the layer would stay pinned to the old world's tracks
    // until the next backstop tick, which is exactly the bug this test pins
    // closed.
    act(() => {
      window.dispatchEvent(new CustomEvent(ACTIVE_WORLD_CHANGED_EVENT, { detail: { worldId: 'tunya' } }));
    });

    expect(fetchMock.mock.calls.some((c) => String(c[0]).startsWith('/api/tracking/recent/tunya'))).toBe(true);

    // Flush the pending fetch().then() microtask (the assertion above only
    // needed the synchronous fetch() call to have been made) so React doesn't
    // warn about an unwrapped state update after the test body returns.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });
});
