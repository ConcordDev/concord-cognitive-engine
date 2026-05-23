import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AccountingDashboard } from '@/components/accounting/AccountingDashboard';

const PROFIT = {
  cashOnHand: 50000, openInvTotal: 12000, openInvCount: 3,
  openBillsTotal: 8000, openBillsCount: 5,
  ytdRevenue: 200000, ytdExpense: 150000, ytdNetIncome: 50000,
  uncategorizedTxns: 7, customerCount: 9, vendorCount: 4,
};
const LOSS = { ...PROFIT, ytdNetIncome: -25000, uncategorizedTxns: 0 };

describe('AccountingDashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading spinner initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<AccountingDashboard />);
    expect(screen.getByText(/Loading dashboard/)).toBeInTheDocument();
  });

  it('shows the empty state when no data comes back', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<AccountingDashboard />);
    expect(await screen.findByText(/No dashboard data yet/)).toBeInTheDocument();
  });

  it('renders profit-state tiles, the uncategorized banner and counts', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: PROFIT } });
    render(<AccountingDashboard />);
    expect(await screen.findByText('Cash on hand')).toBeInTheDocument();
    expect(screen.getByText('3 unpaid')).toBeInTheDocument();
    expect(screen.getByText('5 unpaid')).toBeInTheDocument();
    expect(screen.getByText('+$50,000')).toBeInTheDocument(); // positive net income
    expect(screen.getByText('7 bank txns waiting')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument(); // customers
    expect(screen.getByText('4')).toBeInTheDocument(); // vendors
    // no net-loss warning in profit state
    expect(screen.queryByText(/running a net loss/)).toBeNull();
  });

  it('renders the net-loss warning and hides the uncategorized banner', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: LOSS } });
    render(<AccountingDashboard />);
    expect(await screen.findByText(/running a net loss/)).toBeInTheDocument();
    expect(screen.getByText(/-25,000/)).toBeInTheDocument();
    expect(screen.queryByText(/bank txns waiting/)).toBeNull();
  });

  it('fires onJumpTo for tiles, banner, customer/vendor cards and runway link', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: PROFIT } });
    const onJumpTo = vi.fn();
    render(<AccountingDashboard onJumpTo={onJumpTo} />);
    await screen.findByText('Cash on hand');
    fireEvent.click(screen.getByText('Cash on hand'));
    expect(onJumpTo).toHaveBeenCalledWith('coa');
    fireEvent.click(screen.getByText('Open invoices'));
    expect(onJumpTo).toHaveBeenCalledWith('invoices');
    fireEvent.click(screen.getByText('Open bills'));
    expect(onJumpTo).toHaveBeenCalledWith('bills');
    fireEvent.click(screen.getByText('YTD net income'));
    expect(onJumpTo).toHaveBeenCalledWith('pl');
    fireEvent.click(screen.getByText('7 bank txns waiting'));
    expect(onJumpTo).toHaveBeenCalledWith('banking');
    fireEvent.click(screen.getByText('Customers'));
    expect(onJumpTo).toHaveBeenCalledWith('customers');
    fireEvent.click(screen.getByText('Vendors'));
    expect(onJumpTo).toHaveBeenCalledWith('vendors');
  });

  it('routes the net-loss runway link through onJumpTo', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: LOSS } });
    const onJumpTo = vi.fn();
    render(<AccountingDashboard onJumpTo={onJumpTo} />);
    fireEvent.click(await screen.findByText(/Check runway/));
    expect(onJumpTo).toHaveBeenCalledWith('runway');
  });

  it('does not crash with no onJumpTo prop when a tile is clicked', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: PROFIT } });
    render(<AccountingDashboard />);
    fireEvent.click(await screen.findByText('Cash on hand'));
  });

  it('handles a rejected request and shows the empty state', async () => {
    lensRun.mockRejectedValue(new Error('boom'));
    render(<AccountingDashboard />);
    expect(await screen.findByText(/No dashboard data yet/)).toBeInTheDocument();
  });
});
