import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { BankFeedsInbox } from '@/components/accounting/BankFeedsInbox';

const ACCOUNTS = [
  { id: 'a1', code: '6000', name: 'Software', category: 'expense', archived: false },
  { id: 'a2', code: '4000', name: 'Sales', category: 'revenue', archived: false },
  { id: 'a3', code: '1000', name: 'Cash', category: 'asset', archived: false },
];
const TXNS = [
  { id: 't1', number: 'TX-1', date: '2026-05-01', description: 'AWS', amount: -120, accountId: null, jeEntryId: null },
  { id: 't2', number: 'TX-2', date: '2026-05-02', description: 'Stripe payout', amount: 500, accountId: null, jeEntryId: null },
];
const SUGGESTIONS = [
  { txnId: 't1', description: 'AWS', amount: -120, date: '2026-05-01', suggestedAccountId: 'a1', suggestedAccountName: 'Software', source: 'rule', confidence: 0.92, highConfidence: true },
  { txnId: 't2', description: 'Stripe payout', amount: 500, date: '2026-05-02', suggestedAccountId: 'a2', suggestedAccountName: 'Sales', source: 'brain', confidence: 0.5, highConfidence: false },
];

function wire(opts: { accounts?: unknown; txns?: unknown } = {}) {
  lensRun.mockImplementation((spec: { action: string }) => {
    if (spec.action === 'coa-list') return Promise.resolve({ data: { ok: true, result: { accounts: opts.accounts ?? ACCOUNTS } } });
    if (spec.action === 'bank-feeds-list') return Promise.resolve({ data: { ok: true, result: { txns: opts.txns ?? TXNS } } });
    if (spec.action === 'bank-feeds-bulk-suggest') return Promise.resolve({ data: { ok: true, result: { suggestions: SUGGESTIONS } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('BankFeedsInbox', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<BankFeedsInbox />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('shows the inbox-clear state when there are no transactions', async () => {
    wire({ txns: [] });
    render(<BankFeedsInbox />);
    expect(await screen.findByText(/Inbox clear/)).toBeInTheDocument();
  });

  it('renders transactions with deposit and withdrawal formatting', async () => {
    wire();
    render(<BankFeedsInbox />);
    expect(await screen.findByText('AWS')).toBeInTheDocument();
    expect(screen.getByText('Stripe payout')).toBeInTheDocument();
    expect(screen.getByText('2 uncategorized')).toBeInTheDocument();
    expect(screen.getByText('$120.00')).toBeInTheDocument();    // withdrawal
    expect(screen.getByText('+$500.00')).toBeInTheDocument();   // deposit
  });

  it('toggles the import form and rejects a blank import', async () => {
    wire();
    render(<BankFeedsInbox />);
    await screen.findByText('AWS');
    fireEvent.click(screen.getByText('Add txn'));
    expect(screen.getByPlaceholderText(/Description \(e.g. AWS/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'bank-feeds-import' })),
    );
  });

  it('imports a transaction with a description and amount', async () => {
    wire();
    render(<BankFeedsInbox />);
    await screen.findByText('AWS');
    fireEvent.click(screen.getByText('Add txn'));
    fireEvent.change(screen.getByPlaceholderText(/Description \(e.g. AWS/), { target: { value: 'GitHub' } });
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: '-21' } });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'bank-feeds-import', input: expect.objectContaining({ description: 'GitHub', amount: -21 }) }),
      ),
    );
  });

  it('runs bulk-suggest and surfaces the high-confidence banner + accept button', async () => {
    wire();
    render(<BankFeedsInbox />);
    await screen.findByText('AWS');
    fireEvent.click(screen.getByText('Suggest all'));
    expect(await screen.findByText(/Accept 1 high-confidence/)).toBeInTheDocument();
    expect(screen.getByText(/suggestions ready/)).toBeInTheDocument();
    // suggestion confidence badges
    expect(screen.getByText(/92% · rule/)).toBeInTheDocument();
    expect(screen.getByText(/50% · brain/)).toBeInTheDocument();
  });

  it('accepts a single suggestion and removes the txn', async () => {
    wire();
    render(<BankFeedsInbox />);
    await screen.findByText('AWS');
    fireEvent.click(screen.getByText('Suggest all'));
    await screen.findByText(/Accept 1 high-confidence/);
    fireEvent.click(screen.getAllByText('Accept')[0]);
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'bank-feeds-categorize', input: expect.objectContaining({ txnId: 't1' }) }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('AWS')).toBeNull());
  });

  it('accepts all high-confidence suggestions in bulk', async () => {
    wire();
    render(<BankFeedsInbox />);
    await screen.findByText('AWS');
    fireEvent.click(screen.getByText('Suggest all'));
    await screen.findByText(/Accept 1 high-confidence/);
    fireEvent.click(screen.getByText(/Accept 1 high-confidence/));
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(expect.objectContaining({ action: 'bank-feeds-bulk-accept' })),
    );
  });

  it('categorizes a txn via the manual account picker when no suggestion exists', async () => {
    wire();
    render(<BankFeedsInbox />);
    await screen.findByText('AWS');
    // before Suggest all there are no suggestions — pick from the manual select
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'a1' } });
    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'bank-feeds-categorize', input: expect.objectContaining({ accountId: 'a1' }) }),
      ),
    );
  });
});
