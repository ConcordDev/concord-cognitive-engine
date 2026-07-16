/**
 * /lenses/collab — Invitations tab, backed by the REAL targeted (1:1)
 * invitation macros (collab.sessionInvite / sessionInviteRespond /
 * sessionInviteList — server/domains/collab.js).
 *
 * This closes docs/lens-specs/collab-capability-map.md's "GENUINELY
 * MISSING — no producer for the Invitations tab" finding. Prior to this
 * change the tab read from `useLensData('collab', 'invitation', ...)`
 * (the generic cross-user artifact store) and nothing ever produced an
 * artifact of that type — a permanently-correct-but-empty state. The real
 * producer is `collab.sessionInviteList`, consumed here via `useQuery` +
 * `lensRun` (the same pattern the page already uses for `/api/collab/active`).
 *
 * Coverage:
 *   - invitations render from real fetched data (POPULATED)
 *   - honest EMPTY state is preserved when there are genuinely no invitations
 *   - honest error surfacing when the invitation fetch fails
 *   - Accept calls collab.sessionInviteRespond({inviteId, accept:true}) and
 *     the card flips to "Accepted" (a real macro response, not a fabricated
 *     optimistic flip)
 *   - Decline calls collab.sessionInviteRespond({inviteId, accept:false})
 *     and the card flips to "Declined"
 *   - a failed respond surfaces an honest error toast and does NOT flip the
 *     card (no fabricated success)
 *   - the "Invite a User" action inside an active session calls
 *     collab.sessionInvite with the real sessionId + entered inviteeId
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── session store channel — only 'session' items matter for these tests ────
interface LensDataState {
  items: Array<{ id: string; data: Record<string, unknown> }>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}
const sessionState: LensDataState = { items: [], isLoading: false, isError: false, error: null };
const sessionRefetch = vi.fn();

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: (_domain: string, type: string) => {
    if (type === 'session') {
      return {
        items: sessionState.items,
        total: sessionState.items.length,
        isLoading: sessionState.isLoading,
        isError: sessionState.isError,
        error: sessionState.error,
        isSeeding: false,
        refetch: sessionRefetch,
        create: vi.fn(() => Promise.resolve({})),
        update: vi.fn(() => Promise.resolve({})),
        remove: vi.fn(() => Promise.resolve({})),
      };
    }
    return {
      items: [], total: 0, isLoading: false, isError: false, error: null, isSeeding: false,
      refetch: vi.fn(),
      create: vi.fn(() => Promise.resolve({})), update: vi.fn(() => Promise.resolve({})), remove: vi.fn(() => Promise.resolve({})),
    };
  },
}));

// ── invitations channel — the REAL producer under test ──────────────────────
interface InvitesQueryState {
  data: { invitations: Record<string, unknown>[]; total: number } | undefined;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}
const invitesState: InvitesQueryState = { data: { invitations: [], total: 0 }, isLoading: false, isError: false, error: null };
const invitesRefetch = vi.fn();

// react-query: branch by queryKey so the invitations channel is independently
// controllable from the pre-existing '/api/collab/active' query.
vi.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey?: unknown[] }) => {
    const key = Array.isArray(opts?.queryKey) ? opts.queryKey[0] : undefined;
    if (key === 'collab-invitations') {
      return {
        data: invitesState.data,
        isLoading: invitesState.isLoading,
        isError: invitesState.isError,
        error: invitesState.error,
        refetch: invitesRefetch,
      };
    }
    return { data: { collabs: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  },
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false }),
  useCreateArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: { collabs: [] } })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) }, artistry: { blobs: { upload: vi.fn() } } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: null } })),
  isForbidden: () => false,
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'me', username: 'me', email: 'm@x', role: 'user' } }) }));

const addToast = vi.fn();
vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ addToast }) } }));

vi.mock('@/lib/realtime/socket', () => {
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  const socket = {
    emit: vi.fn(),
    on: vi.fn((event: string, cb: (data: unknown) => void) => { (listeners[event] ||= []).push(cb); }),
    off: vi.fn((event: string) => { delete listeners[event]; }),
  };
  return { getSocket: () => socket, __emit: (event: string, data?: unknown) => { (listeners[event] || []).forEach((cb) => cb(data)); } };
});

vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

vi.mock('@/components/lens/LensShell', () => ({ LensShell: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'lens-shell' }, children) }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/UniversalActions', () => ({ UniversalActions: () => null }));
vi.mock('@/components/lens/LensFeaturePanel', () => ({ LensFeaturePanel: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
vi.mock('@/components/social/SharedSessionChat', () => ({ SharedSessionChat: () => null }));
vi.mock('@/components/collab/WorkspaceRoster', () => ({ WorkspaceRoster: () => null }));
vi.mock('@/components/collab/CollabActionPanel', () => ({ CollabActionPanel: () => null }));
vi.mock('@/components/collab/CollabDocWorkspace', () => ({ CollabDocWorkspace: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, { get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]) });
});

import CollabLensPage from '@/app/lenses/collab/page';
import { lensRun } from '@/lib/api/client';

function makeInvite(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'inv_1',
    sessionId: 's_1',
    sessionName: 'Design jam',
    fromId: 'user_a',
    fromName: 'Ana',
    toId: 'me',
    toName: 'me',
    projectType: 'design',
    genre: ['ui', 'ux'],
    message: 'join us',
    status: 'pending',
    sentAt: Date.now(),
    respondedAt: null,
    ...overrides,
  };
}

function makeSession(id: string, name: string) {
  const host = { id: 'p-host', name: 'Host', avatar: 'bg-blue-500', role: 'host', online: true };
  return {
    id,
    data: {
      id, name, projectType: 'development', host, participants: [host],
      status: 'open', privacy: 'public', genre: ['react'], maxCapacity: 6,
      description: 'a real session', startedAt: Date.now(),
    },
  };
}

async function openInvitationsTab() {
  const utils = render(<CollabLensPage />);
  await act(async () => { fireEvent.click(utils.getByText('Invitations')); });
  return utils;
}

beforeEach(() => {
  sessionState.items = [];
  sessionState.isLoading = false;
  sessionState.isError = false;
  sessionState.error = null;
  sessionRefetch.mockReset();
  invitesState.data = { invitations: [], total: 0 };
  invitesState.isLoading = false;
  invitesState.isError = false;
  invitesState.error = null;
  invitesRefetch.mockReset();
  addToast.mockReset();
  (lensRun as unknown as Mock).mockReset();
  (lensRun as unknown as Mock).mockImplementation(() => Promise.resolve({ data: { ok: true, result: null } }));
  window.localStorage.clear();
});

describe('collab lens — Invitations tab (real sessionInviteList producer)', () => {
  it('EMPTY: genuinely no invitations shows the honest "No invitations" state', async () => {
    invitesState.data = { invitations: [], total: 0 };
    const { getByText } = await openInvitationsTab();
    await waitFor(() => expect(getByText('No invitations')).toBeInTheDocument());
  });

  it('ERROR: a failed invitation fetch surfaces role=alert honestly (not a silent empty page)', async () => {
    // The page's error branch covers all three data channels (sessions,
    // invitations, history) at once, same as the pre-existing
    // collab-lens-states.test.tsx ERROR case — a failing invitation fetch
    // alone is enough to trip it, so no tab switch is needed/possible here.
    invitesState.isError = true;
    invitesState.error = new Error('invite store offline');
    invitesState.data = undefined;
    const { container, getByText } = render(<CollabLensPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/invite store offline/i)).toBeInTheDocument();
  });

  it('POPULATED: real invitations render with their real fields (from/to/session/genre)', async () => {
    invitesState.data = { invitations: [makeInvite()], total: 1 };
    const { getByText } = await openInvitationsTab();
    await waitFor(() => expect(getByText('Ana')).toBeInTheDocument());
    expect(getByText('Design jam')).toBeInTheDocument();
    expect(getByText('ui, ux')).toBeInTheDocument();
    expect(getByText('"join us"')).toBeInTheDocument();
    // the empty state must NOT show when real invitations are present.
    expect(() => getByText('No invitations')).toThrow();
  });

  it('Accept calls collab.sessionInviteRespond({inviteId, accept:true}) and the card flips to Accepted', async () => {
    invitesState.data = { invitations: [makeInvite()], total: 1 };
    (lensRun as unknown as Mock).mockImplementation((domain: string, action: string) => {
      if (domain === 'collab' && action === 'sessionInviteRespond') {
        return Promise.resolve({ data: { ok: true, result: { invite: { ...makeInvite(), status: 'accepted' } } } });
      }
      return Promise.resolve({ data: { ok: true, result: null } });
    });
    const { getByText } = await openInvitationsTab();
    await waitFor(() => expect(getByText('Ana')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Accept')); });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('collab', 'sessionInviteRespond', { inviteId: 'inv_1', accept: true })
    );
    await waitFor(() => expect(getByText(/Accepted: Design jam/)).toBeInTheDocument());
  });

  it('Decline calls collab.sessionInviteRespond({inviteId, accept:false}) and the card flips to Declined', async () => {
    invitesState.data = { invitations: [makeInvite()], total: 1 };
    (lensRun as unknown as Mock).mockImplementation((domain: string, action: string) => {
      if (domain === 'collab' && action === 'sessionInviteRespond') {
        return Promise.resolve({ data: { ok: true, result: { invite: { ...makeInvite(), status: 'declined' } } } });
      }
      return Promise.resolve({ data: { ok: true, result: null } });
    });
    const { getByText } = await openInvitationsTab();
    await waitFor(() => expect(getByText('Ana')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Decline')); });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('collab', 'sessionInviteRespond', { inviteId: 'inv_1', accept: false })
    );
    await waitFor(() => expect(getByText(/Declined: Design jam/)).toBeInTheDocument());
  });

  it('a failed respond surfaces an honest error toast and does NOT fabricate an accepted/declined state', async () => {
    invitesState.data = { invitations: [makeInvite()], total: 1 };
    (lensRun as unknown as Mock).mockImplementation((domain: string, action: string) => {
      if (domain === 'collab' && action === 'sessionInviteRespond') {
        return Promise.resolve({ data: { ok: false, result: null, error: 'invitation already accepted' } });
      }
      return Promise.resolve({ data: { ok: true, result: null } });
    });
    const { getByText } = await openInvitationsTab();
    await waitFor(() => expect(getByText('Ana')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Accept')); });
    await waitFor(() => expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'invitation already accepted' })
    ));
    // The card must still show the real pending actions — no fabricated success.
    expect(getByText('Accept')).toBeInTheDocument();
    expect(getByText('Decline')).toBeInTheDocument();
    expect(() => getByText(/Accepted:/)).toThrow();
  });
});

describe('collab lens — "Invite a User" action inside an active session', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('sends a real collab.sessionInvite call with the real sessionId + entered inviteeId', async () => {
    sessionState.items = [makeSession('s_1', 'Design jam')];
    const { getByText, getByPlaceholderText } = render(<CollabLensPage />);
    await waitFor(() => expect(getByText('Design jam')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Join')); });

    await waitFor(() => expect(getByText('Invite a User')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Invite a User')); });

    const input = getByPlaceholderText('user id to invite');
    fireEvent.change(input, { target: { value: 'user_b' } });
    await act(async () => { fireEvent.click(getByText('Send')); });

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('collab', 'sessionInvite', { sessionId: 's_1', inviteeId: 'user_b' })
    );
  });
});
