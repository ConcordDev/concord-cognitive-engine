/**
 * Anonymous, Voice, Feed, and News north stars.
 * Empty copy is not a post, a take, a card, or a headline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KeyboardProvider } from '@/lib/keyboard';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'ramaj', email: 'r@x', role: 'owner' },
    isLoading: false,
    isAuthenticated: true,
    logout: async () => {},
    refresh: async () => {},
  }),
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));

const lensRunMock = vi.fn();
const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
  },
}));

import { SayItUnnamed } from '@/components/anon/SayItUnnamed';
import { HoldToTalk } from '@/components/voice/HoldToTalk';
import { TheNextThing } from '@/components/feed/TheNextThing';
import { WhatChanged } from '@/components/news/WhatChanged';

function ok(result: unknown) {
  return { data: { ok: true, result, error: null } };
}

function renderInShell(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KeyboardProvider>{ui}</KeyboardProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  lensRunMock.mockReset();
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockResolvedValue({ data: { ok: true, artifacts: [], total: 0 } });
  apiPost.mockResolvedValue({ data: { ok: true } });
});

describe('speak family north stars', () => {
  it('anonymous refuses to store a post when there is no conversation to seal', async () => {
    lensRunMock.mockResolvedValue(ok({ conversations: [], count: 0 }));
    renderInShell(<SayItUnnamed onOpenDesk={() => {}} />);
    expect(await screen.findByText('Say it unnamed, Ramaj')).toBeTruthy();
    expect(screen.getByText('Identity is stripped before this is stored.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Post'), { target: { value: 'unnamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('No conversation to seal this into.')).toBeTruthy();
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'sendMessage')).toBe(false);
  });

  it('anonymous seals the post with the sender stripped', async () => {
    lensRunMock.mockImplementation((_domain: string, name: string) => {
      if (name === 'listConversations') return Promise.resolve(ok({ conversations: [{ id: 'dm_1', lastActivityAt: 2 }], count: 1 }));
      if (name === 'sendMessage') return Promise.resolve(ok({ messageId: 'msg_1' }));
      return Promise.resolve(ok({}));
    });
    renderInShell(<SayItUnnamed onOpenDesk={() => {}} />);
    fireEvent.change(await screen.findByLabelText('Post'), { target: { value: 'unnamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Post' }));
    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('anon', 'sendMessage', {
        conversationId: 'dm_1',
        content: 'unnamed',
        sealedSender: true,
      });
    });
    expect(await screen.findByTestId('anon-sealed')).toBeTruthy();
  });

  it('voice counts persisted takes and does not invent one without a microphone', async () => {
    apiGet.mockResolvedValue({
      data: { ok: true, total: 0, artifacts: [] },
    });
    renderInShell(<HoldToTalk onOpenDesk={() => {}} />);
    expect(await screen.findByText('Built-in microphone · 0 takes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(await screen.findByText('No microphone on this device.')).toBeTruthy();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('feed stays empty until home returns a post', async () => {
    lensRunMock.mockResolvedValue(ok({ items: [], total: 0, source: 'ranked_home' }));
    renderInShell(<TheNextThing onOpenDesk={() => {}} />);
    expect(await screen.findByText('The next thing, Ramaj')).toBeTruthy();
    expect(await screen.findByTestId('feed-empty')).toBeTruthy();
    expect(screen.queryByTestId('feed-column')).toBeNull();
  });

  it('feed renders the ranked post and its citation', async () => {
    lensRunMock.mockResolvedValue(ok({
      items: [{ id: 'p1', content: 'A real post', linkedDTUs: [{ dtuId: 'd1', title: 'Cited note' }] }],
      total: 1,
    }));
    renderInShell(<TheNextThing onOpenDesk={() => {}} />);
    expect(await screen.findByText('A real post')).toBeTruthy();
    expect(screen.getByText('Cited note')).toBeTruthy();
  });

  it('news shows fetching, then only the headlines the pull returned', async () => {
    let resolvePull: (v: unknown) => void = () => {};
    lensRunMock.mockImplementation((_domain: string, name: string) => {
      if (name === 'headlines') return new Promise((resolve) => { resolvePull = resolve; });
      return Promise.resolve(ok({}));
    });
    renderInShell(<WhatChanged onOpenDesk={() => {}} />);
    expect(await screen.findByTestId('news-fetching')).toBeTruthy();
    expect(screen.queryByText(/Headlines 0/)).toBeNull();
    resolvePull(ok({
      headlines: [{ id: 'h1', title: 'A real headline', source: 'GDELT' }],
      count: 1,
    }));
    expect(await screen.findByText('A real headline')).toBeTruthy();
    expect(screen.getByText('1 headline · 1 source')).toBeTruthy();
    expect(screen.queryByTestId('news-fetching')).toBeNull();
  });
});
