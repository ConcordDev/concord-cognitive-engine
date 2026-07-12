import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// AllianceWorkspace talks to the backend exclusively through lensRun('alliance', action, input).
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('framer-motion', () => ({
  motion: {
    // eslint-disable-next-line react/display-name
    div: React.forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<HTMLDivElement>) =>
      React.createElement('div', { ...props, ref }, children)
    ),
  },
  AnimatePresence: ({ children }: React.PropsWithChildren) => React.createElement(React.Fragment, null, children),
}));

import { AllianceWorkspace } from '@/components/alliance/AllianceWorkspace';

const ALLIANCE = {
  id: 'alc_1', name: 'Concord Pact', description: '', type: 'research', status: 'active',
  members: [{ userId: 'u1', displayName: 'Ada', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' }],
  myRole: 'owner', channelCount: 1, activeProposals: 0, createdAt: '2026-01-01T00:00:00.000Z',
};
const CHANNEL = { id: 'chn_1', name: 'general', topic: 'Alliance-wide discussion', messageCount: 1, unread: 0, lastMessageAt: null };
const MESSAGES = [
  {
    id: 'msg_1', channelId: 'chn_1', userId: 'u1', displayName: 'Ada',
    content: 'coffee run in 5', parentId: null, attachments: [], reactions: {},
    createdAt: '2026-01-01T00:00:01.000Z', replies: [],
  },
];
const SEARCH_HIT = {
  id: 'msg_2', channelId: 'chn_1', userId: 'u1', displayName: 'Ada',
  content: 'LAUNCH checklist attached', parentId: null, attachments: [], reactions: {},
  createdAt: '2026-01-01T00:00:02.000Z',
};

function installLensRunMock(searchImpl?: (query: string) => { data: { ok: boolean; result: unknown; error: string | null } }) {
  lensRunMock.mockImplementation(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    if (domain !== 'alliance') return { data: { ok: true, result: null, error: null } };
    switch (action) {
      case 'alliance-list':
        return { data: { ok: true, result: { alliances: [ALLIANCE] }, error: null } };
      case 'notifications':
        return { data: { ok: true, result: { totalUnread: 0, pendingInvites: 0, perAlliance: [], invites: [] }, error: null } };
      case 'channel-list':
        return { data: { ok: true, result: { channels: [CHANNEL] }, error: null } };
      case 'proposal-list':
        return { data: { ok: true, result: { proposals: [] }, error: null } };
      case 'message-list':
        return { data: { ok: true, result: { messages: MESSAGES }, error: null } };
      case 'message-search':
        if (searchImpl) return searchImpl(String(input.query || ''));
        return { data: { ok: true, result: { messages: [SEARCH_HIT], count: 1 }, error: null } };
      default:
        return { data: { ok: true, result: null, error: null } };
    }
  });
}

// Opens the workspace to its first (and only) alliance, which auto-selects
// its #general channel — that's what mounts the channel search box.
async function openWorkspace() {
  render(<AllianceWorkspace />);
  const allianceBtn = await screen.findByText('Concord Pact');
  fireEvent.click(allianceBtn);
  return screen.findByPlaceholderText('Search this channel…');
}

describe('AllianceWorkspace — channel search', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('renders a search box scoped to the open channel once a channel is selected', async () => {
    installLensRunMock();
    await openWorkspace();
    // the default (unfiltered) message list is showing
    expect(await screen.findByText('coffee run in 5')).toBeInTheDocument();
  });

  it('debounces the query, calls message-search with {channelId, query}, and highlights the match', async () => {
    installLensRunMock();
    const input = await openWorkspace();

    fireEvent.change(input, { target: { value: 'launch' } });

    // not called immediately — debounced
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'message-search')).toBe(false);

    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'message-search')).toBe(true);
    }, { timeout: 2000 });

    const searchCall = lensRunMock.mock.calls.find((c) => c[1] === 'message-search');
    expect(searchCall?.[0]).toBe('alliance');
    expect(searchCall?.[2]).toMatchObject({ channelId: 'chn_1', query: 'launch' });

    await waitFor(() => expect(screen.getByText(/1 match/)).toBeInTheDocument());
    const mark = document.querySelector('mark');
    expect(mark).toBeTruthy();
    expect(mark?.textContent?.toLowerCase()).toBe('launch');
    // normal (unfiltered) message no longer shown while a search is active
    expect(screen.queryByText('coffee run in 5')).not.toBeInTheDocument();
  });

  it('does not search on a single-character query (respects the [2,200] bound)', async () => {
    installLensRunMock();
    const input = await openWorkspace();
    fireEvent.change(input, { target: { value: 'a' } });

    await new Promise((r) => setTimeout(r, 400));
    expect(lensRunMock.mock.calls.some((c) => c[1] === 'message-search')).toBe(false);
    // still showing the normal message list
    expect(screen.getByText('coffee run in 5')).toBeInTheDocument();
  });

  it('surfaces a "No matches" state honestly instead of hiding the empty result', async () => {
    installLensRunMock(() => ({ data: { ok: true, result: { messages: [], count: 0 }, error: null } }));
    const input = await openWorkspace();
    fireEvent.change(input, { target: { value: 'nomatch' } });
    await waitFor(() => expect(screen.getByText(/No matches/)).toBeInTheDocument(), { timeout: 2000 });
  });

  it('clearing the query reverts to the normal (unfiltered) message list', async () => {
    installLensRunMock();
    const input = await openWorkspace();
    fireEvent.change(input, { target: { value: 'launch' } });
    await waitFor(() => expect(screen.getByText(/1 match/)).toBeInTheDocument(), { timeout: 2000 });

    fireEvent.click(screen.getByLabelText('Clear search'));
    expect((input as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(screen.getByText('coffee run in 5')).toBeInTheDocument());
  });
});
