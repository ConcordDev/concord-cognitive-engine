/**
 * Runtime-health capability map finding #11 — TimeLoopHUD used to read
 * `concordia:activeWorldId` from localStorage in a mount-only effect, so
 * traveling to a different world in the SAME tab (portals / Concord Link /
 * fast-travel, no navigation away from /lenses/world) left it permanently
 * polling `/api/time-loop/active/<OLD world>` for the rest of the session.
 * It's now driven by useActiveWorldId(), reactive to the
 * `concordia:active-world-changed` CustomEvent dispatched by useWorldTravel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
}));

import { TimeLoopHUD } from '@/components/world/TimeLoopHUD';
import { ACTIVE_WORLD_CHANGED_EVENT } from '@/hooks/useActiveWorldId';

describe('TimeLoopHUD — same-tab world travel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem('concordia:activeWorldId', 'concordia-hub');
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.startsWith('/api/time-loop/active/')) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, session: null }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-polls the new world the instant the player travels, not just on the next backstop tick', async () => {
    render(<TimeLoopHUD />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/time-loop/active/concordia-hub')).toBe(true));

    // Synchronous act (no async/await inside): the world-changed listener's
    // setState runs its effects — including the immediate-refetch effect —
    // before this call returns. No real time passes, so POLL_MS's 2000ms
    // backstop interval cannot possibly have ticked yet; if this assertion
    // passes, only the dedicated `useEffect(() => { refresh(); }, [worldId])`
    // could be responsible. (Without that effect this call is NOT present
    // here — it only shows up after ~POLL_MS of real time via the backstop,
    // which is exactly the bug this test pins closed.)
    act(() => {
      window.dispatchEvent(new CustomEvent(ACTIVE_WORLD_CHANGED_EVENT, { detail: { worldId: 'tunya' } }));
    });

    expect(fetchMock.mock.calls.some((c) => String(c[0]) === '/api/time-loop/active/tunya')).toBe(true);

    // Flush the pending fetch().then() microtask (the assertion above only
    // needed the synchronous fetch() call to have been made) so React doesn't
    // warn about an unwrapped state update after the test body returns.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  });
});
