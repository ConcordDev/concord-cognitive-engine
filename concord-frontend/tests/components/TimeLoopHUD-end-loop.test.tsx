/**
 * Wave 4 gap-closure (docs/concordia-specs/runmodes-endgame-social-capability-map.md
 * §2.4): the real server/lib/time-loop.js#endLoop route
 * (`POST /api/time-loop/:sessionId/end`) had no frontend caller anywhere —
 * a player could start a loop but never manually end one from the UI. The
 * route registration itself was NOT actually broken (re-verified against
 * server/server.js: all 5 `/api/time-loop/*` routes have correct leading
 * slashes on their path params, and `git log -S` confirms the "missing `/`"
 * string this doc originally quoted never existed in this codebase's
 * history) — only the missing "End loop" UI affordance was real. This test
 * pins the new button: a confirmed `ok:true` response clears the HUD, a
 * failure leaves the loop state alone and surfaces an honest toast.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor, fireEvent } from '@testing-library/react';

const addToast = vi.fn();
vi.mock('@/store/ui', () => ({
  useUIStore: Object.assign(() => {}, { getState: () => ({ addToast }) }),
}));

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
}));

import { TimeLoopHUD } from '@/components/world/TimeLoopHUD';

const ACTIVE_LOOP = { id: 'tls_abc123', loop_number: 2, duration_s: 1320, started_at: Math.floor(Date.now() / 1000) - 60 };

describe('TimeLoopHUD — End loop button', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    addToast.mockClear();
    window.localStorage.clear();
    window.localStorage.setItem('concordia:activeWorldId', 'concordia-hub');
  });

  it('POSTs to the real endLoop route and clears the HUD on ok:true', async () => {
    fetchMock = vi.fn((url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith('/api/time-loop/active/')) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, session: ACTIVE_LOOP }) });
      }
      if (u === `/api/time-loop/${ACTIVE_LOOP.id}/end`) {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toEqual({ reason: 'manual_exit' });
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, reason: 'manual_exit' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const { getByText, queryByText } = render(<TimeLoopHUD />);
    await waitFor(() => expect(getByText(/End loop/i)).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText(/End loop/i)); });

    await waitFor(() => expect(queryByText(/Time loop #2/i)).toBeNull());
    expect(addToast).not.toHaveBeenCalled();
  });

  it('leaves the loop state intact and toasts on a failed end', async () => {
    fetchMock = vi.fn((url: unknown) => {
      const u = String(url);
      if (u.startsWith('/api/time-loop/active/')) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, session: ACTIVE_LOOP }) });
      }
      if (u === `/api/time-loop/${ACTIVE_LOOP.id}/end`) {
        return Promise.resolve({ ok: true, json: async () => ({ ok: false, error: 'already_ended' }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const { getByText } = render(<TimeLoopHUD />);
    await waitFor(() => expect(getByText(/End loop/i)).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText(/End loop/i)); });

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: expect.stringContaining('already_ended') }),
    ));
    // The HUD is still showing the loop — a failure never fakes success.
    expect(getByText(/Time loop #2/i)).toBeInTheDocument();
  });
});
