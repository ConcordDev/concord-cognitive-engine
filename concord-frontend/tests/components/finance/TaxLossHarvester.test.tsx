import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { TaxLossHarvester } from '@/components/finance/TaxLossHarvester';

const RESULT = {
  candidates: [
    { id: 'c1', symbol: 'ARKK', shares: 20, costBasis: 80, price: 45, unrealisedLoss: 700, longTerm: true, heldDays: 400, washSaleClear: true },
    { id: 'c2', symbol: 'COIN', shares: 10, costBasis: 200, price: 150, unrealisedLoss: 500, longTerm: false, heldDays: 60, washSaleClear: false },
  ],
  totalHarvestableLoss: 1200,
  estimatedTaxBenefit: 288,
};

describe('TaxLossHarvester', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: { candidates: [], totalHarvestableLoss: 0, estimatedTaxBenefit: 0 } } });
  });

  it('shows empty state with no candidates', async () => {
    render(<TaxLossHarvester />);
    expect(await screen.findByText(/No harvestable losses/)).toBeInTheDocument();
  });

  it('renders candidates with LTCG/STCG and wash-sale badges', async () => {
    lensRun.mockResolvedValue({ data: { result: RESULT } });
    render(<TaxLossHarvester />);
    expect(await screen.findByText('ARKK')).toBeInTheDocument();
    expect(screen.getByText('COIN')).toBeInTheDocument();
    expect(screen.getByText('LTCG')).toBeInTheDocument();
    expect(screen.getByText('STCG')).toBeInTheDocument();
    expect(screen.getByText('WASH')).toBeInTheDocument();
    expect(screen.getByText('-$1200')).toBeInTheDocument();
  });

  it('changes the min-loss input and recalculates on refresh', async () => {
    lensRun.mockResolvedValue({ data: { result: RESULT } });
    render(<TaxLossHarvester />);
    await screen.findByText('ARKK');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '250' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByTitle('Recalculate'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'tax-loss-candidates', input: { minLoss: 250 } })),
    );
  });

  it('falls back to minLoss 100 for non-numeric input', async () => {
    lensRun.mockResolvedValue({ data: { result: RESULT } });
    render(<TaxLossHarvester />);
    await screen.findByText('ARKK');
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByTitle('Recalculate'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ input: { minLoss: 100 } })),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<TaxLossHarvester />);
    expect(await screen.findByText(/No harvestable losses/)).toBeInTheDocument();
  });
});
