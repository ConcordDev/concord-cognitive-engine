/**
 * /lenses/kingdoms — four-UX-state contract (REST list surface).
 *
 * The kingdoms lens PAGE drives the REST surface: GET /api/kingdoms (list),
 * GET /api/kingdoms/_meta/decree-kinds, GET /api/kingdoms/:id. This pins that
 * the list view renders genuine loading (role=status) / error (role=alert with
 * a WORKING Retry that re-fetches) / empty (CTA) / populated states, and that a
 * fetch failure is NOT swallowed into a silently-empty page.
 *
 * No fabricated data: every state is driven by a mocked global.fetch standing
 * in for the real backend, in exactly the { ok, kingdoms } shape routes/kingdoms.js
 * returns. The headless LensShell + the self-contained CK3 child components
 * (HistoryExplorer, RealmActionPanel, DynastyRealmManager, WarCampaignSession)
 * are stubbed inert so the test stays on the page's own list state machine.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── headless shell + lens chrome: render-only stubs ─────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/SessionRail', () => ({ SessionRail: () => null }));
vi.mock('@/components/lens/DraftedTextarea', () => ({ DraftedTextarea: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/mobile/MobileTabBar', () => ({ MobileTabBar: () => null }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));

// CK3 children do their own fetching; stub them inert so the test is scoped to
// the page's list state machine.
vi.mock('@/components/kingdoms/HistoryExplorer', () => ({ HistoryExplorer: () => null }));
vi.mock('@/components/kingdoms/RealmActionPanel', () => ({ RealmActionPanel: () => null }));
vi.mock('@/components/kingdoms/WarCampaignSession', () => ({ WarCampaignSession: () => null }));
vi.mock('@/components/kingdoms/DynastyRealmManager', () => ({ DynastyRealmManager: () => null }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

// Import AFTER mocks are registered.
import KingdomsPage from '@/app/lenses/kingdoms/page';

const KINGDOM = {
  id: 'kdm_1', world_id: 'fantasy-realm', name: 'Aldenholt',
  ruler_user_id: 'user-aaaaaaaaaaaa', ruler_faction_id: null,
  claim_strength: 12, founded_at: 1_700_000_000, region_polygon: [[0, 0], [100, 0], [100, 100], [0, 100]],
};

// Helper: build a fetch mock that routes by URL. decree-kinds always resolves
// (the page fetches it on mount); the /api/kingdoms list is the surface we drive.
function fetchRouter(listImpl: (url: string) => unknown) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/_meta/decree-kinds')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, kinds: {} }) });
    }
    return Promise.resolve(listImpl(url));
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('kingdoms lens — four UX states (REST list)', () => {
  it('LOADING: shows a role=status indicator while the list is in flight', async () => {
    const fetchMock = fetchRouter(() => new Promise(() => {})); // list never resolves
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<KingdomsPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getByText(/Loading kingdoms/i)).toBeInTheDocument();
  });

  it('EMPTY: shows the honest "no kingdoms" CTA when the list is empty', async () => {
    const fetchMock = fetchRouter(() => ({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, kingdoms: [] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { getByText, container } = render(<KingdomsPage />);
    await waitFor(() => expect(getByText(/No kingdoms in any world yet/i)).toBeInTheDocument());
    expect(getByText(/Found one to claim a region/i)).toBeInTheDocument();
    // empty is NOT the error state
    expect(container.querySelector('[role="alert"]')).toBeFalsy();
  });

  it('ERROR: a failed list load shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    const fetchMock = fetchRouter(() => {
      if (fail) return { ok: false, status: 500, json: () => Promise.resolve({ ok: false, error: 'realm registry down' }) };
      return { ok: true, status: 200, json: () => Promise.resolve({ ok: true, kingdoms: [KINGDOM] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<KingdomsPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/realm registry down/i)).toBeInTheDocument();

    const before = fetchMock.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Try again')); });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
    // recovers to populated
    await waitFor(() => expect(getByText('Aldenholt')).toBeInTheDocument());
  });

  it('ERROR: a thrown fetch (network failure) is NOT swallowed into an empty page', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/_meta/decree-kinds')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, kinds: {} }) });
      }
      return Promise.reject(new Error('connection refused'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container, getByText } = render(<KingdomsPage />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/connection refused/i)).toBeInTheDocument();
    // the empty CTA must NOT be shown when the load actually failed
    expect(() => getByText(/No kingdoms in any world yet/i)).toThrow();
  });

  it('POPULATED: renders the real kingdom row from the list payload', async () => {
    const fetchMock = fetchRouter(() => ({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, kingdoms: [KINGDOM] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { getByText } = render(<KingdomsPage />);
    await waitFor(() => expect(getByText('Aldenholt')).toBeInTheDocument());
    // the row carries real fields from the payload: world id, vertex count, strength
    expect(getByText('fantasy-realm')).toBeInTheDocument();
    expect(getByText(/4 vertices/)).toBeInTheDocument();
    expect(getByText(/Strength: 12/)).toBeInTheDocument();
  });

  it('a11y: the header navigation controls are real buttons with accessible text', async () => {
    const fetchMock = fetchRouter(() => ({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, kingdoms: [] }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { getByRole } = render(<KingdomsPage />);
    await waitFor(() => expect(getByRole('button', { name: /Browse/i })).toBeInTheDocument());
    expect(getByRole('button', { name: /Found/i })).toBeInTheDocument();
  });
});
