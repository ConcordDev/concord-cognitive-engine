import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

vi.mock('recharts', () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  const AreaChart = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'chart' }, children);
  const Leaf = () => React.createElement('div', { 'data-testid': 'chart-leaf' });
  return {
    AreaChart, Area: Leaf, XAxis: Leaf, YAxis: Leaf, Tooltip: Leaf,
    ResponsiveContainer: Passthrough, CartesianGrid: Leaf,
  };
});

import { ShopDashboard } from '@/components/marketplace/ShopDashboard';

const SUMMARY = {
  days: 30, visits: 120, views: 340, orderCount: 9,
  revenueUsd: 1234.5, avgOrderValueUsd: 45, conversionRatePct: 2.5,
  series: [{ date: '2026-05-01', orders: 1, revenue: 100 }],
};
const DASH = {
  listingCount: 12, publishedCount: 8, draftCount: 4,
  orderCount: 9, pendingOrders: 3, shippedOrders: 6,
  lifetimeRevenueUsd: 9999, activePromos: 2,
};

function mockBoth(summary: unknown, dash: unknown) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'analytics-summary') return Promise.resolve({ data: { ok: true, result: summary } });
    if (spec.action === 'dashboard-summary') return Promise.resolve({ data: { ok: true, result: dash } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('ShopDashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading spinner initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    const { container } = render(<ShopDashboard onJumpTo={vi.fn()} />);
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    expect(screen.getByText(/Loading dashboard/)).toBeInTheDocument();
  });

  it('shows empty state when summary/dash are null', async () => {
    mockBoth(null, null);
    render(<ShopDashboard onJumpTo={vi.fn()} />);
    expect(await screen.findByText(/No dashboard data yet/)).toBeInTheDocument();
  });

  it('renders KPIs + cards with populated data', async () => {
    mockBoth(SUMMARY, DASH);
    render(<ShopDashboard onJumpTo={vi.fn()} />);
    expect(await screen.findByText('Shop overview')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument(); // visits
    expect(screen.getByText('340')).toBeInTheDocument(); // views
    expect(screen.getByText(/2\.5% CVR/)).toBeInTheDocument();
    expect(screen.getByText('8 live · 4 drafts')).toBeInTheDocument();
    expect(screen.getByTestId('chart')).toBeTruthy();
  });

  it('hides the revenue chart when series is empty', async () => {
    mockBoth({ ...SUMMARY, series: [] }, DASH);
    render(<ShopDashboard onJumpTo={vi.fn()} />);
    await screen.findByText('Shop overview');
    expect(screen.queryByTestId('chart')).toBeNull();
  });

  it('jumps to a panel when a tile / card is clicked', async () => {
    mockBoth(SUMMARY, DASH);
    const onJumpTo = vi.fn();
    render(<ShopDashboard onJumpTo={onJumpTo} />);
    await screen.findByText('Shop overview');
    fireEvent.click(screen.getByText('Orders'));
    expect(onJumpTo).toHaveBeenCalledWith('orders');
    fireEvent.click(screen.getByText('Listings'));
    expect(onJumpTo).toHaveBeenCalledWith('listings');
    fireEvent.click(screen.getByText('Active promos'));
    expect(onJumpTo).toHaveBeenCalledWith('marketing');
  });

  it('changing the date range re-fetches', async () => {
    mockBoth(SUMMARY, DASH);
    render(<ShopDashboard onJumpTo={vi.fn()} />);
    await screen.findByText('Shop overview');
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '7' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'analytics-summary', input: { days: 7 } }),
      ),
    );
  });

  it('handles fetch rejection by leaving an empty state', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<ShopDashboard onJumpTo={vi.fn()} />);
    expect(await screen.findByText(/No dashboard data yet/)).toBeInTheDocument();
  });
});
