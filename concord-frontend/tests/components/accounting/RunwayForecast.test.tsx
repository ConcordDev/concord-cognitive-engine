import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  const Chart = ({ children }: { children?: React.ReactNode }) => React.createElement('div', { 'data-testid': 'chart' }, children);
  const Leaf = () => React.createElement('div', { 'data-testid': 'chart-leaf' });
  return {
    AreaChart: Chart, Area: Leaf, XAxis: Leaf, YAxis: Leaf, Tooltip: Leaf,
    ResponsiveContainer: Passthrough, CartesianGrid: Leaf, ReferenceLine: Leaf,
  };
});

import { RunwayForecast } from '@/components/accounting/RunwayForecast';

const BURNING = {
  cashOnHand: 100000, openInvTotal: 20000, openBillsTotal: 8000,
  liquidity: 112000, monthlyNet: -15000, monthlyBurn: 15000, runwayMonths: 7,
  forecast: [{ month: 'Jun', projected: 85000, in: 0, out: 15000 }],
};
const SHORT = { ...BURNING, runwayMonths: 3 };
const PROFITABLE = { ...BURNING, monthlyNet: 5000, monthlyBurn: 0, runwayMonths: null };

describe('RunwayForecast', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<RunwayForecast />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows the no-data state when the result is null', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<RunwayForecast />);
    expect(await screen.findByText('No data.')).toBeInTheDocument();
  });

  it('renders tiles for a burning company with a finite runway', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: BURNING } });
    render(<RunwayForecast />);
    expect(await screen.findByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('Liquidity')).toBeInTheDocument();
    expect(screen.getByText('$100,000')).toBeInTheDocument();
    expect(screen.getByText('$-15,000')).toBeInTheDocument(); // negative monthly net
    expect(screen.getByText('7 mo')).toBeInTheDocument();
    expect(screen.getByTestId('chart')).toBeInTheDocument();
  });

  it('renders a short-runway tile (< 6 months -> negative tone)', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: SHORT } });
    render(<RunwayForecast />);
    expect(await screen.findByText('3 mo')).toBeInTheDocument();
  });

  it('renders "profitable" when runwayMonths is null', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: PROFITABLE } });
    render(<RunwayForecast />);
    expect(await screen.findByText('profitable')).toBeInTheDocument();
    expect(screen.getByText('+$5,000')).toBeInTheDocument(); // positive monthly net
  });

  it('refetches when the months selector changes', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: BURNING } });
    render(<RunwayForecast />);
    await screen.findByText('Cash');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '24' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'runway-forecast', input: { months: 24 } }),
      ),
    );
  });

  it('falls back to the no-data state on a rejected request', async () => {
    lensRun.mockRejectedValue(new Error('network'));
    render(<RunwayForecast />);
    expect(await screen.findByText('No data.')).toBeInTheDocument();
  });
});
