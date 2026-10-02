/**
 * Threads, Forum, and Daily north stars.
 * Empty copy is not a stand-in for a thread, a post, or an entry.
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

import { WhichBranch } from '@/components/thread/WhichBranch';
import { TheBoard } from '@/components/forum/TheBoard';
import { TodayPage, localWeekBounds } from '@/components/daily/TodayPage';

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

function localToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

beforeEach(() => {
  lensRunMock.mockReset();
  apiGet.mockReset();
  apiPost.mockReset();
  apiGet.mockResolvedValue({ data: { ok: true, artifacts: [], total: 0 } });
  apiPost.mockResolvedValue({ data: { ok: true, artifact: { id: 'conv_1' } } });
});

describe('chat family north stars', () => {
  it('threads stays empty until a conversation exists, and Reply opens one', async () => {
    renderInShell(<WhichBranch onOpenDesk={() => {}} />);
    expect(await screen.findByText('Which branch, Ramaj')).toBeTruthy();
    expect(await screen.findByTestId('thread-empty')).toBeTruthy();
    expect(screen.queryByTestId('thread-stack')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByLabelText('Reply'), { target: { value: 'The first turn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/lens/thread', expect.objectContaining({
        type: 'conversation',
        title: 'The first turn',
      }));
    });
    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/api/lens/thread/conv_1/run', expect.objectContaining({
        action: 'branch',
        params: { parentNodeId: null, content: 'The first turn' },
      }));
    });
  });

  it('threads stacks the open conversation under its root', async () => {
    apiGet.mockResolvedValue({
      data: {
        ok: true,
        total: 1,
        artifacts: [{
          id: 'conv_9',
          title: 'The branch',
          updatedAt: '2026-10-02T12:00:00.000Z',
          createdAt: '2026-10-02T11:00:00.000Z',
          data: {
            nodes: [
              { id: 'n1', parentNodeId: null, content: 'Root line', createdAt: '2026-10-02T11:00:00.000Z' },
              { id: 'n2', parentNodeId: 'n1', content: 'Under it', createdAt: '2026-10-02T11:05:00.000Z' },
            ],
          },
        }],
      },
    });
    renderInShell(<WhichBranch onOpenDesk={() => {}} />);
    expect(await screen.findByText('Root line')).toBeTruthy();
    expect(screen.getByText('Under it')).toBeTruthy();
    expect(screen.queryByTestId('thread-empty')).toBeNull();
  });

  it('forum shows no posts until topic-list returns one, then posts through topic-create', async () => {
    lensRunMock.mockImplementation((_domain: string, name: string) => {
      if (name === 'topic-list') return Promise.resolve(ok({ topics: [], count: 0 }));
      if (name === 'topic-create') return Promise.resolve(ok({ topic: { id: 'top_1', title: 'Worth it' } }));
      return Promise.resolve(ok({}));
    });
    renderInShell(<TheBoard onOpenDesk={() => {}} />);
    expect(await screen.findByText("What's worth reading, Ramaj")).toBeTruthy();
    expect(await screen.findByText('No posts on the board')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '+ New post' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Worth it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(lensRunMock).toHaveBeenCalledWith('forum', 'topic-create', { title: 'Worth it', body: '' });
    });
  });

  it('forum renders the titles the board returned', async () => {
    lensRunMock.mockResolvedValue(ok({
      topics: [{ id: 'top_1', title: 'Sidechain compression', replyCount: 2, score: 7 }],
      count: 1,
    }));
    renderInShell(<TheBoard onOpenDesk={() => {}} />);
    expect(await screen.findByText('Sidechain compression')).toBeTruthy();
    expect(screen.getByText('2 replies')).toBeTruthy();
    expect(screen.queryByText('No posts on the board')).toBeNull();
  });

  it('daily counts this week from entry-list and does not invent a digest', async () => {
    lensRunMock.mockImplementation((_domain: string, name: string) => {
      if (name === 'journal-list') return Promise.resolve(ok({ journals: [{ id: 'jr_1', name: 'Production journal' }], count: 1 }));
      if (name === 'entry-list') return Promise.resolve(ok({ entries: [], count: 0 }));
      return Promise.resolve(ok({}));
    });
    renderInShell(<TodayPage onOpenDesk={() => {}} />);
    expect(await screen.findByText(/Production journal · 0 entries this week/)).toBeTruthy();
    expect(screen.getByText(/A digest appears when there is something to summarize/)).toBeTruthy();
    expect(screen.queryByTestId('daily-digest')).toBeNull();
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'export-archive')).toBe(false);
  });

  it('daily writes an entry and shows the archive header only after text exists', async () => {
    const today = localToday();
    const { start, end } = localWeekBounds();
    expect(today >= start && today <= end).toBe(true);
    lensRunMock.mockImplementation((_domain: string, name: string) => {
      if (name === 'journal-list') return Promise.resolve(ok({ journals: [{ id: 'jr_1', name: 'Production journal' }], count: 1 }));
      if (name === 'entry-list') {
        return Promise.resolve(ok({
          entries: [{ id: 'en_1', journalId: 'jr_1', date: today, body: 'Shipped the rail.', createdAt: `${today}T15:00:00.000Z` }],
          count: 1,
        }));
      }
      if (name === 'entry-create') return Promise.resolve(ok({ entry: { id: 'en_2' } }));
      if (name === 'export-archive') {
        return Promise.resolve(ok({ markdown: `# Journal Archive\n\nExported 2026-10-02T00:00:00.000Z · 1 entry\n` }));
      }
      return Promise.resolve(ok({}));
    });
    renderInShell(<TodayPage onOpenDesk={() => {}} />);
    expect(await screen.findByText('Shipped the rail.')).toBeTruthy();
    expect(await screen.findByTestId('daily-digest')).toHaveTextContent('Exported 2026-10-02T00:00:00.000Z · 1 entry');
    expect(screen.queryByText(/A digest appears/)).toBeNull();
  });
});
