import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { HoldingsManager } from '@/components/finance/HoldingsManager';

const HOLDINGS = [
  { id: 'h1', symbol: 'VTI', name: 'Total Market', shares: 10, costBasis: 180, price: 220, value: 2200, assetClass: 'equity_us', sector: 'Diversified', feeCategory: 'index', expenseRatio: 0.0003, dividendYield: 0.015, addedAt: '2026-01-01' },
  { id: 'h2', symbol: 'ARKK', name: 'Ark Innovation', shares: 20, costBasis: 60, price: 45, value: 900, assetClass: 'equity_us', sector: 'Tech', feeCategory: 'active', expenseRatio: 0.0075, dividendYield: 0, addedAt: '2026-02-01' },
];

describe('HoldingsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: { holdings: [] } } });
  });

  it('shows empty state with no holdings', async () => {
    render(<HoldingsManager />);
    expect(await screen.findByText(/No holdings/)).toBeInTheDocument();
  });

  it('renders holdings table with gain + loss rows', async () => {
    lensRun.mockResolvedValue({ data: { result: { holdings: HOLDINGS } } });
    render(<HoldingsManager />);
    expect(await screen.findByText('VTI')).toBeInTheDocument();
    expect(screen.getByText('ARKK')).toBeInTheDocument();
    expect(screen.getByText(/\+\$400/)).toBeInTheDocument();
    expect(screen.getByText(/\$-300/)).toBeInTheDocument();
  });

  it('adds a holding and ignores blank submit', async () => {
    render(<HoldingsManager />);
    await screen.findByText(/No holdings/);
    fireEvent.click(document.querySelector('header button') as HTMLElement);
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'holdings-add' }));
    fireEvent.change(await screen.findByPlaceholderText('Sym'), { target: { value: 'msft' } });
    fireEvent.change(screen.getByPlaceholderText('Shares'), { target: { value: '5' } });
    fireEvent.change(screen.getByPlaceholderText('Price'), { target: { value: '400' } });
    lensRun.mockResolvedValue({ data: { result: { holdings: [] } } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'holdings-add', input: expect.objectContaining({ symbol: 'MSFT', shares: 5, price: 400 }) })),
    );
  });

  it('edits a price inline and saves', async () => {
    lensRun.mockResolvedValue({ data: { result: { holdings: HOLDINGS } } });
    render(<HoldingsManager />);
    await screen.findByText('VTI');
    fireEvent.click(screen.getByText('$220.00'));
    const input = await screen.findByDisplayValue('220');
    fireEvent.change(input, { target: { value: '230' } });
    lensRun.mockClear();
    fireEvent.click(input.parentElement!.querySelectorAll('button')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'holdings-update-price', input: { id: 'h1', price: 230 } })),
    );
  });

  it('rejects a negative price and cancels editing', async () => {
    lensRun.mockResolvedValue({ data: { result: { holdings: HOLDINGS } } });
    render(<HoldingsManager />);
    await screen.findByText('VTI');
    fireEvent.click(screen.getByText('$220.00'));
    const input = await screen.findByDisplayValue('220');
    fireEvent.change(input, { target: { value: '-5' } });
    lensRun.mockClear();
    fireEvent.click(input.parentElement!.querySelectorAll('button')[0]);
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'holdings-update-price' }));
    fireEvent.click(input.parentElement!.querySelectorAll('button')[1]);
    expect(screen.queryByDisplayValue('-5')).not.toBeInTheDocument();
  });

  it('removes a holding', async () => {
    lensRun.mockResolvedValue({ data: { result: { holdings: HOLDINGS } } });
    render(<HoldingsManager />);
    await screen.findByText('VTI');
    lensRun.mockClear();
    const row = screen.getByText('VTI').closest('tr') as HTMLElement;
    const buttons = row.querySelectorAll('button');
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'holdings-remove', input: { id: 'h1' } })),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<HoldingsManager />);
    expect(await screen.findByText(/No holdings/)).toBeInTheDocument();
  });
});
