/**
 * /share/chat/[token] — the public chat-share viewer.
 *
 * Rewritten alongside the public-route fix (was: every anonymous recipient
 * of a share link saw a "sign in to view" prompt, because the page called
 * the cookie-authenticated `lensRun('chat', 'share-view', …)` behind a
 * `useAuth()` gate — see server/tests/e2e/chat-share-routes.test.js for the
 * backend half). The page now calls the dedicated public REST route
 * `GET /api/chat/share/:token` with a plain, unauthenticated `fetch` — no
 * `useAuth()`, no `lensRun`, works identically for a signed-out visitor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'tok_abc123' }),
}));

import ChatSharePage from '@/app/share/chat/[token]/page';

function jsonOf(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
}

const THREAD = {
  title: 'Shared conversation',
  messages: [
    { role: 'user', content: 'What is the Refusal Field?' },
    { role: 'assistant', content: 'A base-6 glyph algebra gating mechanic.' },
  ],
  messageCount: 2,
  createdAt: new Date().toISOString(),
  viewCount: 3,
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('/share/chat/[token] — public share viewer, no auth required', () => {
  it('a genuinely logged-out visitor sees the real shared messages, no sign-in prompt', async () => {
    const fetchMock = vi.fn(() => jsonOf(200, { ok: true, result: THREAD }));
    vi.stubGlobal('fetch', fetchMock);

    const { getByText, queryByText } = render(<ChatSharePage />);

    await waitFor(() => expect(getByText('Shared conversation')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith('/api/chat/share/tok_abc123');
    expect(getByText(/What is the Refusal Field/)).toBeInTheDocument();
    expect(getByText(/A base-6 glyph algebra/)).toBeInTheDocument();
    expect(queryByText(/Sign in to view/i)).not.toBeInTheDocument();
  });

  it('an invalid/revoked token shows an honest error, not a silent empty page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => jsonOf(404, { ok: false, error: 'share link has been revoked' })));
    const { getByText } = render(<ChatSharePage />);
    await waitFor(() => expect(getByText(/share link has been revoked/i)).toBeInTheDocument());
  });

  it('a network failure shows an honest error, never a blank/crashed page', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    const { getByText } = render(<ChatSharePage />);
    await waitFor(() => expect(getByText(/Network error/i)).toBeInTheDocument());
  });
});
