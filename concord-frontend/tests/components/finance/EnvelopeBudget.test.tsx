import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { EnvelopeBudget } from '@/components/finance/EnvelopeBudget';

const ENVELOPES = [
  { id: 'e1', category: 'Groceries', monthlyTarget: 600, rolloverEnabled: true, currentBalance: 50, spentThisMonth: 400 },
  { id: 'e2', category: 'Dining', monthlyTarget: 200, rolloverEnabled: false, currentBalance: 0, spentThisMonth: 250 },
];

describe('EnvelopeBudget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { result: { envelopes: [], monthlyIncome: 0 } } });
  });

  it('shows empty state when no envelopes', async () => {
    render(<EnvelopeBudget />);
    expect(await screen.findByText(/No envelopes yet/)).toBeInTheDocument();
  });

  it('renders envelopes with overspent + rollover branches', async () => {
    lensRun.mockResolvedValue({ data: { result: { envelopes: ENVELOPES, monthlyIncome: 3000 } } });
    render(<EnvelopeBudget />);
    expect(await screen.findByText('Groceries')).toBeInTheDocument();
    expect(screen.getByText('Dining')).toBeInTheDocument();
    expect(screen.getByText('over')).toBeInTheDocument();
    expect(screen.getByText(/Rolls over/)).toBeInTheDocument();
  });

  it('reflects the monthlyIncome prop and zero-based detection', async () => {
    lensRun.mockResolvedValue({ data: { result: { envelopes: [{ id: 'e1', category: 'X', monthlyTarget: 1000, rolloverEnabled: false, currentBalance: 0, spentThisMonth: 0 }], monthlyIncome: 1000 } } });
    render(<EnvelopeBudget monthlyIncome={500} />);
    expect(await screen.findByText('Zero-based!')).toBeInTheDocument();
  });

  it('saves income on change', async () => {
    render(<EnvelopeBudget />);
    await screen.findByText(/No envelopes yet/);
    lensRun.mockClear();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '4000' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'monthly-income-set', input: { monthlyIncome: 4000 } })),
    );
  });

  it('creates an envelope', async () => {
    render(<EnvelopeBudget />);
    await screen.findByText(/No envelopes yet/);
    fireEvent.click(screen.getByTitle('New envelope'));
    fireEvent.change(await screen.findByPlaceholderText(/Category/), { target: { value: 'Travel' } });
    fireEvent.change(screen.getByPlaceholderText('Monthly $'), { target: { value: '300' } });
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { result: { envelopes: [], monthlyIncome: 0 } } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'envelopes-create', input: expect.objectContaining({ category: 'Travel', monthlyTarget: 300 }) })),
    );
  });

  it('ignores create with blank fields and deletes an envelope', async () => {
    lensRun.mockResolvedValue({ data: { result: { envelopes: ENVELOPES, monthlyIncome: 3000 } } });
    render(<EnvelopeBudget />);
    await screen.findByText('Groceries');
    fireEvent.click(screen.getByTitle('New envelope'));
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Add'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'envelopes-create' }));
    const li = screen.getByText('Groceries').closest('li') as HTMLElement;
    fireEvent.click(li.querySelector('button[title="Delete"]') as HTMLElement);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'envelopes-delete', input: { id: 'e1' } })),
    );
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<EnvelopeBudget />);
    expect(await screen.findByText(/No envelopes yet/)).toBeInTheDocument();
  });
});
