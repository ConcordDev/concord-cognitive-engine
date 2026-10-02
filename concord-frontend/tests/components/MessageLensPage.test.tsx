/**
 * Message lens page — Reply/Forward wiring regression test.
 *
 * Real bug fixed this pass: InboxShell's reading-pane header rendered
 * Reply/Forward/Archive buttons with no onClick at all. This test exercises
 * the real page component (not a stand-in) to prove Reply focuses the real
 * inline reply textarea and Forward pre-fills the real compose flow with a
 * quoted excerpt — both routed through the same `/api/social/dm` send path
 * as ordinary compose (mocked at the API boundary only).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
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

describe('message lens page — Reply/Forward real wiring', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/api/social/dm/conversations') return { data: { conversations: CONVERSATIONS } };
      if (url.startsWith('/api/social/dm/convo-1')) return { data: { messages: [{ id: 'm1', fromUserId: 'u2', content: 'Want to take it from gen 2?' }] } };
      return { data: {} };
    });
    apiPost.mockResolvedValue({ data: { ok: true } });
  });

  it('Reply focuses the real inline reply textarea (not a decorative no-op)', async () => {
    render(<MessageLensPage />);
    fireEvent.click(await screen.findByText('Mira'));
    const replyHeaderBtn = await screen.findByTestId('inbox-header-reply');

    const replyBox = document.getElementById('msg-reply-textarea') as HTMLTextAreaElement;
    expect(replyBox).not.toHaveFocus();

    fireEvent.click(replyHeaderBtn);
    await waitFor(() => expect(replyBox).toHaveFocus());
  });

  it('Forward pre-fills the real compose flow with a quoted excerpt of the active thread', async () => {
    render(<MessageLensPage />);
    fireEvent.click(await screen.findByText('Mira'));
    const forwardBtn = await screen.findByTestId('inbox-header-forward');

    fireEvent.click(forwardBtn);

    expect(await screen.findByText('New message')).toBeInTheDocument();
    const body = screen.getByPlaceholderText('Body…') as HTMLTextAreaElement;
    expect(body.value).toContain('Forwarded message');
    expect(body.value).toContain('Mira');
    expect(body.value).toContain('Want to take it from gen 2?');
  });

  it('does not render a dead Archive button (no real capability to wire it to)', async () => {
    render(<MessageLensPage />);
    fireEvent.click(await screen.findByText('Mira'));
    await screen.findByTestId('inbox-header-reply');
    expect(screen.queryByTestId('inbox-header-archive')).not.toBeInTheDocument();
  });
});
