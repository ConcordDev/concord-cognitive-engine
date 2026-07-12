/**
 * /lenses/collab — four-UX-state contract for the Collaboration lens.
 *
 * The collab lens's externally-loaded surface is its session store, fetched via
 *   useLensData('collab', 'session' | 'invitation' | 'history')  →  the Active
 *   Sessions grid + tab counts. This test pins the four states against that REAL
 *   channel (the page consumes { isLoading, isError, error, refetch, items }):
 *
 *   LOADING   — an in-flight session fetch → role="status"
 *   ERROR     — a failed session fetch → role="alert" + a WORKING "Try again"
 *               that RE-FETCHES (refetch fires), never a swallowed-fetch
 *               silent-empty page
 *   EMPTY     — ok but zero sessions → an honest empty state ("No sessions found")
 *   POPULATED — real session items render their session name
 *
 * No fabricated data: every state is driven by a mocked useLensData standing in
 * for the real /api/lens/collab backend in the exact shape the page consumes.
 * The WIRING test pins that the compute-action runner is constructed on the
 * 'collab' domain (the result-card surface the macro tests cover).
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── session store channel (drives loading/error/empty/populated) ─────────────
interface LensDataState {
  items: Array<{ id: string; data: Record<string, unknown> }>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}
const sessionState: LensDataState = { items: [], isLoading: false, isError: false, error: null };
const refetch = vi.fn();

// useLensData is called per (domain, type). We branch by `type` so only the
// 'session' channel drives the four states; invitation/history/chat stay inert.
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
        refetch,
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

// react-query: the page uses useQuery directly for /api/collab/active (kept
// inert here) and useMutation under the artifact hooks.
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { collabs: [] }, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// ── compute-action channel: useRunArtifact mutate (collab domain wiring) ─────
const runMutate = vi.fn(() => Promise.resolve({ ok: true, result: {} }));
const useRunArtifactSpy = vi.fn();
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: (domain: string) => { useRunArtifactSpy(domain); return { mutateAsync: (...a: unknown[]) => runMutate(...a), mutate: vi.fn(), isPending: false }; },
  useCreateArtifact: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: { collabs: [] } })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) }, artistry: { blobs: { upload: vi.fn() } } },
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: null } })),
  isForbidden: () => false,
}));

vi.mock('@/store/ui', () => ({ useUIStore: { getState: () => ({ addToast: vi.fn() }) } }));

// Capturing socket mock for the ActiveSessionView live-roster join effect —
// `getSocket()` (not the typed `subscribe()` helper) because the page's
// screen-share signaling already uses the raw socket instance directly, and
// the roster join/leave listeners reuse that same room + socket. `__emit`
// lets a test simulate a genuine server-pushed `collab:participant-joined`/
// `-left` event.
vi.mock('@/lib/realtime/socket', () => {
  const listeners: Record<string, Array<(data: unknown) => void>> = {};
  const socket = {
    emit: vi.fn(),
    on: vi.fn((event: string, cb: (data: unknown) => void) => {
      (listeners[event] ||= []).push(cb);
    }),
    off: vi.fn((event: string) => { delete listeners[event]; }),
  };
  return {
    getSocket: () => socket,
    __emit: (event: string, data?: unknown) => {
      (listeners[event] || []).forEach((cb) => cb(data));
    },
  };
});

// realtime hook inert.
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, alerts: [], insights: [], isLive: false, lastUpdated: null }),
}));

// ── headless chrome + heavy children: inert stubs ───────────────────────────
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
vi.mock('@/components/social/SharedSessionInvite', () => ({ SharedSessionInvite: () => null }));
vi.mock('@/components/collab/WorkspaceRoster', () => ({ WorkspaceRoster: () => null }));
vi.mock('@/components/collab/CollabActionPanel', () => ({ CollabActionPanel: () => null }));
vi.mock('@/components/collab/CollabDocWorkspace', () => ({ CollabDocWorkspace: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));

// ErrorState stays real — it renders "Something went wrong" + a "Try again"
// button wired to onRetry, which the page passes as the combined refetch.

// framer-motion: render plain elements so animated nodes mount synchronously.
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

function makeSession(id: string, name: string) {
  const host = { id: 'p-host', name: 'Host', avatar: 'bg-blue-500', role: 'host', online: true };
  return {
    id,
    data: {
      id,
      name,
      projectType: 'development',
      host,
      participants: [host],
      status: 'open',
      privacy: 'public',
      genre: ['react'],
      maxCapacity: 6,
      description: 'a real session',
      startedAt: Date.now(),
    },
  };
}

beforeEach(() => {
  sessionState.items = [];
  sessionState.isLoading = false;
  sessionState.isError = false;
  sessionState.error = null;
  refetch.mockReset();
  runMutate.mockClear();
  useRunArtifactSpy.mockClear();
  (lensRun as unknown as Mock).mockReset();
  (lensRun as unknown as Mock).mockImplementation(() => Promise.resolve({ data: { ok: true, result: null } }));
  window.localStorage.clear();
});

describe('collab lens — four UX states', () => {
  it('WIRING: the action runner is constructed on the collab domain', () => {
    render(<CollabLensPage />);
    expect(useRunArtifactSpy).toHaveBeenCalledWith('collab');
  });

  it('LOADING: an in-flight session fetch shows a role=status indicator', async () => {
    sessionState.isLoading = true;
    const { container } = render(<CollabLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('ERROR: a failed fetch shows role=alert + a working Retry that re-fetches (not a silent empty page)', async () => {
    sessionState.isError = true;
    sessionState.error = new Error('session store offline');
    const { container, getByText } = render(<CollabLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/session store offline/i)).toBeInTheDocument();
    // a silent-empty page would show the "No sessions found" empty surface instead — it must NOT.
    expect(() => getByText(/No sessions found/i)).toThrow();

    // Retry must re-invoke the backend fetch (refetch), not be a dead button.
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });

  it('EMPTY: a zero-session feed shows the honest "No sessions found" empty state', async () => {
    sessionState.items = [];
    const { getByText } = render(<CollabLensPage />);
    await waitFor(() => expect(getByText(/No sessions found/i)).toBeInTheDocument());
    // the CTA points at creating one, not a fabricated placeholder session.
    expect(getByText(/create a new session/i)).toBeInTheDocument();
  });

  it('POPULATED: real session items render their session name', async () => {
    sessionState.items = [
      makeSession('s_1', 'Onboarding redesign'),
      makeSession('s_2', 'API gateway spike'),
    ];
    const { getByText } = render(<CollabLensPage />);
    await waitFor(() => expect(getByText('Onboarding redesign')).toBeInTheDocument());
    expect(getByText('API gateway spike')).toBeInTheDocument();
    // the empty state must NOT show when sessions are present.
    expect(() => getByText(/No sessions found/i)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Live participant join/leave roster sync (closes "Live participant
// join/leave with real roster sync" — docs/lens-specs/collab-capability-map.md).
// Pins that clicking "Join" calls the REAL collab.sessionJoin macro (not just
// a local `setActiveSession`), that the roster panel renders the server's
// actual returned participant set, that a genuine server-pushed
// `collab:participant-joined` socket event live-updates the roster for
// someone already viewing the session, and that leaving calls sessionLeave.
// ---------------------------------------------------------------------------
describe('collab lens — live session roster sync', () => {
  // jsdom has no scrollIntoView implementation; ActiveSessionView's chat
  // auto-scroll effect calls it unconditionally on mount.
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('Join calls collab.sessionJoin (not just opening the room) and renders the real returned roster', async () => {
    sessionState.items = [makeSession('s_1', 'Design jam')];
    (lensRun as unknown as Mock).mockImplementation((domain: string, action: string, input: { sessionId: string }) => {
      if (domain === 'collab' && action === 'sessionJoin') {
        return Promise.resolve({
          data: {
            ok: true,
            result: {
              sessionId: input.sessionId,
              participants: [{ userId: 'anon', name: 'You', joinedAt: Date.now() }],
              count: 1,
            },
          },
        });
      }
      return Promise.resolve({ data: { ok: true, result: null } });
    });

    const { getByText } = render(<CollabLensPage />);
    await waitFor(() => expect(getByText('Design jam')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Join')); });

    // The real macro was called with this session's id — not a locally
    // fabricated join.
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('collab', 'sessionJoin', { sessionId: 's_1' }));
    // The roster panel reflects the server's actual returned participant
    // count, not the session's static creation-time `participants` array.
    await waitFor(() => expect(getByText('Participants (1)')).toBeInTheDocument());
  });

  it('a genuine collab:participant-joined socket event live-updates the roster for someone already in the session', async () => {
    sessionState.items = [makeSession('s_2', 'Live roster test')];
    (lensRun as unknown as Mock).mockImplementation((domain: string, action: string, input: { sessionId: string }) => {
      if (domain === 'collab' && action === 'sessionJoin') {
        return Promise.resolve({
          data: { ok: true, result: { sessionId: input.sessionId, participants: [{ userId: 'anon', name: 'You', joinedAt: Date.now() }], count: 1 } },
        });
      }
      return Promise.resolve({ data: { ok: true, result: null } });
    });

    const { getByText } = render(<CollabLensPage />);
    await waitFor(() => expect(getByText('Live roster test')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Join')); });
    await waitFor(() => expect(getByText('Participants (1)')).toBeInTheDocument());

    // Simulate a REAL server push — another user joins the same session.
    const socketMock = await import('@/lib/realtime/socket');
    await act(async () => {
      (socketMock as unknown as { __emit: (e: string, d?: unknown) => void }).__emit(
        'collab:participant-joined',
        { sessionId: 's_2', userId: 'user_c', name: 'Cara', joinedAt: Date.now() }
      );
    });

    await waitFor(() => expect(getByText('Participants (2)')).toBeInTheDocument());
    expect(getByText('Cara')).toBeInTheDocument();
  });

  it('Leave calls collab.sessionLeave for the real session id', async () => {
    sessionState.items = [makeSession('s_3', 'Leaving test')];
    (lensRun as unknown as Mock).mockImplementation((domain: string, action: string, input: { sessionId: string }) => {
      if (domain === 'collab' && action === 'sessionJoin') {
        return Promise.resolve({
          data: { ok: true, result: { sessionId: input.sessionId, participants: [{ userId: 'anon', name: 'You', joinedAt: Date.now() }], count: 1 } },
        });
      }
      return Promise.resolve({ data: { ok: true, result: null } });
    });

    const { getByText } = render(<CollabLensPage />);
    await waitFor(() => expect(getByText('Leaving test')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByText('Join')); });
    await waitFor(() => expect(getByText('Participants (1)')).toBeInTheDocument());

    await act(async () => { fireEvent.click(getByText('Leave')); });
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('collab', 'sessionLeave', { sessionId: 's_3' }));
  });
});
