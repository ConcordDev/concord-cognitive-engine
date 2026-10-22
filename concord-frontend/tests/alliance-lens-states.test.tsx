/**
 * /lenses/alliance — KPI strip + mutation-refetch contract (sweep F1).
 *
 * The header tiles read `alliance.alliance-list` via useMacroDispatchFeedback.
 * Workspace create/join/leave must refetch that summary without a remount.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';
import React, { useCallback, useState } from 'react';

type Status = 'idle' | 'dispatched' | 'running' | 'done' | 'error';

const lensRunMock = vi.fn();
const dispatchSpy = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/hooks/useMacroDispatchFeedback', () => ({
  useMacroDispatchFeedback: () => {
    const [status, setStatus] = useState<Status>('done');
    const [result, setResult] = useState<{ alliances: unknown[]; count: number } | null>({
      alliances: [],
      count: 0,
    });
    const [error, setError] = useState<string | null>(null);
    const dispatch = useCallback(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
      dispatchSpy(domain, action, input);
      setStatus('dispatched');
      const r = await lensRunMock(domain, action, input);
      if (r?.data?.ok === false) {
        setError(r.data.error || 'failed');
        setStatus('error');
        setResult(null);
        return null;
      }
      setResult((r?.data?.result as { alliances: unknown[]; count: number }) || { alliances: [], count: 0 });
      setError(null);
      setStatus('done');
      return r?.data?.result ?? null;
    }, []);
    return {
      status,
      runId: null,
      domain: 'alliance',
      action: 'alliance-list',
      result,
      error,
      ms: null,
      stage: null,
      dispatch,
      reset: vi.fn(),
    };
  },
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'tester' }, isLoading: false, isAuthenticated: true }) }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/alliance/AllianceAnalyticsPanel', () => ({ AllianceAnalyticsPanel: () => null }));
vi.mock('@/components/alliance/FactionWarIntel', () => ({ FactionWarIntel: () => null }));
vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  MotionConfig: ({ children }: { children?: import('react').ReactNode }) => children,
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import AllianceLens from '@/app/lenses/alliance/page';

const CREATED = {
  id: 'alc_new',
  name: 'Fresh Pact',
  description: '',
  type: 'research',
  status: 'forming',
  members: [{ userId: 'u1', displayName: 'Tester', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z', isMe: true }],
  myRole: 'owner',
  channelCount: 1,
  activeProposals: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
};

let store: { alliances: typeof CREATED[] };

function installLensRun() {
  store = { alliances: [] };
  lensRunMock.mockImplementation(async (domain: string, action: string, input: Record<string, unknown> = {}) => {
    if (domain !== 'alliance') return { data: { ok: true, result: null, error: null } };
    switch (action) {
      case 'alliance-list':
        return { data: { ok: true, result: { alliances: store.alliances, count: store.alliances.length }, error: null } };
      case 'notifications':
        return { data: { ok: true, result: { totalUnread: 0, pendingInvites: 0, perAlliance: [], invites: [] }, error: null } };
      case 'alliance-create': {
        const row = { ...CREATED, name: String(input.name || CREATED.name) };
        store.alliances = [row];
        return { data: { ok: true, result: { alliance: row, defaultChannel: { id: 'chn_1', name: 'general' } }, error: null } };
      }
      case 'channel-list':
        return { data: { ok: true, result: { channels: [{ id: 'chn_1', name: 'general', topic: '', messageCount: 0, unread: 0, lastMessageAt: null }] }, error: null } };
      case 'proposal-list':
        return { data: { ok: true, result: { proposals: [] }, error: null } };
      case 'message-list':
        return { data: { ok: true, result: { messages: [] }, error: null } };
      case 'dm-inbox':
        return { data: { ok: true, result: { threads: [] }, error: null } };
      default:
        return { data: { ok: true, result: null, error: null } };
    }
  });
}

beforeEach(() => {
  lensRunMock.mockReset();
  dispatchSpy.mockClear();
  installLensRun();
});

function alliancesJoinedValue(): string {
  const tile = screen.getByText('Alliances joined').closest('[role="listitem"]');
  expect(tile).toBeTruthy();
  return within(tile as HTMLElement).getByText(/^\d+$/).textContent || '';
}

describe('alliance lens — header KPI refetch after create', () => {
  it('F1 loads tiles at 0, create mutation refetches alliance-list, tiles show 1 without remount', async () => {
    render(<AllianceLens />);

    // Mount load + settle on empty summary.
    await waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith('alliance', 'alliance-list', {}));
    await waitFor(() => expect(alliancesJoinedValue()).toBe('0'));

    dispatchSpy.mockClear();

    // Open create form in the mounted workspace and create.
    fireEvent.click(screen.getByLabelText('new alliance'));
    const nameInput = await screen.findByPlaceholderText(/Alliance name/i);
    fireEvent.change(nameInput, { target: { value: 'Fresh Pact' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith('alliance', 'alliance-create', expect.objectContaining({ name: 'Fresh Pact' })));
    // Header must re-dispatch alliance-list from the summary-changed notify (no remount).
    await waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith('alliance', 'alliance-list', {}));

    await waitFor(() => expect(alliancesJoinedValue()).toBe('1'));
    // Still the same shell — no full page remount required.
    expect(screen.getByTestId('lens-shell')).toBeInTheDocument();
  });

  it('F1 after alliance:summary-changed, strip refetches alliance-list without Refresh', async () => {
    render(<AllianceLens />);
    await waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith('alliance', 'alliance-list', {}));
    dispatchSpy.mockClear();
    window.dispatchEvent(new Event('alliance:summary-changed'));
    await waitFor(() => expect(dispatchSpy).toHaveBeenCalledWith('alliance', 'alliance-list', {}));
  });
});
