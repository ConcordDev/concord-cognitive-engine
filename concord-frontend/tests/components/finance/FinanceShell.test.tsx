import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { FinanceShell, type FinanceShellProps } from '@/components/finance/FinanceShell';

const HOLDINGS: FinanceShellProps['holdings'] = [
  { id: 'h1', symbol: 'AAPL', name: 'Apple', kind: 'stock', shares: 10, price: 200, value: 2000, changePct: 1.5, sparkline: [1, 2, 3, 2, 4] },
  { id: 'h2', symbol: 'BTC', name: 'Bitcoin', kind: 'crypto', shares: 0.5, price: 60000, value: 30000, changePct: -2.3 },
  { id: 'h3', symbol: 'VOO', name: 'Vanguard 500', kind: 'etf', price: 450, value: 4500, changePct: 0.8 },
  { id: 'h4', symbol: 'CC', name: 'Concord Coin', kind: 'cc', price: 1, value: 500, changePct: 0 },
  { id: 'h5', symbol: 'DTU', name: 'A DTU', kind: 'dtu', price: 5, value: 50, changePct: 5 },
  { id: 'h6', symbol: 'USD', name: 'Cash', kind: 'cash', price: 1, value: 1000, changePct: 0 },
];

const WATCH: FinanceShellProps['watchlist'] = [
  { id: 'w1', symbol: 'TSLA', name: 'Tesla', price: 250, changePct: 3.1 },
  { id: 'w2', symbol: 'NVDA', name: 'Nvidia', price: 900, changePct: -1.2 },
];

const ACTIVITY: FinanceShellProps['activity'] = [
  { id: 'a1', kind: 'buy', label: 'Bought shares', amount: 500, timestamp: '2026-05-01T10:00:00Z', asset: 'AAPL' },
  { id: 'a2', kind: 'sell', label: 'Sold shares', amount: 800, timestamp: '2026-05-02T10:00:00Z' },
  { id: 'a3', kind: 'deposit', label: 'Deposit', amount: 1000, timestamp: '2026-05-03T10:00:00Z' },
  { id: 'a4', kind: 'withdraw', label: 'Withdraw', amount: 200, timestamp: '2026-05-04T10:00:00Z' },
  { id: 'a5', kind: 'dividend', label: 'Dividend', amount: 12, timestamp: '2026-05-05T10:00:00Z' },
  { id: 'a6', kind: 'royalty', label: 'Royalty', amount: 8, timestamp: '2026-05-06T10:00:00Z' },
  { id: 'a7', kind: 'budget', label: 'Budget hit', amount: 50, timestamp: '2026-05-07T10:00:00Z' },
];

function baseProps(over: Partial<FinanceShellProps> = {}): FinanceShellProps {
  return {
    netWorth: 2_500_000,
    netWorthDelta: 15000,
    netWorthDeltaPct: 0.6,
    range: '1M',
    sparkline: [1, 2, 3, 4, 5, 4, 6],
    buyingPower: 12000,
    budgetUsedPct: 55,
    holdings: HOLDINGS,
    watchlist: WATCH,
    activity: ACTIVITY,
    ...over,
  };
}

describe('FinanceShell', () => {
  it('renders the hero, holdings, watchlist and activity', () => {
    render(<FinanceShell {...baseProps()} />);
    expect(screen.getByText('Apple')).toBeInTheDocument();
    expect(screen.getByText('Bitcoin')).toBeInTheDocument();
    expect(screen.getByText('TSLA')).toBeInTheDocument();
    expect(screen.getByText('6 positions')).toBeInTheDocument();
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
  });

  it('hides and shows the balance via the eye toggle', () => {
    render(<FinanceShell {...baseProps()} />);
    const toggle = screen.getByTitle('Hide balance');
    fireEvent.click(toggle);
    expect(screen.getByText('••••••')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Show balance'));
    expect(screen.queryByText('••••••')).not.toBeInTheDocument();
  });

  it('fires action and range callbacks', () => {
    const onTrade = vi.fn(), onTransfer = vi.fn(), onBudget = vi.fn();
    const onRangeChange = vi.fn(), onSelectHolding = vi.fn(), onAddWatch = vi.fn();
    render(<FinanceShell {...baseProps({ onTrade, onTransfer, onBudget, onRangeChange, onSelectHolding, onAddWatch })} />);
    fireEvent.click(screen.getByText('Trade'));
    fireEvent.click(screen.getByText('Transfer'));
    fireEvent.click(screen.getByText('Budget'));
    fireEvent.click(screen.getByText('YTD'));
    fireEvent.click(screen.getByText('Apple'));
    fireEvent.click(screen.getByLabelText('Add to watchlist'));
    expect(onTrade).toHaveBeenCalled();
    expect(onTransfer).toHaveBeenCalled();
    expect(onBudget).toHaveBeenCalled();
    expect(onRangeChange).toHaveBeenCalledWith('YTD');
    expect(onSelectHolding).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1' }));
    expect(onAddWatch).toHaveBeenCalled();
  });

  it('renders the negative-delta variant', () => {
    render(<FinanceShell {...baseProps({ netWorthDelta: -5000, netWorthDeltaPct: -0.2, netWorth: 999, buyingPower: 5 })} />);
    expect(screen.getByText(/-0.20%/)).toBeInTheDocument();
  });

  it('renders empty states for holdings, watchlist and activity', () => {
    render(<FinanceShell {...baseProps({ holdings: [], watchlist: [], activity: [], sparkline: [] })} />);
    expect(screen.getByText(/No positions yet/)).toBeInTheDocument();
    expect(screen.getByText(/Star tickers to track here/)).toBeInTheDocument();
    expect(screen.getByText('No activity yet.')).toBeInTheDocument();
  });

  it('renders the dash when budgetUsedPct is undefined', () => {
    render(<FinanceShell {...baseProps({ budgetUsedPct: undefined })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders a high budget meter colour for over-90% usage', () => {
    render(<FinanceShell {...baseProps({ budgetUsedPct: 95 })} />);
    expect(screen.getByText('95%')).toBeInTheDocument();
  });

  it('formats large numbers in millions and uses a custom fiat symbol', () => {
    render(<FinanceShell {...baseProps({ fiatSymbol: '€', netWorth: 3_000_000 })} />);
    expect(screen.getByText('€3.00M')).toBeInTheDocument();
  });
});
