/**
 * AnalyticsTrendChart — the artistry lens's creator-analytics trend chart,
 * closing docs/WAVE4_INVENTORY.md row 102 ("No creator analytics trends
 * (point-in-time totals only)"). Wired into PortfolioProfile.tsx for the
 * owner only, calling artistry.analyticsHistory.
 *
 * Pins: real fetched history renders in the chart, an honest insufficient-
 * history state (fewer than 2 real snapshots — never an empty/broken chart
 * on day one), and honest error surfacing on a macro failure (distinct from
 * the insufficient-history state).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
// ChartKit wraps recharts' ResponsiveContainer, which needs real layout
// measurement jsdom doesn't provide — stub it like other lens chart tests do
// (see tests/components/JobDispatchBoard.test.tsx) and assert on the real
// series data passed in instead of rendered SVG.
vi.mock('@/components/viz', () => ({
  ChartKit: (props: { data: unknown[]; series: { key: string }[] }) => (
    <div data-testid="chart-kit" data-points={props.data.length} data-series={props.series.map((s) => s.key).join(',')} />
  ),
}));

import { AnalyticsTrendChart } from '@/components/artistry/AnalyticsTrendChart';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function fail(error: string) {
  return Promise.resolve({ data: { ok: false, error, result: null } });
}

const SNAPSHOT_A = {
  id: 'asnap_1', date: '2026-07-01', totalViews: 10, totalAppreciations: 2,
  followerCount: 1, followingCount: 0, projectCount: 1,
  viewsDelta: null, appreciationsDelta: null, followerDelta: null,
};
const SNAPSHOT_B = {
  id: 'asnap_2', date: '2026-07-02', totalViews: 18, totalAppreciations: 3,
  followerCount: 2, followingCount: 0, projectCount: 1,
  viewsDelta: 8, appreciationsDelta: 1, followerDelta: 1,
};

describe('AnalyticsTrendChart', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('calls artistry.analyticsHistory on mount', async () => {
    lensRun.mockReturnValue(ok({ snapshots: [], count: 0, days: 30 }));
    render(<AnalyticsTrendChart />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('artistry', 'analyticsHistory', { days: 30 }));
  });

  it('renders an honest insufficient-history message with zero real snapshots — never an empty/broken chart', async () => {
    lensRun.mockReturnValue(ok({ snapshots: [], count: 0, days: 30 }));
    render(<AnalyticsTrendChart />);
    expect(await screen.findByText(/Check back after a few days/i)).toBeInTheDocument();
    expect(screen.queryByTestId('chart-kit')).not.toBeInTheDocument();
  });

  it('renders the same insufficient-history message with exactly ONE real snapshot (not enough to plot a trend)', async () => {
    lensRun.mockReturnValue(ok({ snapshots: [SNAPSHOT_A], count: 1, days: 30 }));
    render(<AnalyticsTrendChart />);
    expect(await screen.findByText(/Check back after a few days/i)).toBeInTheDocument();
    expect(screen.queryByTestId('chart-kit')).not.toBeInTheDocument();
  });

  it('renders a real trend chart fed by the actual fetched snapshot history once there are 2+ real points', async () => {
    lensRun.mockReturnValue(ok({ snapshots: [SNAPSHOT_A, SNAPSHOT_B], count: 2, days: 30 }));
    render(<AnalyticsTrendChart />);
    const chart = await screen.findByTestId('chart-kit');
    // Real point count — no synthetic/interpolated points added by the component.
    expect(chart.getAttribute('data-points')).toBe('2');
    // Real series keys map straight onto the macro's own field names.
    expect(chart.getAttribute('data-series')).toBe('views,appreciations,followers');
    expect(screen.getByText(/2 snapshots · last 30d/)).toBeInTheDocument();
  });

  it('surfaces an honest error distinct from the insufficient-history state when the macro fails', async () => {
    lensRun.mockReturnValue(fail('state_unavailable'));
    render(<AnalyticsTrendChart />);
    expect(await screen.findByText('state_unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/Check back after a few days/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('chart-kit')).not.toBeInTheDocument();
  });
});
