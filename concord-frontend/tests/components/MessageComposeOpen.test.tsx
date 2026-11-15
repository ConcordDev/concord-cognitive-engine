/**
 * Message lens — 'New message' must open the composer (FIX-message-001).
 *
 * The audit found the core compose flow unusable: clicking 'New message'
 * (or Enter on it) opened nothing. Two stacked causes, both pinned here
 * against the real page + inbox panel:
 *  1. InboxShell rendered its reading-pane children only when a thread
 *     was selected — the composer lives in those children, so from a
 *     fresh inbox (no thread selected) setComposing(true) had no visual
 *     effect at all.
 *  2. The page dispatched 'message:compose' on the next animation
 *     frame; when the inbox panel still had to mount (view switch +
 *     exit animation) the event fired before any listener existed.
 * The fix: InboxShell takes showChildrenWithoutThread (the panel passes
 * composing), and the page uses requestMessageCompose's pending flag —
 * the same shape as feed's requestFeedCompose.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: { data?: unknown[]; itemContent: (i: number, d: unknown) => React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'virtuoso' }, (data || []).map((d, i) => React.createElement('div', { key: i }, itemContent(i, d)))),
}));

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...a: unknown[]) => apiGet(...a), post: (...a: unknown[]) => apiPost(...a) },
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: vi.fn() }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: vi.fn() }));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: { artifacts: [] } }),
  useCreateArtifact: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children) }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/message/MessagingRepos', () => ({ MessagingRepos: () => null }));
vi.mock('@/components/message/LabelManagerPanel', () => ({ LabelManagerPanel: () => null }));
vi.mock('@/components/message/ThreadLabelBar', () => ({ ThreadLabelBar: () => null }));
vi.mock('@/components/message/RecipientSearchInput', () => ({
  RecipientSearchInput: ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
    React.createElement('input', { 'aria-label': 'recipient', value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value) }),
}));
vi.mock('@/components/message/MessageWorkbench', () => ({ default: () => null }));
vi.mock('@/components/message/SlackSection', () => ({ SlackSection: () => null }));
vi.mock('@/components/message/GmailSection', () => ({ GmailSection: () => null }));

import MessageLensPage from '@/app/lenses/message/page';

const CONVERSATIONS = [
  {
    id: 'convo-1', otherUserId: 'u2', otherDisplayName: 'Mira',
    lastMessage: { content: 'Want to take it from gen 2?', at: Date.now() },
    unreadCount: 1, starred: false,
  },
];

describe("message lens — 'New message' opens the composer (FIX-message-001)", () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/social/dm/conversations') return { data: { conversations: CONVERSATIONS } };
      if (url.startsWith('/api/social/dm/convo-1')) return { data: { messages: [] } };
      return { data: {} };
    });
    apiPost.mockResolvedValue({ data: { ok: true } });
  });

  it('from a fresh inbox with NO thread selected', async () => {
    render(<MessageLensPage />);
    await screen.findByText('Mira'); // inbox loaded, nothing selected
    expect(screen.queryByRole('heading', { name: 'New message' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New message' }));

    expect(await screen.findByRole('heading', { name: 'New message' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Body…')).toBeInTheDocument();
  });

  it('from another view (Labels) — the request survives the panel swap', async () => {
    render(<MessageLensPage />);
    await screen.findByText('Mira');
    fireEvent.click(screen.getByRole('button', { name: /Labels/ }));
    fireEvent.click(screen.getByRole('button', { name: 'New message' }));

    expect(await screen.findByRole('heading', { name: 'New message' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Body…')).toBeInTheDocument();
  });
});
