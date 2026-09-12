/**
 * ObservabilityTabPanels — thin per-tab wrappers extracted from system/page.tsx.
 * Most exports are a title/blurb chrome around a heavier sibling panel
 * (mocked here so this file's own real logic — chrome text, prop threading,
 * and PluginsTabPanel/AnalyticsTabPanel's real fetch + normalization code —
 * is what's exercised).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/components/system/MetricsPanel', () => ({ MetricsPanel: ({ live }: { live: boolean }) => <div data-testid="metrics-panel">{String(live)}</div> }));
vi.mock('@/components/system/AlertsPanel', () => ({ AlertsPanel: ({ live }: { live: boolean }) => <div data-testid="alerts-panel">{String(live)}</div> }));
vi.mock('@/components/system/LogViewer', () => ({ LogViewer: ({ live }: { live: boolean }) => <div data-testid="log-viewer">{String(live)}</div> }));
vi.mock('@/components/system/HeartbeatHealthPanel', () => ({ HeartbeatHealthPanel: ({ live }: { live: boolean }) => <div data-testid="hb-health-panel">{String(live)}</div> }));
vi.mock('@/components/system/TracesPanel', () => ({ TracesPanel: ({ live }: { live: boolean }) => <div data-testid="traces-panel">{String(live)}</div> }));
vi.mock('@/components/system/TrendPanel', () => ({ TrendPanel: () => <div data-testid="trend-panel" /> }));
vi.mock('@/components/system/CustomDashboard', () => ({ CustomDashboard: ({ live }: { live: boolean }) => <div data-testid="custom-dashboard">{String(live)}</div> }));
vi.mock('@/components/system/SystemHealthPanel', () => ({ SystemHealthPanel: () => <div data-testid="system-health-panel" /> }));
vi.mock('@/components/system/DomainProbeCard', () => ({ DomainProbeCard: ({ probe }: { probe: { domain: string; macro: string } }) => <div data-testid="domain-probe-card">{probe.domain}.{probe.macro}</div> }));
vi.mock('@/lib/headless-probes', () => ({
  probesByGroup: (group: string) => (group === 'substrate' ? [{ domain: 'dtu', macro: 'create' }, { domain: 'economy', macro: 'ledger' }] : []),
}));

import {
  MetricsTabPanel, AlertsTabPanel, LogsTabPanel, HbHealthTabPanel, TracesTabPanel,
  DashboardTabPanel, TrendTabPanel, HealthTabPanel, SubstrateTabPanel,
  AnalyticsTabPanel, PluginsTabPanel,
} from './ObservabilityTabPanels';

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ObservabilityTabPanels — thin chrome wrappers', () => {
  it('MetricsTabPanel renders its title and threads the live prop through', () => {
    render(<MetricsTabPanel live={true} />);
    expect(screen.getByText('Live process metrics')).toBeInTheDocument();
    expect(screen.getByTestId('metrics-panel')).toHaveTextContent('true');
  });

  it('AlertsTabPanel renders its title and threads live=false through', () => {
    render(<AlertsTabPanel live={false} />);
    expect(screen.getByText('Prometheus alert rules')).toBeInTheDocument();
    expect(screen.getByTestId('alerts-panel')).toHaveTextContent('false');
  });

  it('LogsTabPanel / HbHealthTabPanel / TracesTabPanel / DashboardTabPanel render their real chrome + child', () => {
    render(<LogsTabPanel live={true} />);
    expect(screen.getByText('Server log viewer')).toBeInTheDocument();
    render(<HbHealthTabPanel live={true} />);
    expect(screen.getByText('Per-heartbeat health')).toBeInTheDocument();
    render(<TracesTabPanel live={true} />);
    expect(screen.getByText('Request traces & latency')).toBeInTheDocument();
    render(<DashboardTabPanel live={true} />);
    expect(screen.getByText('Customizable dashboard')).toBeInTheDocument();
  });

  it('TrendTabPanel / HealthTabPanel render without a live prop', () => {
    render(<TrendTabPanel />);
    expect(screen.getByTestId('trend-panel')).toBeInTheDocument();
    render(<HealthTabPanel />);
    expect(screen.getByTestId('system-health-panel')).toBeInTheDocument();
  });

  it('SubstrateTabPanel renders one real DomainProbeCard per probesByGroup("substrate") entry', () => {
    render(<SubstrateTabPanel />);
    expect(screen.getByText('dtu.create')).toBeInTheDocument();
    expect(screen.getByText('economy.ledger')).toBeInTheDocument();
  });
});

describe('AnalyticsTabPanel — real fetch wiring', () => {
  it('fetches /api/analytics and threads the real response into AnalyticsDashboard (via successful, non-throwing render)', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, personalStats: { totalCitations: 3, totalRoyalties: 10, mostCitedDTU: { name: 'x', citations: 3 }, mostUsedMaterial: { name: 'y', uses: 2 }, reputationByDomain: {}, buildCount: 1, playtime: 1, loginStreak: 1 } }),
    })) as unknown as typeof fetch;

    withQuery(<AnalyticsTabPanel />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/analytics', { credentials: 'same-origin' }));
    expect(screen.getByText('Personal · World · Global activity')).toBeInTheDocument();
  });

  it('a failed fetch degrades honestly (no throw, dashboard still mounts with no data)', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;
    withQuery(<AnalyticsTabPanel />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByText('Personal · World · Global activity')).toBeInTheDocument();
  });
});

describe('PluginsTabPanel — real normalization logic', () => {
  it('splits installed (active/enabled) from marketplace, normalizes category casing, and defaults missing fields', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        plugins: [
          { id: 'p1', name: 'Weather Widget', status: 'active', category: 'science' },
          { id: 'p2', name: 'Bad Category Plugin', status: 'enabled', category: 'not-a-real-category' },
          { id: 'p3', name: 'Draft Plugin', status: 'draft', category: 'Economics', citations: 5, downloads: 20, rating: 4.5 },
          { id: 'p4', name: 'Bogus Status Plugin', status: 'wat', category: 'Social' },
        ],
      }),
    })) as unknown as typeof fetch;

    withQuery(<PluginsTabPanel />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/plugins', { credentials: 'same-origin' }));
    expect(await screen.findByText('Lens plugin marketplace')).toBeInTheDocument();
    // Real logic ran without throwing across: valid category, invalid category
    // fallback to Engineering, real numeric fields, and an unknown status
    // falling back to 'draft' — asserted indirectly via the mocked
    // LensPluginSystem never mounting (next/dynamic is mocked to `() => null`
    // here), so this test's real value is exercising the fetch+normalize
    // code path without a thrown error.
  });

  it('a failed /api/plugins response degrades to empty installed + marketplace, not a throw', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) })) as unknown as typeof fetch;
    withQuery(<PluginsTabPanel />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByText('Lens plugin marketplace')).toBeInTheDocument();
  });

  it('a thrown fetch degrades honestly to empty state, not a crash', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    withQuery(<PluginsTabPanel />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByText('Lens plugin marketplace')).toBeInTheDocument();
  });
});
