import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { BankAggregation } from '@/components/finance/BankAggregation';

const SYNCED = [
  { id: 's1', institution: 'Chase', name: 'Checking', kind: 'checking', mask: '1111', balance: 4200, synced: true, provider: 'plaid', lastSyncedAt: '2026-05-01T10:00:00Z' },
  { id: 's2', institution: 'Ally', name: 'Savings', kind: 'savings', mask: '2222', balance: 9000, synced: true },
];

describe('BankAggregation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lensRun.mockResolvedValue({ data: { ok: true, result: { accounts: [] } } });
  });

  it('shows empty state when no synced accounts', async () => {
    render(<BankAggregation />);
    expect(await screen.findByText(/No synced institutions/)).toBeInTheDocument();
  });

  it('filters to synced accounts and renders them', async () => {
    lensRun.mockResolvedValue({
      data: { ok: true, result: { accounts: [...SYNCED, { id: 's3', institution: 'X', name: 'Y', kind: 'loan', mask: '3', balance: 1, synced: false }] } },
    });
    render(<BankAggregation />);
    expect(await screen.findByText(/Chase · Checking/)).toBeInTheDocument();
    expect(screen.getByText(/Ally · Savings/)).toBeInTheDocument();
    expect(screen.getByText('2 synced')).toBeInTheDocument();
  });

  it('toggles the link form and ignores empty submit', async () => {
    render(<BankAggregation />);
    await screen.findByText(/No synced institutions/);
    fireEvent.click(screen.getByLabelText('Link bank'));
    expect(await screen.findByPlaceholderText('Institution')).toBeInTheDocument();
    lensRun.mockClear();
    fireEvent.click(screen.getByText('Connect institution'));
    expect(lensRun).not.toHaveBeenCalledWith('finance', 'accounts-sync-link', expect.anything());
  });

  it('links a synced institution', async () => {
    render(<BankAggregation />);
    await screen.findByText(/No synced institutions/);
    fireEvent.click(screen.getByLabelText('Link bank'));
    fireEvent.change(await screen.findByPlaceholderText('Institution'), { target: { value: 'Citi' } });
    fireEvent.change(screen.getByPlaceholderText('Account name'), { target: { value: 'Main' } });
    fireEvent.change(screen.getByPlaceholderText('Current balance'), { target: { value: '500' } });
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'savings' } });
    fireEvent.change(selects[1], { target: { value: 'mx' } });
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true, result: { accounts: [] } } });
    fireEvent.click(screen.getByText('Connect institution'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('finance', 'accounts-sync-link', expect.objectContaining({ institution: 'Citi', name: 'Main', kind: 'savings', provider: 'mx', balance: 500 })),
    );
  });

  it('opens a sync panel, parses CSV and pulls transactions', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'accounts-list') return Promise.resolve({ data: { ok: true, result: { accounts: SYNCED } } });
      if (action === 'accounts-sync-pull') return Promise.resolve({ data: { ok: true, result: { added: 2, deduped: 1 } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<BankAggregation />);
    await screen.findByText(/Chase · Checking/);
    fireEvent.click(screen.getAllByText('Sync')[0]);
    const ta = await screen.findByRole('textbox');
    fireEvent.change(ta, { target: { value: '2026-05-01,Coffee Shop,-5.00\n2026-05-02,Paycheck,2000' } });
    fireEvent.click(screen.getByText(/Sync 2 row/));
    await waitFor(() => expect(screen.getByText(/2 transaction\(s\) imported, 1 duplicate/)).toBeInTheDocument());
  });

  it('disables the pull button when CSV is empty / invalid', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { accounts: SYNCED } } });
    render(<BankAggregation />);
    await screen.findByText(/Chase · Checking/);
    fireEvent.click(screen.getAllByText('Sync')[0]);
    const ta = await screen.findByRole('textbox');
    fireEvent.change(ta, { target: { value: 'bad,line' } });
    const pull = screen.getByText(/Sync 0 row/).closest('button')!;
    expect(pull).toBeDisabled();
    // toggle sync panel closed
    fireEvent.click(screen.getAllByText('Sync')[0]);
  });

  it('tolerates a fetch rejection', async () => {
    lensRun.mockRejectedValue(new Error('down'));
    render(<BankAggregation />);
    expect(await screen.findByText(/No synced institutions/)).toBeInTheDocument();
  });
});
