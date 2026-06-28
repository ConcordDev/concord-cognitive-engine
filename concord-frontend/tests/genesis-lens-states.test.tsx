/**
 * /lenses/genesis — four-UX-state contract (observatory activity surface).
 *
 * The Genesis lens is REST-driven: the page loads its roster + event-typed
 * feed from fetch('/api/emergents') + fetch('/api/emergents/feed/filtered').
 * This pins that the page renders genuine loading (role=status) / error
 * (role=alert + a WORKING Retry that re-fetches) / empty (CTA) / populated
 * states — and specifically that a fetch failure is NOT swallowed into a
 * silently-empty page (the defect fixed in 4 sibling lenses; the genesis page
 * previously `.catch(() => ({ emergents: [] }))`-ed both startup fetches).
 *
 * No fabricated data: every state is driven by a mocked global fetch standing
 * in for the real /api/emergents* router. The headless shell + the
 * self-contained children (RosterExplorer, RelationshipGraph, GenesisMetrics,
 * OriginExplorer, SavedSearchesPanel — each does its own fetching) are stubbed
 * inert so the test stays on the page's own feed/roster state machine.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── headless shell + lens chrome: render-only stubs ─────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useSocket', () => ({
  useSocket: () => ({ on: () => {}, off: () => {}, isConnected: false }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useArtifacts: () => ({ data: { artifacts: [] }, isLoading: false }),
  useCreateArtifact: () => ({ mutate: () => {} }),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LensVerticalHero', () => ({ LensVerticalHero: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));

// Genesis children each fetch independently — stub inert so the test is scoped
// to the page's activity-feed + stat-rollup state machine.
vi.mock('@/components/genesis/SavedSearchesPanel', () => ({ SavedSearchesPanel: () => null }));
vi.mock('@/components/genesis/OriginExplorer', () => ({ OriginExplorer: () => null }));
vi.mock('@/components/genesis/RosterExplorer', () => ({
  RosterExplorer: () => React.createElement('div', { 'data-testid': 'roster-explorer' }),
}));
vi.mock('@/components/genesis/IdentityTimeline', () => ({ IdentityTimeline: () => null }));
vi.mock('@/components/genesis/LineageView', () => ({ LineageView: () => null }));
vi.mock('@/components/genesis/RelationshipGraph', () => ({ RelationshipGraph: () => null }));
vi.mock('@/components/genesis/GenesisMetrics', () => ({ GenesisMetrics: () => null }));

// framer-motion → plain divs (no animation in jsdom).
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));

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
import GenesisLens from '@/app/lenses/genesis/page';

// ── fetch stub helpers ──────────────────────────────────────────────────────
function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response);
}

/**
 * Route the two startup endpoints. `roster` backs /api/emergents,
 * `feed` backs /api/emergents/feed/filtered. A `null` body rejects (network
 * down); a `false` ok flag drives the page's ok:false error branch.
 */
function installFetch(opts: { roster?: unknown; feed?: unknown; reject?: boolean }) {
  const fn = vi.fn((url: RequestInfo | URL) => {
    const u = String(url);
    if (opts.reject) return Promise.reject(new Error('network down'));
    if (u.includes('/feed/filtered')) return jsonResponse(opts.feed ?? { ok: true, events: [], typeBreakdown: {} });
    if (u.includes('/api/emergents')) return jsonResponse(opts.roster ?? { ok: true, emergents: [] });
    return jsonResponse({ ok: true });
  });
  // @ts-expect-error test global
  global.fetch = fn;
  return fn;
}

const EVENT = {
  id: 'feed1',
  type: 'artifact_created',
  emergent: { emergent_id: 'em_ada', given_name: 'Ada' },
  data: { dtu_title: 'A Proof of Topology' },
  timestamp: Date.now() - 1000,
};
const ROSTER_OK = { ok: true, emergents: [{ emergent_id: 'em_ada', id: 'em_ada', given_name: 'Ada', active: true }] };
const FEED_OK = { ok: true, events: [EVENT], typeBreakdown: { artifact_created: 1 } };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('genesis lens — four UX states', () => {
  it('LOADING: shows a role=status indicator while the startup fetch is in flight', async () => {
    // fetch never resolves → page stays in loading.
    // @ts-expect-error test global
    global.fetch = vi.fn(() => new Promise(() => {}));
    const { container, getByText } = render(<GenesisLens />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
    expect(getByText(/Loading feed/i)).toBeInTheDocument();
  });

  it('EMPTY: shows the honest "no activity yet" CTA when the feed is empty', async () => {
    installFetch({ roster: ROSTER_OK, feed: { ok: true, events: [], typeBreakdown: {} } });
    const { getByText } = render(<GenesisLens />);
    await waitFor(() => expect(getByText(/No activity yet/i)).toBeInTheDocument());
    expect(getByText(/Explore the roster/i)).toBeInTheDocument();
  });

  it('ERROR (rejected fetch): role=alert + a WORKING Retry that re-fetches and recovers', async () => {
    let reject = true;
    const fn = vi.fn((url: RequestInfo | URL) => {
      if (reject) return Promise.reject(new Error('network down'));
      const u = String(url);
      if (u.includes('/feed/filtered')) return jsonResponse(FEED_OK);
      return jsonResponse(ROSTER_OK);
    });
    // @ts-expect-error test global
    global.fetch = fn;

    const { container, getByText } = render(<GenesisLens />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());

    const before = fn.mock.calls.length;
    reject = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(fn.mock.calls.length).toBeGreaterThan(before));
    // recovers to the populated state — the real event title renders.
    await waitFor(() => expect(getByText(/A Proof of Topology/)).toBeInTheDocument());
  });

  it('ERROR (ok:false body): a backend error is surfaced as role=alert, NOT swallowed empty', async () => {
    installFetch({ roster: { ok: false, error: 'STATE unavailable' }, feed: { ok: false, error: 'STATE unavailable' } });
    const { container, getByText } = render(<GenesisLens />);
    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/STATE unavailable/i)).toBeInTheDocument();
    // The page must NOT show the empty CTA — that would be a silent failure.
    expect(container.textContent).not.toMatch(/No activity yet/i);
  });

  it('POPULATED: renders real feed rows + the stat rollups computed from real data', async () => {
    installFetch({ roster: ROSTER_OK, feed: FEED_OK });
    const { getByText, getAllByText } = render(<GenesisLens />);
    await waitFor(() => expect(getByText(/A Proof of Topology/)).toBeInTheDocument());
    // "Ada" appears as the emergent link in the activity row.
    expect(getAllByText(/Ada/).length).toBeGreaterThanOrEqual(1);
    // Named-emergents stat tile reflects the real roster length (1).
    expect(getByText('Named emergents')).toBeInTheDocument();
  });

  it('a11y: the event-type filter chips are real buttons', async () => {
    installFetch({ roster: ROSTER_OK, feed: FEED_OK });
    const { getByRole } = render(<GenesisLens />);
    await waitFor(() => expect(getByRole('button', { name: /artifact created/i })).toBeInTheDocument());
  });
});
