/**
 * /lenses/mesh — four-UX-state contract + a11y.
 *
 * Pins that the mesh lens overview renders genuine loading (role=status,
 * aria-busy) / error (role=alert + a working Retry that re-issues the call) /
 * empty / populated states against the real mesh.overview macro surface
 * (driven by a mocked apiHelpers.lens.runDomain standing in for
 * POST /api/lens/run → server/domains/mesh.js#overview), plus a11y (the tab
 * buttons carry aria-pressed accessible state).
 *
 * No fabricated data: every state is driven by the exact { nodes, onlineNodes,
 * messages, unread, channels, encryptedChannels, queueDepth, transports } shape
 * server/domains/mesh.js#overview returns.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── Mock the api client: lens.runDomain is the page's only data path. ────────
const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomainMock(...args) } },
}));

// Heavy child components / shells are not under test here — stub to keep the
// render focused on the page's own four states. No fake DATA is introduced;
// these are presentational shells + the other-tab panels.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/mesh/MeshRepos', () => ({ MeshRepos: () => null }));
vi.mock('@/components/mesh/MeshTopology', () => ({ MeshTopology: () => null }));
vi.mock('@/components/mesh/MeshMessaging', () => ({ MeshMessaging: () => null }));
vi.mock('@/components/mesh/MeshSignal', () => ({ MeshSignal: () => null }));
vi.mock('@/components/mesh/MeshQueue', () => ({ MeshQueue: () => null }));
vi.mock('@/components/mesh/MeshChannels', () => ({ MeshChannels: () => null }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import MeshLensPage from '@/app/lenses/mesh/page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MeshLensPage />
    </QueryClientProvider>,
  );
}

const POPULATED = {
  nodes: 3, onlineNodes: 2, messages: 5, unread: 1,
  channels: 2, encryptedChannels: 1, queueDepth: 4, transports: 7,
};
const EMPTY = {
  nodes: 0, onlineNodes: 0, messages: 0, unread: 0,
  channels: 0, encryptedChannels: 0, queueDepth: 0, transports: 7,
};

beforeEach(() => { runDomainMock.mockReset(); });

describe('mesh lens — four UX states', () => {
  it('LOADING: shows a role=status spinner while overview is in flight', async () => {
    runDomainMock.mockImplementation(() => new Promise(() => {})); // never resolves
    let view: ReturnType<typeof render>;
    await act(async () => { view = renderPage(); });
    const loading = view!.getByTestId('mesh-overview-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows role=alert + a Retry that re-issues the overview call', async () => {
    runDomainMock.mockResolvedValue({ data: { ok: false, result: null, error: 'overview boom' } });
    let view: ReturnType<typeof render>;
    await act(async () => { view = renderPage(); });

    await waitFor(() => expect(view!.getByTestId('mesh-overview-error')).toBeInTheDocument());
    const err = view!.getByTestId('mesh-overview-error');
    expect(err).toHaveAttribute('role', 'alert');
    expect(err.textContent).toMatch(/overview boom/);

    const before = runDomainMock.mock.calls.length;
    await act(async () => { fireEvent.click(view!.getByText('Retry')); });
    await waitFor(() => expect(runDomainMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('EMPTY: shows an honest empty state when the mesh has no nodes/messages/channels', async () => {
    runDomainMock.mockResolvedValue({ data: { ok: true, result: EMPTY, error: null } });
    let view: ReturnType<typeof render>;
    await act(async () => { view = renderPage(); });
    await waitFor(() => expect(view!.getByTestId('mesh-overview-empty')).toBeInTheDocument());
    expect(view!.getByTestId('mesh-overview-empty').textContent).toMatch(/no mesh yet/i);
  });

  it('POPULATED: renders the real roll-up counts; tabs expose a11y state', async () => {
    runDomainMock.mockResolvedValue({ data: { ok: true, result: POPULATED, error: null } });
    let view: ReturnType<typeof render>;
    await act(async () => { view = renderPage(); });
    await waitFor(() => expect(view!.getByTestId('mesh-overview-grid')).toBeInTheDocument());
    const grid = view!.getByTestId('mesh-overview-grid');
    // real counts from the overview shape are surfaced, not fabricated
    expect(grid.textContent).toMatch(/2 online/);
    expect(grid.textContent).toMatch(/1 unread/);
    expect(grid.textContent).toMatch(/1 encrypted/);

    // a11y: the tab buttons carry aria-pressed reflecting the active tab.
    const overviewTab = view!.getByRole('button', { name: /Overview/ });
    expect(overviewTab).toHaveAttribute('aria-pressed', 'true');
    const topologyTab = view!.getByRole('button', { name: /Topology/ });
    expect(topologyTab).toHaveAttribute('aria-pressed', 'false');
  });
});
