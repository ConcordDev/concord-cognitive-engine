import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { TaxEstimator } from '@/components/finance/TaxEstimator';

function mkResult(over: 'refund' | 'owed' | 'even') {
  return {
    taxableIncome: 70000,
    totalTax: 11000,
    effectiveRate: 0.157,
    marginalRate: 0.22,
    brackets: [
      { rate: 0.1, from: 0, to: 11000, amount: 11000, taxOnSlice: 1100 },
      { rate: 0.22, from: 11000, to: null, amount: 59000, taxOnSlice: 9900 },
    ],
    refund: over === 'refund' ? 1000 : null,
    owed: over === 'owed' ? 500 : null,
    withholdingRecommendation: 'Increase withholding by $40/paycheck.',
  };
}

describe('TaxEstimator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: mkResult('refund') } });
  });

  it('computes on mount and renders a refund result', async () => {
    render(<TaxEstimator />);
    expect(await screen.findByText(/refund/)).toBeInTheDocument();
    expect(screen.getByText('Bracket walk-through')).toBeInTheDocument();
    expect(screen.getByText(/Increase withholding/)).toBeInTheDocument();
  });

  it('renders an owed result', async () => {
    lensRun.mockResolvedValue({ data: { result: mkResult('owed') } });
    render(<TaxEstimator />);
    expect(await screen.findByText(/owed/)).toBeInTheDocument();
  });

  it('renders the even result', async () => {
    lensRun.mockResolvedValue({ data: { result: mkResult('even') } });
    render(<TaxEstimator />);
    expect(await screen.findByText('Even')).toBeInTheDocument();
  });

  it('re-computes when wages change', async () => {
    render(<TaxEstimator />);
    await screen.findByText(/refund/);
    lensRun.mockClear();
    const numbers = screen.getAllByRole('spinbutton');
    fireEvent.change(numbers[0], { target: { value: '95000' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'tax-estimate', input: expect.objectContaining({ wages: 95000 }) })),
    );
  });

  it('re-computes when filing status changes', async () => {
    render(<TaxEstimator />);
    await screen.findByText(/refund/);
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'married_jointly' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ filing: 'married_jointly' }) })),
    );
  });

  it('renders the no-result fallback after a rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<TaxEstimator />);
    expect(await screen.findByText(/Edit inputs to see your tax estimate/)).toBeInTheDocument();
  });
});
