import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

// lightweight-charts is loaded via dynamic import — stub it so the chart
// effect runs without a real canvas.
vi.mock('lightweight-charts', () => {
  const series = { setData: vi.fn() };
  const chart = {
    addSeries: vi.fn(() => series),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    remove: vi.fn(),
  };
  return {
    createChart: vi.fn(() => chart),
    AreaSeries: 'AreaSeries',
    LineSeries: 'LineSeries',
  };
});

import { NetWorthTracker } from '@/components/finance/NetWorthTracker';

const SNAPSHOTS = [
  { date: '2026-01-01', cash: 5000, investments: 30000, realEstate: 200000, crypto: 2000, liabilities: 100000, total: 137000 },
  { date: '2026-05-01', cash: 6000, investments: 34000, realEstate: 210000, crypto: 1500, liabilities: 95000, total: 156500 },
];

describe('NetWorthTracker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: { snapshots: [] } } });
  });

  it('shows the no-snapshots state', async () => {
    render(<NetWorthTracker />);
    expect(await screen.findByText(/No snapshots yet/)).toBeInTheDocument();
  });

  it('renders the latest snapshot with a positive change', async () => {
    lensRun.mockResolvedValue({ data: { result: { snapshots: SNAPSHOTS } } });
    render(<NetWorthTracker />);
    expect(await screen.findByText('$156,500')).toBeInTheDocument();
    expect(screen.getByText(/\+\$19,500/)).toBeInTheDocument();
  });

  it('renders a negative change branch', async () => {
    lensRun.mockResolvedValue({
      data: { result: { snapshots: [SNAPSHOTS[0], { ...SNAPSHOTS[1], total: 120000 }] } },
    });
    render(<NetWorthTracker />);
    expect(await screen.findByText('$120,000')).toBeInTheDocument();
    expect(screen.getByText(/-17,000/)).toBeInTheDocument();
  });

  it('changes the range and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { result: { snapshots: SNAPSHOTS } } });
    render(<NetWorthTracker />);
    await screen.findByText('$156,500');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('6M'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'net-worth-history', input: { range: '6M' } })),
    );
  });

  it('honours the initial range prop', async () => {
    lensRun.mockResolvedValue({ data: { result: { snapshots: SNAPSHOTS } } });
    render(<NetWorthTracker range="5Y" />);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ input: { range: '5Y' } })),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<NetWorthTracker />);
    expect(await screen.findByText(/No snapshots yet/)).toBeInTheDocument();
  });
});
