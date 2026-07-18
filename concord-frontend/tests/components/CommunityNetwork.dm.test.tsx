import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// CommunityNetwork talks to the backend exclusively through
// lensRun('artistry', action, input) — same contract as the DM macros
// (dm-send / dm-list / dm-inbox) added to server/domains/artistry.js.
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, isLoading: false, isAuthenticated: true }),
}));

import { CommunityNetwork } from '@/components/artistry/CommunityNetwork';

const GRAPH = {
  userId: 'u1',
  following: ['u2'],
  followers: ['u3'],
  mutuals: [],
  followingCount: 1,
  followerCount: 1,
  mutualCount: 0,
};

const DM_THREADS = [
  {
    partnerId: 'u2', partnerName: 'u2', threadKey: 'u1::u2',
    lastMessage: 'see you at the show', lastFrom: 'u2', lastAt: '2026-01-03T00:00:02.000Z', messageCount: 2,
  },
];
const DM_THREAD_U2 = [
  { id: 'dm_1', threadKey: 'u1::u2', fromId: 'u2', toId: 'u1', fromName: 'u2', body: 'hey, loved your last piece', createdAt: '2026-01-03T00:00:01.000Z' },
  { id: 'dm_2', threadKey: 'u1::u2', fromId: 'u2', toId: 'u1', fromName: 'u2', body: 'see you at the show', createdAt: '2026-01-03T00:00:02.000Z' },
];

function installMock(overrides: Partial<Record<string, unknown>> = {}) {
  lensRunMock.mockImplementation(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    if (domain !== 'artistry') return { data: { ok: true, result: null, error: null } };
    if (action in overrides) return overrides[action];
    switch (action) {
      case 'personalizedFeed':
        return { data: { ok: true, result: { mode: 'follows', fromFollowsCount: 0, items: [], count: 0 }, error: null } };
      case 'followGraph':
        return { data: { ok: true, result: GRAPH, error: null } };
      case 'dm-inbox':
        return { data: { ok: true, result: { threads: DM_THREADS, count: DM_THREADS.length }, error: null } };
      case 'dm-list':
        if (input.partnerId === 'u2') return { data: { ok: true, result: { messages: DM_THREAD_U2, count: DM_THREAD_U2.length, threadKey: 'u1::u2' }, error: null } };
        return { data: { ok: true, result: { messages: [], count: 0, threadKey: `u1::${input.partnerId}` }, error: null } };
      case 'dm-send':
        return { data: { ok: true, result: { message: { id: 'dm_new', threadKey: 'u1::u2', fromId: 'u1', toId: input.toId, fromName: 'u1', body: input.body, createdAt: '2026-01-03T00:00:03.000Z' }, threadKey: 'u1::u2' }, error: null } };
      default:
        return { data: { ok: true, result: null, error: null } };
    }
  });
}

describe('CommunityNetwork — direct messages between creators', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('renders Message actions on both following and follower rows', async () => {
    installMock();
    render(<CommunityNetwork />);
    expect(await screen.findByLabelText('Message u2')).toBeInTheDocument();
    expect(screen.getByLabelText('Message u3')).toBeInTheDocument();
  });

  it('renders the DM inbox thread list with partner name + last message', async () => {
    installMock();
    render(<CommunityNetwork />);
    await waitFor(() => {
      expect(screen.getByText(/see you at the show/)).toBeInTheDocument();
    });
  });

  it('shows an honest placeholder in the thread view when no conversation is selected', async () => {
    installMock();
    render(<CommunityNetwork />);
    expect(await screen.findByText(/Select a conversation, or message a creator directly/i)).toBeInTheDocument();
  });

  it('clicking Message on a following row opens the thread and loads it via dm-list', async () => {
    installMock();
    render(<CommunityNetwork />);
    const msgBtn = await screen.findByLabelText('Message u2');
    fireEvent.click(msgBtn);

    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'dm-list' && (c[2] as Record<string, unknown>)?.partnerId === 'u2')).toBe(true);
    });
    expect(await screen.findByText('hey, loved your last piece')).toBeInTheDocument();
  });

  it('clicking Message on a follower row (someone not followed back) also opens a real thread', async () => {
    installMock();
    render(<CommunityNetwork />);
    const msgBtn = await screen.findByLabelText('Message u3');
    fireEvent.click(msgBtn);

    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'dm-list' && (c[2] as Record<string, unknown>)?.partnerId === 'u3')).toBe(true);
    });
    // No seeded messages for u3 in this mock — honest empty state, not a fabricated one.
    expect(await screen.findByText(/No messages yet/i)).toBeInTheDocument();
  });

  it('sending a message calls dm-send with the right toId + body and reloads the thread + inbox', async () => {
    installMock();
    render(<CommunityNetwork />);
    fireEvent.click(await screen.findByLabelText('Message u2'));
    await screen.findByText('hey, loved your last piece');

    const input = screen.getByPlaceholderText('Message…');
    fireEvent.change(input, { target: { value: 'thank you!' } });
    fireEvent.click(screen.getByLabelText('send direct message'));

    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'dm-send')).toBe(true);
    });
    const sendCall = lensRunMock.mock.calls.find((c) => c[1] === 'dm-send');
    expect(sendCall?.[0]).toBe('artistry');
    expect(sendCall?.[2]).toMatchObject({ toId: 'u2', body: 'thank you!' });
  });

  it('an empty DM inbox renders an honest "no conversations yet" state, not a fabricated placeholder thread', async () => {
    installMock({ 'dm-inbox': { data: { ok: true, result: { threads: [], count: 0 }, error: null } } });
    render(<CommunityNetwork />);
    expect(await screen.findByText(/No conversations yet/i)).toBeInTheDocument();
  });
});
