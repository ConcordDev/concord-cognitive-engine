/**
 * /share/chat/[token] — the public chat-share viewer.
 *
 * Before this page existed, ChatStudioPanel's ShareTab created real share
 * links (chat.share-create) and displayed a real, copyable URL
 * (/share/chat/{token}) implying the link worked — but no route in the app
 * rendered it, so every link 404'd. This test pins that the page now (a)
 * calls the real chat.share-view macro, (b) renders the shared messages it
 * returns, (c) shows an honest sign-in prompt for a logged-out visitor
 * (share-view is not in the public-read allowlist yet), and (d) shows an
 * honest error for an invalid/revoked token — never a silent blank page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

const useAuthMock = vi.fn();
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => useAuthMock() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: 'tok_abc123' }),
}));

import ChatSharePage from '@/app/share/chat/[token]/page';

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
  lensRunMock.mockReset();
  useAuthMock.mockReset();
});

describe('/share/chat/[token] — public share viewer', () => {
  it('signed-out visitor sees an honest sign-in prompt, never a blank page', async () => {
    useAuthMock.mockReturnValue({ user: null, isLoading: false });
    const { getByText } = render(<ChatSharePage />);
    await waitFor(() => expect(getByText(/Sign in to view this conversation/i)).toBeInTheDocument());
    expect(lensRunMock).not.toHaveBeenCalled();
  });

  it('signed-in visitor with a valid token sees the real shared messages via chat.share-view', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false });
    lensRunMock.mockResolvedValue({ data: { ok: true, result: THREAD } });
    const { getByText } = render(<ChatSharePage />);
    await waitFor(() => expect(getByText('Shared conversation')).toBeInTheDocument());
    expect(lensRunMock).toHaveBeenCalledWith('chat', 'share-view', { token: 'tok_abc123' });
    expect(getByText(/What is the Refusal Field/)).toBeInTheDocument();
    expect(getByText(/A base-6 glyph algebra/)).toBeInTheDocument();
  });

  it('an invalid/revoked token shows an honest error, not a silent empty page', async () => {
    useAuthMock.mockReturnValue({ user: { id: 'u1' }, isLoading: false });
    lensRunMock.mockResolvedValue({ data: { ok: false, error: 'share link has been revoked' } });
    const { getByText } = render(<ChatSharePage />);
    await waitFor(() => expect(getByText(/share link has been revoked/i)).toBeInTheDocument());
  });
});
