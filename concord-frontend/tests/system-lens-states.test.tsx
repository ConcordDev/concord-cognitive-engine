/**
 * /lenses/system — four-UX-state contract + a11y.
 *
 * Pins that the System Lens overview renders genuine loading (role=status,
 * aria-busy) / error (role=alert + a working Retry that re-issues the call) /
 * empty / populated states against the real system.cartograph macro surface
 * (driven by a mocked apiHelpers.lens.runDomain standing in for
 * POST /api/lens/run → the inline system.cartograph macro reading
 * audit/cartograph/SYSTEMS.json), plus a11y (the tab buttons carry aria-pressed
 * accessible state).
 *
 * No fabricated data: every state is driven by the exact SystemsReport shape
 * the cartograph macro returns. Heavy realtime panels (Metrics/Alerts/Logs/…)
 * and the live-status hook are stubbed so the render stays on the page's own
 * four-state machine.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── api client: lens.runDomain (cartograph) is the page's primary data path. ──
const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomainMock(...args) } },
  // The realtime panels are stubbed, but lensRun is imported transitively;
  // provide a benign default so nothing throws if a stub leaks a call.
  lensRun: vi.fn().mockResolvedValue({ data: { ok: true, result: {}, error: null } }),
}));

// Headless shells + heavy panels are not under test — stub them so the render
// focuses on the page's own four states. No fake DATA is introduced.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/system/SystemHealthPanel', () => ({ SystemHealthPanel: () => null }));
vi.mock('@/components/system/MetricsPanel', () => ({ MetricsPanel: () => null }));
vi.mock('@/components/system/AlertsPanel', () => ({ AlertsPanel: () => null }));
vi.mock('@/components/system/LogViewer', () => ({ LogViewer: () => null }));
vi.mock('@/components/system/HeartbeatHealthPanel', () => ({ HeartbeatHealthPanel: () => null }));
vi.mock('@/components/system/TracesPanel', () => ({ TracesPanel: () => null }));
vi.mock('@/components/system/TrendPanel', () => ({ TrendPanel: () => null }));
vi.mock('@/components/system/CustomDashboard', () => ({ CustomDashboard: () => null }));
vi.mock('@/components/system/DomainProbeCard', () => ({ DomainProbeCard: () => null }));
// useLiveStatus is a realtime poll loop; keep it quiet (no firing/heartbeat data).
vi.mock('@/components/system/useLiveStatus', () => ({
  useLiveStatus: () => ({ live: false, setLive: () => {}, status: null }),
}));
vi.mock('@/lib/headless-probes', () => ({ probesByGroup: () => [] }));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import SystemLensPage from '@/app/lenses/system/page';

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SystemLensPage />
    </QueryClientProvider>,
  );
}

const baseStats = {
  tableCount: 674, routeCount: 3353, macroCount: 9623, macroDomainCount: 492,
  heartbeatCount: 127, lensCount: 261, moduleCount: 219, deadTableCount: 4,
  orphanModuleCount: 0, dormantModuleCount: 2, coverageInScope: 100, coveragePresent: 90,
};
const EMPTY_STATS = {
  ...baseStats,
  tableCount: 0, routeCount: 0, macroCount: 0, lensCount: 0,
  coverageInScope: 0, coveragePresent: 0,
};
function report(stats: typeof baseStats) {
  return {
    generatedAt: '2026-06-27T00:00:00.000Z',
    stats,
    static: { heartbeatCallsites: [] },
    runtime: { booted: true, heartbeats: [] },
    crossRef: { deadTables: [], dormantModules: [], headlessBackends: [], orphanLenses: [] },
    coverage: [],
    drift: [],
  };
}

beforeEach(() => { runDomainMock.mockReset(); });

describe('system lens — four UX states', () => {
  it('LOADING: shows a role=status spinner while cartograph is in flight', async () => {
    runDomainMock.mockImplementation(() => new Promise(() => {})); // never resolves
    let view: ReturnType<typeof render>;
    await act(async () => { view = renderPage(); });
    const loading = view!.getByTestId('system-overview-loading');
    expect(loading).toBeInTheDocument();
    expect(loading).toHaveAttribute('role', 'status');
    expect(loading).toHaveAttribute('aria-busy', 'true');
  });

  it('ERROR: shows role=alert + a Retry that re-issues the cartograph call', async () => {
    runDomainMock.mockResolvedValue({ data: { ok: false, result: null, reason: 'cartograph_boom' } });
    let view: ReturnType<typeof render>;
    await act(async () => { view = renderPage(); });

    await waitFor(() => expect(view!.getByTestId('system-overview-error')).toBeInTheDocument());
    const err = view!.getByTestId('system-overview-error');
    expect(err).toHaveAttribute('role', 'alert');
    expect(err.textContent).toMatch(/cartograph_boom/);

    const before = runDomainMock.mock.calls.length;
    await act(async () => { fireEvent.click(view!.getByText('Retry')); });
    await waitFor(() => expect(runDomainMock.mock.calls.length).toBeGreaterThan(before));
  });

  it('EMPTY: shows an honest empty state when the cartograph inventoried nothing', async () => {
    runDomainMock.mockResolvedValue({ data: { ok: true, systems: report(EMPTY_STATS) } });
    let view: ReturnType<typeof render>;
    await act(async () => { view = renderPage(); });
    await waitFor(() => expect(view!.getByTestId('system-overview-empty')).toBeInTheDocument());
    expect(view!.getByTestId('system-overview-empty').textContent).toMatch(/no cartograph data yet/i);
  });

  it('POPULATED: renders the real inventory counts; tabs expose a11y state', async () => {
    runDomainMock.mockResolvedValue({ data: { ok: true, systems: report(baseStats) } });
    let view: ReturnType<typeof render>;
    await act(async () => { view = renderPage(); });
    await waitFor(() => expect(view!.getByTestId('system-overview-grid')).toBeInTheDocument());
    const grid = view!.getByTestId('system-overview-grid');
    // real counts from the report shape are surfaced, not fabricated
    expect(grid.textContent).toMatch(/674/);   // tableCount
    expect(grid.textContent).toMatch(/9623/);  // macroCount
    expect(grid.textContent).toMatch(/90%/);   // coveragePct = 90/100

    // a11y: the tab buttons carry aria-pressed reflecting the active tab.
    const overviewTab = view!.getByRole('button', { name: /Overview/ });
    expect(overviewTab).toHaveAttribute('aria-pressed', 'true');
    const metricsTab = view!.getByRole('button', { name: /Metrics/ });
    expect(metricsTab).toHaveAttribute('aria-pressed', 'false');
  });
});
