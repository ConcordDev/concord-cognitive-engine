/**
 * LawContracts — "Trend analytics" panel (law.contract-trends).
 *
 * Wave-4 gap closure (docs/WAVE4_INVENTORY.md `law` row / law-capability-map.md
 * "Contract lifecycle (vs. Ironclad)": "Deeper trend analytics
 * (cycle-time-to-signature, renewal-rate-over-time, spend-by-counterparty
 * trend lines) is GENUINELY MISSING — flagged future"). LawContracts now
 * fetches law.contract-trends alongside contract-list/contract-dashboard and
 * renders three trend sections via the shared ChartKit component.
 *
 * This pins: (1) a loading state (the component-wide spinner gates the panel
 * along with the rest of the workbench, since all three fetches are one
 * Promise.all), (2) a populated state where each section renders the real
 * numbers from the macro's response verbatim, and (3) an honest empty state
 * per-section (never a fabricated trend line) when the macro reports
 * hasData:false / hasTrend:false — matching the dx-platform.issueTrend
 * discipline this codebase already applies elsewhere.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

// ChartKit is a thin recharts wrapper covered by its own tests — stub it here
// so this file pins LawContracts' OWN wiring (what data it passes + when it
// renders at all), not recharts' SVG output.
vi.mock('@/components/viz/ChartKit', () => ({
  ChartKit: (props: { data: unknown[]; series: Array<{ key: string }> }) =>
    React.createElement('div', {
      'data-testid': 'chartkit-stub',
      'data-points': props.data.length,
      'data-series': props.series.map((s) => s.key).join(','),
    }),
}));

import { LawContracts } from '@/components/law/LawContracts';

const EMPTY_LIST = { data: { ok: true, result: { contracts: [], count: 0 }, error: null } };
const EMPTY_DASH = { data: { ok: true, result: { total: 0, totalValue: 0, expiringSoon: 0, unsigned: 0, byStatus: {} }, error: null } };
const EMPTY_LIBRARY = { data: { ok: true, result: { library: {} }, error: null } };

const HONEST_EMPTY_TRENDS = {
  data: {
    ok: true,
    result: {
      cycleTime: { hasData: false, count: 0, avgDays: null, medianDays: null, minDays: null, maxDays: null, samples: [] },
      spendTrend: { hasData: false, hasTrend: false, months: [], counterparties: [], series: [] },
      renewalTrend: { hasData: false, hasTrend: false, series: [] },
    },
    error: null,
  },
};

const POPULATED_TRENDS = {
  data: {
    ok: true,
    result: {
      cycleTime: { hasData: true, count: 2, avgDays: 7.5, medianDays: 7.5, minDays: 5, maxDays: 10, samples: [
        { contractId: 'ctr_1', contractTitle: 'C1', days: 5 },
        { contractId: 'ctr_2', contractTitle: 'C2', days: 10 },
      ] },
      spendTrend: {
        hasData: true, hasTrend: true, months: ['2026-01', '2026-02'], counterparties: ['Acme', 'Beta'],
        series: [
          { month: '2026-01', Acme: 3000, Beta: 0 },
          { month: '2026-02', Acme: 0, Beta: 500 },
        ],
      },
      renewalTrend: {
        hasData: true, hasTrend: true,
        series: [
          { month: '2026-01', total: 2, completed: 1, renewalRate: 50 },
          { month: '2026-02', total: 1, completed: 1, renewalRate: 100 },
        ],
      },
    },
    error: null,
  },
};

function mockImpl(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    'contract-list': EMPTY_LIST,
    'contract-dashboard': EMPTY_DASH,
    'contract-trends': HONEST_EMPTY_TRENDS,
    'clause-library': EMPTY_LIBRARY,
  };
  const merged = { ...base, ...overrides };
  lensRunMock.mockImplementation((_domain: string, action: string) => Promise.resolve(merged[action] ?? { data: { ok: true, result: {}, error: null } }));
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('LawContracts — trend analytics panel', () => {
  it('LOADING: shows a spinner and never renders the trend panel while the initial fetch is in flight', async () => {
    lensRunMock.mockImplementation(() => new Promise(() => {})); // never resolves
    const { container, queryByText } = render(<LawContracts />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(queryByText('Trend analytics')).not.toBeInTheDocument();
  });

  it('EMPTY: an honest "not enough data" message renders per-section when the macro reports hasData:false (no fabricated trend lines)', async () => {
    mockImpl();
    const { getByText, getByTestId, queryByTestId } = render(<LawContracts />);
    await waitFor(() => expect(getByText('Trend analytics')).toBeInTheDocument());

    expect(getByTestId('law-trend-cycle-time-empty')).toHaveTextContent(/No signed contracts yet/);
    expect(getByTestId('law-trend-spend-empty')).toHaveTextContent(/No contract spend yet/);
    expect(getByTestId('law-trend-renewal-empty')).toHaveTextContent(/No renewal obligations tracked yet/);

    // no chart is mounted at all for an empty bucket — not even a 0-point one.
    expect(queryByTestId('chartkit-stub')).not.toBeInTheDocument();

    // the contract-trends macro really was called (not skipped).
    expect(lensRunMock.mock.calls.some((c) => c[0] === 'law' && c[1] === 'contract-trends')).toBe(true);
  });

  it('POPULATED: renders the real cycle-time stats, and passes the real spend + renewal series into ChartKit verbatim', async () => {
    mockImpl({ 'contract-trends': POPULATED_TRENDS });
    const { getByText, getByTestId, getAllByTestId } = render(<LawContracts />);
    await waitFor(() => expect(getByText('Trend analytics')).toBeInTheDocument());

    // cycle-time-to-signature: real avg/median/count from the macro, not recomputed client-side.
    const cycle = getByTestId('law-trend-cycle-time');
    expect(cycle).toHaveTextContent('7.5d');
    expect(cycle).toHaveTextContent('2');

    // spend-by-counterparty-by-month: 2 months x 2 counterparty series, passed to ChartKit.
    const charts = getAllByTestId('chartkit-stub');
    expect(charts).toHaveLength(2);
    const spendChart = getByTestId('law-trend-spend').querySelector('[data-testid="chartkit-stub"]');
    expect(spendChart).toHaveAttribute('data-points', '2');
    expect(spendChart).toHaveAttribute('data-series', 'Acme,Beta');

    // renewal-rate-by-month.
    const renewalChart = getByTestId('law-trend-renewal').querySelector('[data-testid="chartkit-stub"]');
    expect(renewalChart).toHaveAttribute('data-points', '2');
    expect(renewalChart).toHaveAttribute('data-series', 'renewalRate');
  });

  it('PARTIAL: hasData but hasTrend:false renders the chart plus an honest "only one period" note, not a hidden/fabricated trend', async () => {
    const thin = {
      data: {
        ok: true,
        result: {
          cycleTime: { hasData: false, count: 0, avgDays: null, medianDays: null, minDays: null, maxDays: null, samples: [] },
          spendTrend: { hasData: true, hasTrend: false, months: ['2026-01'], counterparties: ['Acme'], series: [{ month: '2026-01', Acme: 300 }] },
          renewalTrend: { hasData: false, hasTrend: false, series: [] },
        },
        error: null,
      },
    };
    mockImpl({ 'contract-trends': thin });
    const { getByText, getByTestId } = render(<LawContracts />);
    await waitFor(() => expect(getByText('Trend analytics')).toBeInTheDocument());

    expect(getByTestId('law-trend-spend')).toBeInTheDocument();
    expect(getByText(/Only one month of history so far/)).toBeInTheDocument();
  });
});
