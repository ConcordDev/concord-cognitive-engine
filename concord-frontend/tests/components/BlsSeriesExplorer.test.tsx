/**
 * BlsSeriesExplorer — the BLS labor-series explorer's Forecast overlay.
 *
 * The overlay is a pure frontend wire onto two already-real backend macros:
 *   hr.bls-series-lookup  → real BLS API v2 series (year/period/value)
 *   temporal.forecast     → real Holt-Winters / Holt-double-exponential
 *                            forecast with grid-search auto-tuning
 * Both go through the same `apiHelpers.lens.runDomain(domain, action, { input })`
 * channel the rest of the codebase uses, so this test drives that channel
 * directly rather than hitting a live backend.
 *
 * Covers the honesty contract from CLAUDE.md: a forecast toggle must never
 * render a fabricated line — only a real `temporal.forecast` result, or an
 * honest "not enough history" / error state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const runDomain = vi.fn();

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: { runDomain: (...args: unknown[]) => runDomain(...args) },
  },
}));

// SaveAsDtuButton pulls in its own store/motion/api deps that are orthogonal
// to the forecast overlay — stub it the same way hr-lens-states.test.tsx
// stubs unrelated substrate mounts.
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => React.createElement('button', { 'data-testid': 'save-as-dtu' }, 'Save'),
}));

// lightweight-charts is loaded via dynamic import purely for rendering — stub
// it so the chart-paint effect runs without touching a real canvas, same
// pattern as MarketsQuoteDetail.test.tsx.
vi.mock('lightweight-charts', () => {
  const mkSeries = () => ({ setData: vi.fn() });
  const mkChart = () => ({ addSeries: vi.fn(() => mkSeries()), remove: vi.fn() });
  return {
    createChart: vi.fn(mkChart),
    LineSeries: 'LineSeries',
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3, SparseDotted: 4 },
  };
});

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { BlsSeriesExplorer } from '@/components/hr/BlsSeriesExplorer';

function renderWithQuery(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

// 6 ascending monthly points — newest-first, mirroring the real BLS API v2
// response order (the component must reverse-sort before forecasting).
const SIX_MONTHLY_POINTS = [
  { year: '2026', period: 'M06', periodName: 'June', value: 4.2 },
  { year: '2026', period: 'M05', periodName: 'May', value: 4.1 },
  { year: '2026', period: 'M04', periodName: 'April', value: 4.0 },
  { year: '2026', period: 'M03', periodName: 'March', value: 3.9 },
  { year: '2026', period: 'M02', periodName: 'February', value: 3.9 },
  { year: '2026', period: 'M01', periodName: 'January', value: 3.8 },
];

function mockBlsResult(points: typeof SIX_MONTHLY_POINTS) {
  return {
    ok: true,
    result: {
      series: [{ seriesId: 'LNS14000000', data: points }],
      seriesCount: 1, startYear: '2026', endYear: '2026', authenticated: false, source: 'bls-public-api-v2',
    },
  };
}

const FORECAST_RESULT = {
  n: 6, horizon: 2, method: 'holt-winters-additive',
  parameters: { alpha: 0.3, beta: 0.1, gamma: 0.1 },
  period: 12,
  predictions: [
    { step: 1, forecast: 4.3, lower95: 4.0, upper95: 4.6, lower80: 4.1, upper80: 4.5 },
    { step: 2, forecast: 4.4, lower95: 4.0, upper95: 4.8, lower80: 4.15, upper80: 4.65 },
  ],
  trend: { direction: 'increasing' as const, perPeriod: 0.08, lastLevel: 4.2 },
  accuracy: { mse: 0.01, rmse: 0.1, mape: '2.3%' },
  accuracyLabel: 'excellent' as const,
};

describe('BlsSeriesExplorer — Forecast overlay', () => {
  beforeEach(() => {
    runDomain.mockReset();
  });

  it('loads the BLS series on mount via hr.bls-series-lookup', async () => {
    runDomain.mockResolvedValue({ data: mockBlsResult(SIX_MONTHLY_POINTS) });
    renderWithQuery(<BlsSeriesExplorer />);
    await waitFor(() => expect(screen.getByText('4.2')).toBeInTheDocument());
    expect(runDomain).toHaveBeenCalledWith('hr', 'bls-series-lookup', { input: { seriesId: 'LNS14000000' } });
    // Forecast toggle is present but off by default — no forecast call yet.
    expect(runDomain.mock.calls.some((c) => c[0] === 'temporal')).toBe(false);
  });

  it('toggling Forecast calls temporal.forecast with chronologically-sorted values + monthly period', async () => {
    runDomain.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'hr' && action === 'bls-series-lookup') return { data: mockBlsResult(SIX_MONTHLY_POINTS) };
      if (domain === 'temporal' && action === 'forecast') return { data: { ok: true, result: FORECAST_RESULT } };
      return { data: { ok: false, error: 'unexpected call' } };
    });
    renderWithQuery(<BlsSeriesExplorer />);
    await waitFor(() => expect(screen.getByText('4.2')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /forecast/i }));

    await waitFor(() => {
      const call = runDomain.mock.calls.find((c) => c[0] === 'temporal' && c[1] === 'forecast');
      expect(call).toBeTruthy();
    });
    const forecastCall = runDomain.mock.calls.find((c) => c[0] === 'temporal' && c[1] === 'forecast');
    // values must be ascending (oldest→newest) — the raw BLS payload above is
    // newest-first, so this pins the component's reverse-sort.
    expect(forecastCall?.[2]).toEqual({ input: { values: [3.8, 3.9, 3.9, 4.0, 4.1, 4.2], period: 12 } });

    // The real forecast result renders honestly: MAPE + fit label + horizon.
    await waitFor(() => expect(screen.getByText(/2\.3%/)).toBeInTheDocument());
    expect(screen.getByText(/excellent fit/i)).toBeInTheDocument();
    expect(screen.getByText(/2-period/i)).toBeInTheDocument();
    expect(screen.getByText(/trend increasing/i)).toBeInTheDocument();
  });

  it('honest failure: too few points never renders a fabricated forecast line', async () => {
    const twoPoints = SIX_MONTHLY_POINTS.slice(0, 2);
    runDomain.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'hr' && action === 'bls-series-lookup') return { data: mockBlsResult(twoPoints) };
      // temporal.forecast should never even be called — the component gates
      // client-side on the same 4-point floor the backend enforces.
      if (domain === 'temporal' && action === 'forecast') return { data: { ok: false, error: 'Need at least 4 data points.' } };
      return { data: { ok: false, error: 'unexpected call' } };
    });
    renderWithQuery(<BlsSeriesExplorer />);
    // data[0] is the "latest" reading (BLS returns newest-first) — the raw
    // slice's first element is June (4.2), not sorted.
    await waitFor(() => expect(screen.getByText('4.2')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /forecast/i }));

    await waitFor(() => expect(screen.getByText(/not enough history to forecast/i)).toBeInTheDocument());
    // Never called the backend — the honest gate fires before any network call.
    expect(runDomain.mock.calls.some((c) => c[0] === 'temporal')).toBe(false);
    // No fabricated MAPE/trend caption rendered alongside the honest message.
    expect(screen.queryByText(/mape/i)).toBeNull();
  });

  it('honest failure: a real backend {ok:false} surfaces its own message, never a fabricated line', async () => {
    runDomain.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'hr' && action === 'bls-series-lookup') return { data: mockBlsResult(SIX_MONTHLY_POINTS) };
      if (domain === 'temporal' && action === 'forecast') return { data: { ok: false, error: 'handler_error' } };
      return { data: { ok: false, error: 'unexpected call' } };
    });
    renderWithQuery(<BlsSeriesExplorer />);
    await waitFor(() => expect(screen.getByText('4.2')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /forecast/i }));

    await waitFor(() => expect(screen.getByText('handler_error')).toBeInTheDocument());
    expect(screen.queryByText(/mape/i)).toBeNull();
  });

  it('toggling Forecast off clears the forecast caption', async () => {
    runDomain.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'hr' && action === 'bls-series-lookup') return { data: mockBlsResult(SIX_MONTHLY_POINTS) };
      if (domain === 'temporal' && action === 'forecast') return { data: { ok: true, result: FORECAST_RESULT } };
      return { data: { ok: false, error: 'unexpected call' } };
    });
    renderWithQuery(<BlsSeriesExplorer />);
    await waitFor(() => expect(screen.getByText('4.2')).toBeInTheDocument());

    const toggle = screen.getByRole('button', { name: /forecast/i });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByText(/2\.3%/)).toBeInTheDocument());

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByText(/mape/i)).toBeNull());
  });
});
