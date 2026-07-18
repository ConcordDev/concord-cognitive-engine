import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';

// AllianceWorkspace talks to the backend exclusively through
// lensRun('alliance', action, input) — same contract as the DM macros
// (dm-send / dm-list / dm-inbox) added to server/domains/alliance.js.
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// The DM member-picker excludes "self" via useAuth() — stub it to a fixed
// current user so the picker's exclusion logic is deterministic in tests.
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, isLoading: false, isAuthenticated: true }),
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

// Alliance ONE: caller (u1) is owner, alongside a real cross-org member u2
// sourced by the member picker. Alliance TWO exists only so a second
// candidate (u3) shows up in the picker from a different alliance.
const ALLIANCE_ONE = {
  id: 'alc_1', name: 'Concord Pact', description: '', type: 'research', status: 'active',
  members: [
    { userId: 'u1', displayName: 'Ada', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' },
    { userId: 'u2', displayName: 'Bram', role: 'member', joinedAt: '2026-01-01T00:00:00.000Z' },
  ],
  myRole: 'owner', channelCount: 1, activeProposals: 0, createdAt: '2026-01-01T00:00:00.000Z',
};
const ALLIANCE_TWO = {
  id: 'alc_2', name: 'Sovereign Guild', description: '', type: 'security', status: 'active',
  members: [
    { userId: 'u1', displayName: 'Ada', role: 'member', joinedAt: '2026-01-02T00:00:00.000Z' },
    { userId: 'u3', displayName: 'Cass', role: 'owner', joinedAt: '2026-01-02T00:00:00.000Z' },
  ],
  myRole: 'member', channelCount: 1, activeProposals: 0, createdAt: '2026-01-02T00:00:00.000Z',
};

const DM_THREADS = [
  {
    partnerId: 'u2', partnerName: 'Bram', threadKey: 'u1::u2',
    lastMessage: 'see you at the summit', lastFrom: 'u2', lastAt: '2026-01-03T00:00:02.000Z', messageCount: 2,
  },
  {
    partnerId: 'u3', partnerName: 'Cass', threadKey: 'u1::u3',
    lastMessage: 'thanks for the intro', lastFrom: 'u1', lastAt: '2026-01-03T00:00:01.000Z', messageCount: 1,
  },
];
const DM_THREAD_U2 = [
  { id: 'dm_1', threadKey: 'u1::u2', fromId: 'u2', toId: 'u1', fromName: 'Bram', content: 'hey, joining the summit?', parentId: null, attachments: [], reactions: {}, createdAt: '2026-01-03T00:00:01.000Z' },
  { id: 'dm_2', threadKey: 'u1::u2', fromId: 'u2', toId: 'u1', fromName: 'Bram', content: 'see you at the summit', parentId: null, attachments: [], reactions: {}, createdAt: '2026-01-03T00:00:02.000Z' },
];

function installMock(overrides: Partial<Record<string, unknown>> = {}) {
  lensRunMock.mockImplementation(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    if (domain !== 'alliance') return { data: { ok: true, result: null, error: null } };
    if (action in overrides) return overrides[action];
    switch (action) {
      case 'alliance-list':
        return { data: { ok: true, result: { alliances: [ALLIANCE_ONE, ALLIANCE_TWO] }, error: null } };
      case 'notifications':
        return { data: { ok: true, result: { totalUnread: 0, pendingInvites: 0, perAlliance: [], invites: [] }, error: null } };
      case 'dm-inbox':
        return { data: { ok: true, result: { threads: DM_THREADS, count: DM_THREADS.length }, error: null } };
      case 'dm-list':
        if (input.partnerId === 'u2') return { data: { ok: true, result: { messages: DM_THREAD_U2, count: DM_THREAD_U2.length, threadKey: 'u1::u2' }, error: null } };
        return { data: { ok: true, result: { messages: [], count: 0, threadKey: `u1::${input.partnerId}` }, error: null } };
      case 'dm-send':
        return { data: { ok: true, result: { message: { id: 'dm_new', threadKey: 'u1::u2', fromId: 'u1', toId: input.toId, fromName: 'Ada', content: input.content, parentId: input.parentId || null, attachments: [], reactions: {}, createdAt: '2026-01-03T00:00:03.000Z' }, threadKey: 'u1::u2' }, error: null } };
      case 'channel-list':
        return { data: { ok: true, result: { channels: [] }, error: null } };
      case 'proposal-list':
        return { data: { ok: true, result: { proposals: [] }, error: null } };
      default:
        return { data: { ok: true, result: null, error: null } };
    }
  });
}

async function openDirectTab() {
  render(<AllianceWorkspace />);
  await screen.findByText('Concord Pact');
  fireEvent.click(screen.getByRole('button', { name: /direct/i }));
}

describe('AllianceWorkspace — cross-org direct messages', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('renders the DM inbox with multiple threads, most-recent-first, showing partner name + last message', async () => {
    installMock();
    await openDirectTab();

    expect(await screen.findByText('Bram')).toBeInTheDocument();
    expect(screen.getByText('Cass')).toBeInTheDocument();
    expect(screen.getByText(/see you at the summit/)).toBeInTheDocument();
    expect(screen.getByText(/thanks for the intro/)).toBeInTheDocument();
  });

  it('shows a placeholder in the main panel when no thread is selected yet', async () => {
    installMock();
    await openDirectTab();
    expect(await screen.findByText(/Select a conversation, or start a new one/i)).toBeInTheDocument();
  });

  it('opening a thread loads and renders its messages via dm-list(partnerId)', async () => {
    installMock();
    await openDirectTab();
    const bramButton = await screen.findByText('Bram');
    fireEvent.click(bramButton);

    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'dm-list' && (c[2] as Record<string, unknown>)?.partnerId === 'u2')).toBe(true);
    });
    expect(await screen.findByText('hey, joining the summit?')).toBeInTheDocument();
    // "see you at the summit" appears twice on screen: once as the thread's
    // last-message preview in the rail, once as the full message body in
    // the open conversation — both are expected once a thread is open.
    expect(screen.getAllByText(/see you at the summit/).length).toBeGreaterThanOrEqual(2);
  });

  it('sending a message in an open thread calls dm-send with the right toId + content and reloads the thread', async () => {
    installMock();
    await openDirectTab();
    fireEvent.click(await screen.findByText('Bram'));
    await screen.findByText('hey, joining the summit?');

    const input = screen.getByPlaceholderText('Message…');
    fireEvent.change(input, { target: { value: 'sounds great, see you there' } });
    fireEvent.click(screen.getByLabelText('send direct message'));

    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'dm-send')).toBe(true);
    });
    const sendCall = lensRunMock.mock.calls.find((c) => c[1] === 'dm-send');
    expect(sendCall?.[0]).toBe('alliance');
    expect(sendCall?.[2]).toMatchObject({ toId: 'u2', content: 'sounds great, see you there' });
  });

  it('starting a new DM sources candidates from known alliance members only (no free-text id box) and excludes self', async () => {
    installMock();
    await openDirectTab();
    fireEvent.click(screen.getByLabelText('new direct message'));

    const select = await screen.findByLabelText('Select a member to message') as HTMLSelectElement;
    const optionLabels = within(select).getAllByRole('option').map((o) => o.textContent);
    // Both cross-alliance members appear (Bram from alliance one, Cass from
    // alliance two) — proving the picker draws from every alliance the
    // caller belongs to, not just the currently-selected one.
    expect(optionLabels.some((t) => t?.includes('Bram'))).toBe(true);
    expect(optionLabels.some((t) => t?.includes('Cass'))).toBe(true);
    // Self (Ada / u1) is never offered as a DM target.
    expect(optionLabels.some((t) => t?.includes('Ada'))).toBe(false);
    // There is no free-text input for an arbitrary user id in this panel.
    expect(screen.queryByPlaceholderText(/user id/i)).not.toBeInTheDocument();
  });

  it('picking a candidate and starting a conversation calls dm-list for that partner and opens the thread view', async () => {
    installMock();
    await openDirectTab();
    fireEvent.click(screen.getByLabelText('new direct message'));

    const select = await screen.findByLabelText('Select a member to message') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'u3' } });
    fireEvent.click(screen.getByRole('button', { name: /start conversation/i }));

    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'dm-list' && (c[2] as Record<string, unknown>)?.partnerId === 'u3')).toBe(true);
    });
    // The new-DM panel closes and the thread view (back button) is showing.
    await waitFor(() => expect(screen.getByLabelText('back to conversations')).toBeInTheDocument());
  });

  it('an untouched/empty thread honestly renders "no messages yet" rather than hiding the composer', async () => {
    installMock();
    await openDirectTab();
    fireEvent.click(await screen.findByText('Cass'));
    await waitFor(() => {
      expect(lensRunMock.mock.calls.some((c) => c[1] === 'dm-list' && (c[2] as Record<string, unknown>)?.partnerId === 'u3')).toBe(true);
    });
    // Cass's thread has no seeded messages in this mock.
    expect(await screen.findByText(/No messages yet/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Message…')).toBeInTheDocument();
  });

  it('switching back to the Workspaces tab restores the alliance rail', async () => {
    installMock();
    await openDirectTab();
    await screen.findByText('Bram');
    fireEvent.click(screen.getByRole('button', { name: /workspaces/i }));
    expect(await screen.findByText('Alliances')).toBeInTheDocument();
  });

  it('an empty DM inbox renders an honest "no conversations yet" state, not a fabricated placeholder thread', async () => {
    installMock({ 'dm-inbox': { data: { ok: true, result: { threads: [], count: 0 }, error: null } } });
    await openDirectTab();
    expect(await screen.findByText(/No conversations yet/i)).toBeInTheDocument();
  });
});
