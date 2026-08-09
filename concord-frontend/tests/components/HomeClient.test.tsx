import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// HomeClient composes ~25 heavy dashboard panels, each with its own
// independent data-fetching and its own test coverage elsewhere. Stubbing
// them here keeps this file scoped to HomeClient's OWN logic — the
// entered/auth-check gate, the classic/new dashboard switch, the query
// wiring + data-normalization memos, and the layout/collapse branches that
// live directly in this file — rather than re-testing every child.
vi.mock('next/dynamic', () => ({ default: () => () => null }));

function stub(name: string) {
  const C = (props: Record<string, unknown>) => React.createElement('div', { 'data-testid': name, ...pickTestProps(props) });
  C.displayName = name;
  return C;
}
// Forward a couple of interaction-relevant props as DOM attributes/handlers
// so tests can still exercise real callbacks (onDtuClick, onNodeClick, etc.)
// through the stub without re-implementing each panel.
function pickTestProps(props: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (typeof props.onEnter === 'function') out.onClick = props.onEnter;
  return out;
}

vi.mock('@/components/home/MyDashboard', () => ({ MyDashboard: stub('my-dashboard') }));
vi.mock('@/components/graphs/ResonanceEmpireGraph', () => ({ ResonanceEmpireGraph: stub('resonance-graph') }));
vi.mock('@/components/dtu/DTUEmpireCard', () => ({
  DTUEmpireCard: ({ dtu, onClick }: { dtu: { id: string; summary: string }; onClick: (d: unknown) => void }) =>
    React.createElement('div', { 'data-testid': 'dtu-card', onClick: () => onClick(dtu) }, dtu.summary),
}));
vi.mock('@/components/sovereignty/LockDashboard', () => ({ LockDashboard: stub('lock-dashboard') }));
vi.mock('@/components/graphs/CoherenceBadge', () => ({ CoherenceBadge: stub('coherence-badge') }));
vi.mock('@/components/landing/LandingPage', () => ({
  LandingPage: ({ onEnter }: { onEnter: () => void }) =>
    React.createElement('button', { onClick: onEnter }, 'Enter Concord'),
}));
vi.mock('@/components/emergent/EmergentPanel', () => ({ EmergentPanel: stub('emergent-panel') }));
vi.mock('@/components/emergent/GovernanceFeed', () => ({ GovernanceFeed: stub('governance-feed') }));
vi.mock('@/components/live/LiveDTUFeed', () => ({
  LiveDTUFeed: ({ onDtuClick }: { onDtuClick: (id: string) => void }) =>
    React.createElement('button', { onClick: () => onDtuClick('live-dtu-1') }, 'live-feed-item'),
}));
vi.mock('@/components/live/ScopeIndicator', () => ({ ScopeIndicator: stub('scope-indicator') }));
vi.mock('@/components/guidance/InspectorDrawer', () => ({
  InspectorDrawer: ({ entityType, entityId, onClose }: { entityType: string; entityId: string; onClose: () => void }) =>
    React.createElement('div', { 'data-testid': 'inspector-drawer' }, [
      React.createElement('span', { key: 'label' }, `${entityType}:${entityId}`),
      React.createElement('button', { key: 'close', onClick: onClose }, 'Close inspector'),
    ]),
}));
vi.mock('@/components/brief/MorningBrief', () => ({ MorningBrief: stub('morning-brief') }));
vi.mock('@/components/common/ContextResurrection', () => ({ ContextResurrection: stub('context-resurrection') }));
vi.mock('@/components/dreams/SubstrateDreams', () => ({ SubstrateDreams: stub('substrate-dreams') }));
vi.mock('@/components/metabolism/MetabolismPanel', () => ({ MetabolismPanel: stub('metabolism-panel') }));
vi.mock('@/components/memory/EpisodicMemory', () => ({ EpisodicMemory: stub('episodic-memory') }));
vi.mock('@/components/council/BrainCouncil', () => ({ BrainCouncil: stub('brain-council') }));
vi.mock('@/components/agents/AgentPersonas', () => ({ AgentPersonas: stub('agent-personas') }));
vi.mock('@/components/tasks/TaskDelegation', () => ({ TaskDelegation: stub('task-delegation') }));
vi.mock('@/components/gardens/KnowledgeGardens', () => ({ KnowledgeGardens: stub('knowledge-gardens') }));
vi.mock('@/components/economy/BountiesAndFutures', () => ({ BountiesAndFutures: stub('bounties-futures') }));
vi.mock('@/components/weather/SubstrateWeather', () => ({ SubstrateWeather: stub('substrate-weather') }));
vi.mock('@/components/twin/CognitiveDigitalTwin', () => ({ CognitiveDigitalTwin: stub('digital-twin') }));
vi.mock('@/components/swarm/SwarmIntelligence', () => ({ SwarmIntelligence: stub('swarm-intelligence') }));
vi.mock('@/components/temporal/TimeCrystals', () => ({ TimeCrystals: stub('time-crystals') }));
vi.mock('@/components/nervous/NervousSystem', () => ({ NervousSystem: stub('nervous-system') }));
vi.mock('@/components/import/UniversalImport', () => ({ UniversalImport: stub('universal-import') }));
vi.mock('@/components/social/TrendingDomains', () => ({ TrendingDomains: stub('trending-domains') }));

const apiGet = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...(args as [string, unknown?])),
  },
  apiHelpers: {
    dtus: {
      paginated: vi.fn().mockResolvedValue({ data: { dtus: [] } }),
      stats: vi.fn().mockResolvedValue({ data: null }),
    },
    scope: { metrics: vi.fn().mockResolvedValue({ data: null }) },
    graph: {
      force: vi.fn().mockResolvedValue({ data: null }),
      visual: vi.fn().mockResolvedValue({ data: null }),
    },
  },
}));

import { HomeClient } from '@/components/home/HomeClient';

const ENTERED_KEY = 'concord_entered';

function defaultApiGet(url: string) {
  if (url === '/api/auth/me') return Promise.resolve({ data: { ok: true } });
  if (url === '/api/auth/csrf-token') return Promise.resolve({ data: { ok: true } });
  if (url === '/api/status') return Promise.resolve({ data: { version: 'v9.9', llm: { enabled: true }, counts: { dtus: 42, events: 3 } } });
  if (url === '/api/events') return Promise.resolve({ data: { events: [] } });
  if (url === '/api/lattice/resonance') return Promise.resolve({ data: { coherence: 0.5 } });
  if (url === '/api/system/health') return Promise.resolve({ data: { status: 'ok' } });
  if (url === '/api/guidance/suggestions') return Promise.resolve({ data: null });
  if (url === '/api/dream/history') return Promise.resolve({ data: null });
  if (url === '/api/admin/forgetting/status') return Promise.resolve({ data: null });
  if (url === '/api/sovereignty/status') return Promise.resolve({ data: { lockPercentage: 12 } });
  return Promise.resolve({ data: null });
}

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HomeClient />
    </QueryClientProvider>,
  );
}

// MyDashboard (mocked to a trivial stub) is the DEFAULT home surface;
// DashboardPage — where essentially all of this file's own query wiring and
// data-normalization logic lives — only renders behind the per-user
// "classic view" toggle. Most tests below need that toggle on to exercise
// HomeClient's own statements rather than the (separately-tested) new
// dashboard's internals.
function enterAsClassicUser() {
  localStorage.setItem(ENTERED_KEY, 'true');
  localStorage.setItem('concord:dashboard:prefs', JSON.stringify({ hidden: {}, classic: true }));
}

describe('HomeClient', () => {
  beforeEach(async () => {
    localStorage.clear();
    apiGet.mockReset();
    apiGet.mockImplementation(defaultApiGet);
    // apiHelpers' mocked fns are module-level singletons (unlike apiGet,
    // which is recreated via mockImplementation above) — a persistent
    // override (mockRejectedValue) from one test would otherwise leak into
    // the next. Restore each to its default resolved shape every test.
    const { apiHelpers } = await import('@/lib/api/client');
    (apiHelpers.dtus.paginated as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ data: { dtus: [] } });
    (apiHelpers.dtus.stats as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ data: null });
    (apiHelpers.scope.metrics as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ data: null });
    (apiHelpers.graph.force as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ data: null });
    (apiHelpers.graph.visual as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ data: null });
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the landing page for a first-time visitor and persists entry on click', async () => {
    renderHome();
    const enterBtn = await screen.findByText('Enter Concord');
    fireEvent.click(enterBtn);
    await waitFor(() => expect(localStorage.getItem(ENTERED_KEY)).toBe('true'));
  });

  it('shows a loading skeleton then the dashboard for a returning, authenticated user', async () => {
    enterAsClassicUser();
    renderHome();
    await waitFor(() => expect(screen.getByLabelText(/Loading your dashboard/i)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Concordos Dashboard')).toBeInTheDocument(), { timeout: 5000 });
  });

  it('redirects to /login when the auth check fails outside the just-logged-in grace window', async () => {
    enterAsClassicUser();
    apiGet.mockImplementation((url: string) => (url === '/api/auth/me' ? Promise.reject(new Error('401')) : defaultApiGet(url)));
    renderHome();
    await waitFor(() => expect(window.location.href).toBe('/login'));
    expect(localStorage.getItem(ENTERED_KEY)).toBeNull();
  });

  it('retries once and recovers when auth fails within 5s of a fresh login', async () => {
    enterAsClassicUser();
    localStorage.setItem('concord_login_ts', String(Date.now()));
    let call = 0;
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/auth/me') {
        call += 1;
        return call === 1 ? Promise.reject(new Error('401')) : Promise.resolve({ data: { ok: true } });
      }
      return defaultApiGet(url);
    });
    renderHome();
    await waitFor(() => expect(screen.getByText('Concordos Dashboard')).toBeInTheDocument(), { timeout: 5000 });
    expect(window.location.href).toBe('');
  });

  it('gives up and redirects when the grace-window retry also fails', async () => {
    enterAsClassicUser();
    localStorage.setItem('concord_login_ts', String(Date.now()));
    apiGet.mockImplementation((url: string) => (url === '/api/auth/me' ? Promise.reject(new Error('401')) : defaultApiGet(url)));
    renderHome();
    await waitFor(() => expect(window.location.href).toBe('/login'));
    expect(localStorage.getItem(ENTERED_KEY)).toBeNull();
    expect(localStorage.getItem('concord_login_ts')).toBeNull();
  });

  it('lets the user through with a warning toast when the auth check times out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    enterAsClassicUser();
    apiGet.mockImplementation((url: string) => (url === '/api/auth/me' ? new Promise(() => {}) : defaultApiGet(url)));
    renderHome();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(screen.getByText('Concordos Dashboard')).toBeInTheDocument(), { timeout: 5000 });
  }, 15000);

  it('renders the metrics row, DTU tier stats, and Core 5 quick links with real data', async () => {
    enterAsClassicUser();
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/auth/me') return Promise.resolve({ data: { ok: true } });
      return defaultApiGet(url);
    });
    renderHome();
    await waitFor(() => expect(screen.getByText('50%')).toBeInTheDocument(), { timeout: 5000 }); // coherence 0.5 -> 50%
    expect(screen.getByText('Explore Lenses')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Studio')).toBeInTheDocument();
  });

  it('shows an error state for Recent DTUs when the paginated fetch keeps failing', async () => {
    enterAsClassicUser();
    const { apiHelpers } = await import('@/lib/api/client');
    // Persistent rejection — the query's own `retry: 2` means a
    // mockRejectedValueOnce would let the first retry succeed against the
    // module-level default mock instead of ever reaching isError.
    (apiHelpers.dtus.paginated as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    renderHome();
    await waitFor(() => expect(screen.getByText(/Unable to load DTUs/i)).toBeInTheDocument(), { timeout: 8000 });
  }, 10000);

  it('shows the empty state for Recent DTUs when there are none', async () => {
    enterAsClassicUser();
    renderHome();
    await waitFor(() => expect(screen.getByText(/No DTUs yet/i)).toBeInTheDocument(), { timeout: 5000 });
  });

  it('opens the inspector drawer when a DTU card is clicked, and closes it', async () => {
    enterAsClassicUser();
    const { apiHelpers } = await import('@/lib/api/client');
    (apiHelpers.dtus.paginated as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { dtus: [{ id: 'dtu-1', summary: 'A test DTU', tier: 'regular', timestamp: '2026-01-01' }] },
    });
    renderHome();
    const card = await screen.findByTestId('dtu-card', {}, { timeout: 5000 });
    fireEvent.click(card);
    await waitFor(() => expect(screen.getByTestId('inspector-drawer')).toBeInTheDocument());
    expect(screen.getByText('dtu:dtu-1')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close inspector'));
    await waitFor(() => expect(screen.queryByTestId('inspector-drawer')).not.toBeInTheDocument());
  });

  it('opens the inspector drawer from the live DTU feed click handler too', async () => {
    enterAsClassicUser();
    renderHome();
    const liveFeedItem = await screen.findByText('live-feed-item', {}, { timeout: 5000 });
    fireEvent.click(liveFeedItem);
    await waitFor(() => expect(screen.getByText('dtu:live-dtu-1')).toBeInTheDocument());
  });

  it('shows the dream/forgetting indicator banners when data is present', async () => {
    enterAsClassicUser();
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/dream/history') return Promise.resolve({ data: { dreams: [{ title: 'Recursive selves' }] } });
      if (url === '/api/admin/forgetting/status') return Promise.resolve({ data: { lifetimeForgotten: 7, threshold: 0.2 } });
      return defaultApiGet(url);
    });
    renderHome();
    await waitFor(() => expect(screen.getByText(/Concord dreamed about: Recursive selves/)).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText(/7 DTUs archived/)).toBeInTheDocument();
  });

  it('renders guidance suggestions when present', async () => {
    enterAsClassicUser();
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/guidance/suggestions') return Promise.resolve({ data: { suggestions: [{ id: 's1', title: 'Try the Chat lens' }] } });
      return defaultApiGet(url);
    });
    renderHome();
    await waitFor(() => expect(screen.getByText('Try the Chat lens')).toBeInTheDocument(), { timeout: 5000 });
  });

  it('collapses the queue stats row when every queue is idle, and expands on click', async () => {
    enterAsClassicUser();
    renderHome();
    const collapsed = await screen.findByText('Queues: all idle', {}, { timeout: 5000 });
    fireEvent.click(collapsed);
    await waitFor(() => expect(screen.getByText('Ingest Queue')).toBeInTheDocument());
  });

  it('shows real queue values (not collapsed) when at least one queue is non-zero', async () => {
    enterAsClassicUser();
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/status') return Promise.resolve({ data: { queues: { ingest: 5 }, counts: {} } });
      return defaultApiGet(url);
    });
    renderHome();
    await waitFor(() => expect(screen.getByText('Ingest Queue')).toBeInTheDocument(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument(), { timeout: 5000 });
  });

  it('falls back to the force-graph-empty "lattice is forming" placeholder when there is no graph data', async () => {
    enterAsClassicUser();
    renderHome();
    await waitFor(() => expect(screen.getByText(/Lattice is forming/i)).toBeInTheDocument(), { timeout: 5000 });
  });

  it('renders the 2D resonance graph once force-graph data is present', async () => {
    enterAsClassicUser();
    const { apiHelpers } = await import('@/lib/api/client');
    (apiHelpers.graph.force as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { nodes: [{ id: 'n1', label: 'Node 1' }], links: [{ source: 'n1', target: 'n1' }] },
    });
    renderHome();
    await waitFor(() => expect(screen.getByTestId('resonance-graph')).toBeInTheDocument(), { timeout: 5000 });
  });

  it('toggles from the classic dashboard back to the new one', async () => {
    enterAsClassicUser();
    localStorage.setItem('concord:dashboard:prefs', JSON.stringify({ hidden: {}, classic: true }));
    renderHome();
    const toggle = await screen.findByText('← New dashboard', {}, { timeout: 5000 });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText('← New dashboard')).not.toBeInTheDocument());
    expect(screen.getByTestId('my-dashboard')).toBeInTheDocument();
  });
});
