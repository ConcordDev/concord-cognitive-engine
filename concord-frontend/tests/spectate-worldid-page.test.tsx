/**
 * /spectate/[worldId] — read-only world spectator feed.
 *
 * Regression pin: POST /api/lens/run always responds { ok: true, result:
 * PAYLOAD } where the outer `ok` is a transport flag only, not the macro's
 * own success/failure. Before the fix, this page's local `macro()` helper
 * returned that raw envelope and read `sub.sessionToken` / `s.spectators` /
 * `d.dispatches` straight off it — always undefined — so the spectator page
 * never showed a session token, viewer count, or goddess feed even when the
 * backend was working correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ worldId: 'sovereign-ruins' }),
}));

import SpectatePage from '@/app/spectate/[worldId]/page';

function jsonOf(body: unknown) {
  return Promise.resolve({ json: () => Promise.resolve(body) } as Response);
}

const SPECTATOR = { id: 1, viewer_user_id: 'user_7', started_at: 1700000000 };
const DISPATCH = { id: 9, tone: 'warm', body: 'The plaza hums with quiet trade.', composed_at: 1700000500 };

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('/spectate/[worldId] — nested envelope unwrap', () => {
  it('subscribes, then reads sessionToken/spectators/dispatches from the correctly-nested envelope', async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.name === 'subscribe') {
        return jsonOf({ ok: true, result: { ok: true, sessionToken: 'sess_abc123' } });
      }
      if (body.name === 'list_for_world') {
        return jsonOf({ ok: true, result: { ok: true, worldId: 'sovereign-ruins', spectators: [SPECTATOR] } });
      }
      if (body.name === 'recent') {
        return jsonOf({ ok: true, result: { ok: true, worldId: 'sovereign-ruins', dispatches: [DISPATCH] } });
      }
      return jsonOf({ ok: true, result: { ok: true } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByText, container } = render(<SpectatePage />);

    // spectator count comes from the unwrapped `spectators` array.
    await waitFor(() => expect(getByText('1 viewers')).toBeInTheDocument());
    // session token slice comes from the unwrapped `sessionToken`.
    await waitFor(() => expect(container.textContent).toMatch(/session sess_abc/));
    // goddess dispatch body comes from the unwrapped `dispatches` array.
    await waitFor(() => expect(getByText(DISPATCH.body)).toBeInTheDocument());
  });

  it('shows the honest silent-goddess copy when dispatches unwrap to an empty array', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (body.name === 'subscribe') return jsonOf({ ok: true, result: { ok: true, sessionToken: 'sess_xyz' } });
      if (body.name === 'list_for_world') return jsonOf({ ok: true, result: { ok: true, spectators: [] } });
      if (body.name === 'recent') return jsonOf({ ok: true, result: { ok: true, dispatches: [] } });
      return jsonOf({ ok: true, result: { ok: true } });
    }));
    const { getByText } = render(<SpectatePage />);
    await waitFor(() => expect(getByText('The goddess is silent.')).toBeInTheDocument());
    expect(getByText('0 viewers')).toBeInTheDocument();
  });

  it('never crashes and stays render-safe when subscribe fails (nested ok:false)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: true, result: { ok: false, reason: 'missing_worldId' } })));
    const { getByText } = render(<SpectatePage />);
    // Falls back to the zero-state — no session token, no crash.
    await waitFor(() => expect(getByText('0 viewers')).toBeInTheDocument());
  });
});
