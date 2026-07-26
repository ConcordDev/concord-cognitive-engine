import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...args: unknown[]) => lensRun(...args) }));

import { AccountingDashboard } from '@/components/accounting/AccountingDashboard';

const summary = {
  cashOnHand: 42000, openInvTotal: 5000, openInvCount: 3,
  openBillsTotal: 1200, openBillsCount: 2,
  ytdRevenue: 90000, ytdExpense: 60000, ytdNetIncome: 30000,
  uncategorizedTxns: 4, customerCount: 7, vendorCount: 5,
};

function mockLensRun(plByRange: Record<string, { revenue: number; expense: number; netIncome: number }>) {
  lensRun.mockImplementation(async ({ action, input }: { action: string; input?: { start?: string; end?: string } }) => {
    if (action === 'dashboard-summary') return { data: { result: summary } };
    if (action === 'pl-compute') {
      const key = `${input?.start}:${input?.end}`;
      const slice = plByRange[key] || { revenue: 0, expense: 0, netIncome: 0 };
      return { data: { result: { revenue: { total: slice.revenue }, operatingExpenses: { total: slice.expense }, netIncome: slice.netIncome } } };
    }
    return { data: { result: null } };
  });
}

describe('AccountingDashboard', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('replaces the generic tile grid with the real KPIStrip, wired to dashboard-summary', async () => {
    mockLensRun({});
    render(<AccountingDashboard />);
    expect(await screen.findByText('Cash on hand')).toBeInTheDocument();
    expect(screen.getByText('$42K')).toBeInTheDocument();
    expect(screen.getByText('Open invoices')).toBeInTheDocument();
    expect(screen.getByText('3 unpaid')).toBeInTheDocument();
  });

  it('shows a real period-over-period revenue delta computed from two pl-compute calls', async () => {
    mockLensRun({
      '2026-07-01:2026-07-23': { revenue: 15000, expense: 9000, netIncome: 6000 },
      '2026-06-01:2026-06-23': { revenue: 10000, expense: 9000, netIncome: 1000 },
    });
    vi.setSystemTime(new Date('2026-07-23T00:00:00Z'));
    render(<AccountingDashboard />);
    // Revenue grew 10000 -> 15000 = +50.0%
    await waitFor(() => expect(screen.getByText('+50.0%')).toBeInTheDocument());
    expect(screen.getAllByText('vs last month').length).toBeGreaterThan(0);
    vi.useRealTimers();
  });

  it('re-fetches a genuinely different date range when the period selector changes (real macro call, not a client-side re-slice)', async () => {
    mockLensRun({});
    render(<AccountingDashboard />);
    await screen.findByText('Cash on hand');
    const callsBefore = lensRun.mock.calls.filter((c) => c[0]?.action === 'pl-compute').length;

    fireEvent.click(screen.getByRole('radio', { name: 'YTD' }));

    await waitFor(() => {
      const callsAfter = lensRun.mock.calls.filter((c) => c[0]?.action === 'pl-compute').length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
    const ytdCall = lensRun.mock.calls.find(
      (c) => c[0]?.action === 'pl-compute' && c[0]?.input?.start?.endsWith('-01-01') && !c[0]?.input?.start?.includes('2025')
    );
    expect(ytdCall).toBeTruthy();
  });

  it('drills down to the P&L nav on a KPI click', async () => {
    mockLensRun({});
    const onJumpTo = vi.fn();
    render(<AccountingDashboard onJumpTo={onJumpTo} />);
    const revenueTile = await screen.findByText('Revenue');
    fireEvent.click(revenueTile.closest('button')!);
    expect(onJumpTo).toHaveBeenCalledWith('pl');
  });
});
