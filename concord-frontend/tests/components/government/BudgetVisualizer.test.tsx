import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { BudgetVisualizer } from '@/components/government/BudgetVisualizer';

const CATS = [
  { name: 'Defense', amountBillions: 800, pctOfTotal: 40, yoyChangePct: 3.2, color: '#f00' },
  { name: 'Health', amountBillions: 500, pctOfTotal: 25, yoyChangePct: -1.5, color: '#0f0' },
  { name: 'Education', amountBillions: 100, pctOfTotal: 5, yoyChangePct: 0, color: '#00f' },
];

describe('BudgetVisualizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { categories: [], totalBillions: 0 } } });
  });

  it('renders empty budget with zero total', async () => {
    render(<BudgetVisualizer />);
    expect(await screen.findByText('$0B')).toBeInTheDocument();
  });

  it('renders categories sorted by amount with yoy colours', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { categories: CATS, totalBillions: 1400 } } });
    render(<BudgetVisualizer />);
    expect(await screen.findByText('$1400B')).toBeInTheDocument();
    expect(screen.getByText('Defense')).toBeInTheDocument();
    expect(screen.getByText('Health')).toBeInTheDocument();
    // positive yoy gets a + prefix, negative does not
    expect(screen.getByText('+3.2%')).toBeInTheDocument();
    expect(screen.getByText('-1.5%')).toBeInTheDocument();
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    // first (largest) row caption
    expect(screen.getByText('Largest single budget line')).toBeInTheDocument();
  });

  it('switches scope and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { categories: CATS, totalBillions: 1400 } } });
    render(<BudgetVisualizer />);
    await screen.findByText('$1400B');
    lensRun.mockClear();
    fireEvent.click(screen.getByText('state'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'budget-breakdown', input: { scope: 'state', year: 2026 } }),
      ),
    );
  });

  it('changes year and re-fetches', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { categories: CATS, totalBillions: 1400 } } });
    render(<BudgetVisualizer />);
    await screen.findByText('$1400B');
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2024' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ input: { scope: 'federal', year: 2024 } }),
      ),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<BudgetVisualizer />);
    expect(await screen.findByText('$0B')).toBeInTheDocument();
  });
});
