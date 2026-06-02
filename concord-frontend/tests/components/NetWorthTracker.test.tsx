// Behavior test for NetWorthTracker (#4 — high-churn, previously-untested,
// real logic: loading/empty states + the change/% computation + range refetch).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));
// lightweight-charts touches canvas/layout jsdom can't provide — stub it.
vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({ setData: vi.fn() }),
    timeScale: () => ({ fitContent: vi.fn() }),
    remove: vi.fn(),
  }),
  AreaSeries: {},
  LineSeries: {},
}));

import { NetWorthTracker } from '@/components/finance/NetWorthTracker';

const snap = (over: Partial<Record<string, unknown>>) => ({
  date: '2026-01-01', cash: 0, investments: 0, realEstate: 0, crypto: 0, liabilities: 0, total: 0, ...over,
});

describe('NetWorthTracker', () => {
  beforeEach(() => lensRun.mockReset());

  it('shows the empty state when there are no snapshots', async () => {
    lensRun.mockResolvedValue({ data: { result: { snapshots: [] } } });
    render(<NetWorthTracker />);
    expect(await screen.findByText(/No snapshots yet/i)).toBeInTheDocument();
  });

  it('renders the latest total and the +50% change from the series', async () => {
    lensRun.mockResolvedValue({ data: { result: { snapshots: [
      snap({ date: '2026-01-01', total: 1000 }),
      snap({ date: '2026-06-01', total: 1500, cash: 200 }),
    ] } } });
    render(<NetWorthTracker />);
    // latest.total = 1500; change = +500; pct = +50.0%. (toLocaleString's
    // thousands separator is ICU/locale-dependent in node — tolerate it.)
    expect(await screen.findByText(/\$1,?500/)).toBeInTheDocument();
    const changeRow = (await screen.findByText(/\+50\.0%/)).closest('div');
    expect(changeRow?.textContent).toMatch(/\+\$500/);
  });

  it('refetches history when the range changes', async () => {
    lensRun.mockResolvedValue({ data: { result: { snapshots: [] } } });
    render(<NetWorthTracker />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '6M' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledTimes(2));
    expect(lensRun).toHaveBeenLastCalledWith(expect.objectContaining({ input: { range: '6M' } }));
  });

  it('handles a malformed/empty response without crashing (empty state)', async () => {
    lensRun.mockResolvedValue({}); // no data.result.snapshots → falls back to []
    render(<NetWorthTracker />);
    expect(await screen.findByText(/No snapshots yet/i)).toBeInTheDocument();
  });
});
