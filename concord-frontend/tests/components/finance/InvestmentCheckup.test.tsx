import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { InvestmentCheckup } from '@/components/finance/InvestmentCheckup';

const RESULT = {
  allocation: [
    { assetClass: 'equity_us', current: 70, target: 60, drift: 10, rebalanceAction: 'sell', rebalanceAmount: -5000 },
    { assetClass: 'bonds', current: 20, target: 30, drift: -10, rebalanceAction: 'buy', rebalanceAmount: 5000 },
    { assetClass: 'cash', current: 10, target: 10, drift: 0, rebalanceAction: 'hold', rebalanceAmount: 0 },
  ],
  drift: { worst: 10, categories: 3 },
  concentrationRisk: { topHoldingPct: 35, topThreePct: 70, sectorMax: 40 },
  fees: [
    { symbol: 'ARKK', expenseRatio: 0.0075, category: 'active', benchmark: 0.002, delta: 0.0055 },
    { symbol: 'VTI', expenseRatio: 0.0003, category: 'index', benchmark: 0.002, delta: -0.0017 },
  ],
  totalAnnualFeeUsd: 600,
  recommendations: ['Rebalance equities down to target', 'Consider lower-fee index funds'],
  score: 72,
};

describe('InvestmentCheckup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the no-data state when result is null', async () => {
    lensRun.mockResolvedValue({ data: { result: null } });
    render(<InvestmentCheckup />);
    expect(await screen.findByText(/No investment data/)).toBeInTheDocument();
  });

  it('renders the full checkup with allocation, fees and recommendations', async () => {
    lensRun.mockResolvedValue({ data: { result: RESULT } });
    render(<InvestmentCheckup />);
    expect(await screen.findByText('Investment checkup')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('sell')).toBeInTheDocument();
    expect(screen.getByText('buy')).toBeInTheDocument();
    expect(screen.getByText('hold')).toBeInTheDocument();
    expect(screen.getByText('Fee benchmarks')).toBeInTheDocument();
    expect(screen.getByText('Rebalance equities down to target')).toBeInTheDocument();
  });

  it('renders a high-score (green checkmark) variant with no fees / recs', async () => {
    lensRun.mockResolvedValue({
      data: { result: { ...RESULT, score: 90, fees: [], recommendations: [], drift: { worst: 2, categories: 1 }, concentrationRisk: { topHoldingPct: 10, topThreePct: 25, sectorMax: 15 }, totalAnnualFeeUsd: 100 } },
    });
    render(<InvestmentCheckup />);
    expect(await screen.findByText('90')).toBeInTheDocument();
    expect(screen.queryByText('Fee benchmarks')).not.toBeInTheDocument();
  });

  it('renders a low-score (red) variant', async () => {
    lensRun.mockResolvedValue({ data: { result: { ...RESULT, score: 30 } } });
    render(<InvestmentCheckup />);
    expect(await screen.findByText('30')).toBeInTheDocument();
  });

  it('shows the loading state then tolerates a rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<InvestmentCheckup />);
    await waitFor(() => expect(screen.getByText(/No investment data/)).toBeInTheDocument());
  });
});
