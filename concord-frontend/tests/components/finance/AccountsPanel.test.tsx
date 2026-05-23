import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { AccountsPanel } from '@/components/finance/AccountsPanel';

const ACCOUNTS = [
  { id: 'a1', institution: 'Chase', name: 'Everyday', kind: 'checking', mask: '1234', balance: 5000, currency: 'USD', status: 'active', linkedAt: '2026-01-01' },
  { id: 'a2', institution: 'Amex', name: 'Gold Card', kind: 'credit', mask: '9999', balance: -1200, currency: 'USD', status: 'active', linkedAt: '2026-01-02' },
];

describe('AccountsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { accounts: [], totalAssets: 0, totalLiabilities: 0, netWorth: 0 } } });
  });

  it('shows empty state when no accounts', async () => {
    render(<AccountsPanel />);
    expect(await screen.findByText(/No accounts linked/)).toBeInTheDocument();
  });

  it('renders accounts grouped by kind with totals', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { accounts: ACCOUNTS, totalAssets: 5000, totalLiabilities: 1200, netWorth: 3800 } } });
    render(<AccountsPanel />);
    expect(await screen.findByText('Chase')).toBeInTheDocument();
    expect(screen.getByText('Amex')).toBeInTheDocument();
    expect(screen.getByText('$3,800')).toBeInTheDocument();
  });

  it('opens the create form, links an account and refreshes', async () => {
    render(<AccountsPanel />);
    await screen.findByText(/No accounts linked/);
    fireEvent.click(document.querySelector('header button') as HTMLElement);
    fireEvent.change(screen.getByPlaceholderText('Institution'), { target: { value: 'Wells' } });
    fireEvent.change(screen.getByPlaceholderText('Account name'), { target: { value: 'Savings' } });
    fireEvent.change(screen.getByPlaceholderText('Balance (neg for debt)'), { target: { value: '900' } });
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true, result: { accounts: [], totalAssets: 0, totalLiabilities: 0, netWorth: 0 } } });
    fireEvent.click(screen.getByText('Link account'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({
        domain: 'finance', action: 'accounts-link',
        input: expect.objectContaining({ institution: 'Wells', name: 'Savings', balance: 900 }),
      })),
    );
  });

  it('does not link when required fields are blank', async () => {
    render(<AccountsPanel />);
    await screen.findByText(/No accounts linked/);
    fireEvent.click(document.querySelector('header button') as HTMLElement);
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Link account'));
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'accounts-link' }));
  });

  it('unlinks an account', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { accounts: ACCOUNTS, totalAssets: 5000, totalLiabilities: 1200, netWorth: 3800 } } });
    render(<AccountsPanel />);
    await screen.findByText('Chase');
    const li = screen.getByText('Chase').closest('li') as HTMLElement;
    const trash = li.querySelectorAll('button');
    fireEvent.click(trash[trash.length - 1]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'accounts-unlink', input: { id: 'a1' } })),
    );
  });

  it('edits and saves a balance', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { accounts: ACCOUNTS, totalAssets: 5000, totalLiabilities: 1200, netWorth: 3800 } } });
    render(<AccountsPanel />);
    await screen.findByText('Chase');
    const li = screen.getByText('Chase').closest('li') as HTMLElement;
    fireEvent.click(li.querySelector('button') as HTMLElement);
    const input = screen.getByDisplayValue('5000');
    fireEvent.change(input, { target: { value: '5500' } });
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true, result: { accounts: ACCOUNTS, totalAssets: 0, totalLiabilities: 0, netWorth: 0 } } });
    fireEvent.click(input.parentElement!.querySelectorAll('button')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'accounts-update-balance', input: { id: 'a1', balance: 5500 } })),
    );
  });

  it('cancels balance edit', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { accounts: ACCOUNTS, totalAssets: 0, totalLiabilities: 0, netWorth: 0 } } });
    render(<AccountsPanel />);
    await screen.findByText('Chase');
    const li = screen.getByText('Chase').closest('li') as HTMLElement;
    fireEvent.click(li.querySelector('button') as HTMLElement);
    const input = screen.getByDisplayValue('5000');
    lensRun.mockClear();
    // cancel button (second) closes the editor without persisting
    fireEvent.click(input.parentElement!.querySelectorAll('button')[1]);
    expect(screen.queryByDisplayValue('5000')).not.toBeInTheDocument();
    expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'accounts-update-balance' }));
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<AccountsPanel />);
    expect(await screen.findByText(/No accounts linked/)).toBeInTheDocument();
  });
});
