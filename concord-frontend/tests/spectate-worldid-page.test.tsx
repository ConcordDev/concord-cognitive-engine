/**
 * /spectate/[worldId] — read-only world spectator feed.
 *
 * Rewritten alongside the public-route fix (was: authenticated
 * `/api/lens/run` calls that 401'd for every anonymous visitor — see
 * server/tests/e2e/spectate-routes.test.js for the backend half). The page
 * now calls three dedicated public REST routes directly:
 *   POST /api/spectate/:worldId/subscribe  -> { ok, sessionToken }
 *   POST /api/spectate/heartbeat           -> { ok }
 *   GET  /api/spectate/:worldId/feed       -> { ok, worldId, spectators, dispatches }
 * Each response is a single flat envelope (no more `/api/lens/run`'s nested
 * `{ ok, result: { ok, ... } }` transport wrapper the old version of this
 * test pinned unwrapping for) — the old envelope-unwrap regression this
 * test used to guard against no longer applies to this page at all, since
 * the double-envelope shape it existed to protect against doesn't occur on
 * these routes.
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

describe('/spectate/[worldId] — public routes, flat envelopes', () => {
  it('subscribes, then reads sessionToken/spectators/dispatches from the flat feed response', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/subscribe')) {
        return jsonOf({ ok: true, sessionToken: 'sess_abc123' });
      }
      if (String(url).includes('/feed')) {
        return jsonOf({ ok: true, worldId: 'sovereign-ruins', spectators: [SPECTATOR], dispatches: [DISPATCH] });
      }
      return jsonOf({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getByText, container } = render(<SpectatePage />);

    // subscribe was called with no auth headers/cookies — a plain fetch.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/spectate/sovereign-ruins/subscribe',
      expect.objectContaining({ method: 'POST' }),
    ));
    // spectator count comes from the flat `spectators` array.
    await waitFor(() => expect(getByText('1 viewers')).toBeInTheDocument());
    // session token slice comes from the flat `sessionToken`.
    await waitFor(() => expect(container.textContent).toMatch(/session sess_abc/));
    // goddess dispatch body comes from the flat `dispatches` array.
    await waitFor(() => expect(getByText(DISPATCH.body)).toBeInTheDocument());
  });

  it('shows the honest silent-goddess copy when spectators/dispatches are empty', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/subscribe')) return jsonOf({ ok: true, sessionToken: 'sess_xyz' });
      if (String(url).includes('/feed')) return jsonOf({ ok: true, worldId: 'sovereign-ruins', spectators: [], dispatches: [] });
      return jsonOf({ ok: true });
    }));
    const { getByText } = render(<SpectatePage />);
    await waitFor(() => expect(getByText('The goddess is silent.')).toBeInTheDocument());
    expect(getByText('0 viewers')).toBeInTheDocument();
  });

  it('never crashes and stays render-safe when subscribe fails (ok:false)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf({ ok: false, reason: 'missing_worldId' })));
    const { getByText } = render(<SpectatePage />);
    // Falls back to the zero-state — no session token, no crash.
    await waitFor(() => expect(getByText('0 viewers')).toBeInTheDocument());
  });
});
