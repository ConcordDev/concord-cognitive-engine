import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  const BarChart = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'chart' }, children);
  const Leaf = () => React.createElement('div');
  return {
    BarChart, Bar: Leaf, XAxis: Leaf, YAxis: Leaf, Tooltip: Leaf,
    ResponsiveContainer: Passthrough, CartesianGrid: Leaf,
  };
});

import { StatsPanel, SearchVisibilityPanel } from '@/components/marketplace/StatsPanel';

const ROWS = [
  { listingId: 'l1', title: 'Brass Ring with a very long title here', status: 'published', views: 200, orders: 6, revenueUsd: 120, conversionRatePct: 3 },
  { listingId: 'l2', title: 'Sticker', status: 'published', views: 50, orders: 0, revenueUsd: 0, conversionRatePct: 0 },
];

const VIS_ROWS = [
  {
    listingId: 'l1', title: 'Brass Ring', totalImpressions: 12000, totalClicks: 600, overallCtrPct: 5,
    keywords: [
      { keyword: 'boho ring', impressions: 800, clicks: 60, ctrPct: 7.5 },
      { keyword: 'brass jewelry', impressions: 400, clicks: 10, ctrPct: 2.5 },
    ],
  },
];

describe('StatsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: [] } } });
  });

  it('shows loading spinner initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container } = render(<StatsPanel />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows empty state when no data', async () => {
    render(<StatsPanel />);
    expect(await screen.findByText(/No data yet/)).toBeInTheDocument();
  });

  it('renders the table, chart and conversion colour branches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: ROWS } } });
    render(<StatsPanel />);
    expect(await screen.findByText(/Brass Ring with a very long/)).toBeInTheDocument();
    expect(screen.getByText('Sticker')).toBeInTheDocument();
    expect(screen.getByTestId('chart')).toBeInTheDocument();
    expect(screen.getByText('3%')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('hides the chart when no listing has revenue', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { listings: [{ ...ROWS[1] }] } },
    });
    render(<StatsPanel />);
    await screen.findByText('Sticker');
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
  });

  it('changes the date range and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: ROWS } } });
    render(<StatsPanel />);
    await screen.findByText('Sticker');
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '90' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'analytics-by-listing', input: { days: 90 } }),
      ),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<StatsPanel />);
    expect(await screen.findByText(/No data yet/)).toBeInTheDocument();
  });
});

describe('SearchVisibilityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: [] } } });
  });

  it('shows loading spinner initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container } = render(<SearchVisibilityPanel />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('shows empty state when no impression data', async () => {
    render(<SearchVisibilityPanel />);
    expect(await screen.findByText(/No impression data yet/)).toBeInTheDocument();
  });

  it('renders visibility rows with keyword breakdown', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { listings: VIS_ROWS } } });
    render(<SearchVisibilityPanel />);
    expect(await screen.findByText('Brass Ring')).toBeInTheDocument();
    expect(screen.getByText('boho ring')).toBeInTheDocument();
    expect(screen.getByText('brass jewelry')).toBeInTheDocument();
    expect(screen.getByText('7.5%')).toBeInTheDocument();
    expect(screen.getByText('2.5%')).toBeInTheDocument();
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<SearchVisibilityPanel />);
    expect(await screen.findByText(/No impression data yet/)).toBeInTheDocument();
  });
});
