import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (input: Record<string, unknown>) => input,
}));
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { BooksPostMenu } from '@/components/finance/BooksPostMenu';
import type { CoaAccount, LedgerRow } from '@/components/finance/financeLedgerEntry';

const accounts: CoaAccount[] = [
  { id: 'acct_1000', code: '1000', name: 'Cash', category: 'asset' },
  { id: 'acct_4000', code: '4000', name: 'Sales Revenue', category: 'revenue' },
  { id: 'acct_6000', code: '6000', name: 'Office Expense', category: 'expense' },
];

const row: LedgerRow = {
  id: 'tx_abc',
  date: '2026-10-04',
  description: 'Blue Bottle Coffee',
  amount: -4.2,
  category: 'Dining',
  categorySource: 'user_rule',
};

const postedEntry = {
  id: 'je_1',
  number: 'JE-00001',
  citedDtuId: 'dtu_9',
  source: 'finance-ledger-entry',
  sourceId: 'tx_abc',
  lines: [{ debit: 4.2, credit: 0 }, { debit: 0, credit: 4.2 }],
  totalDebit: 4.2,
  totalCredit: 4.2,
};

function specOf(call: unknown) {
  return call as { domain: string; action?: string; name?: string; input?: Record<string, unknown> };
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('finance row handoff to the books', () => {
  it('will not post a DTU that has not been saved yet', () => {
    render(<BooksPostMenu row={row} accounts={accounts} />);
    fireEvent.click(screen.getByRole('button', { name: /Post to Books/i }));
    expect(screen.getByRole('button', { name: 'Send this DTU to Books' })).toBeDisabled();
    expect(screen.getByText('Save the entry as a DTU first')).toBeTruthy();
    expect(screen.getByText('Debit')).toBeTruthy();
    expect((screen.getByLabelText('Counter account') as HTMLSelectElement).value).toBe('acct_6000');
  });

  it('saves only after read-back, then posts the balanced entry to the books', async () => {
    lensRunMock.mockImplementation(async (spec: { domain: string; action?: string; name?: string }) => {
      const action = spec.action || spec.name;
      if (spec.domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      if (spec.domain === 'dtu' && action === 'get') return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      if (spec.domain === 'accounting' && action === 'je-post') return { data: { ok: true, result: { entry: postedEntry } } };
      return { data: { ok: false, result: null, error: 'unexpected' } };
    });
    const onPosted = vi.fn();
    render(<BooksPostMenu row={row} accounts={accounts} onPosted={onPosted} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save entry as DTU' }));
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_9\./)).toBeTruthy());
    expect(screen.getByText(/No bank and no Concord Coin moved\./)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Post to Books/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Send this DTU to Books' }));
    await waitFor(() => expect(screen.getByText(
      'Posted JE-00001 to your Books. 4.20 balanced across 2 lines. Ledger dtu_9. No bank and no Concord Coin moved.',
    )).toBeTruthy());
    expect(onPosted).toHaveBeenCalled();
    expect(screen.getByText(/In your Books as JE-00001/)).toBeTruthy();

    const createCall = specOf(lensRunMock.mock.calls[0][0]);
    expect(createCall.domain).toBe('dtu');
    expect(createCall.input?.source).toBe('finance-lens:ledger-entry');
    expect((lensRunMock.mock.calls[1][0] as { domain: string; input: { id: string } }).input.id).toBe('dtu_9');

    const postCall = specOf(lensRunMock.mock.calls[2][0]);
    expect(postCall.domain).toBe('accounting');
    expect(postCall.action).toBe('je-post');
    expect(postCall.input?.citedDtuId).toBe('dtu_9');
    expect(postCall.input?.sourceId).toBe('tx_abc');
    const lines = postCall.input?.lines as Array<{ accountId: string; debit: number; credit: number }>;
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBeCloseTo(lines.reduce((s, l) => s + l.credit, 0), 10);
  });

  it('does not say saved when the DTU cannot be read back', async () => {
    lensRunMock.mockImplementation(async (spec: { domain: string; action?: string; name?: string }) => {
      const action = spec.action || spec.name;
      if (spec.domain === 'dtu' && action === 'create') return { data: { ok: true, result: { dtu: { id: 'dtu_gone' } } } };
      return { data: { ok: false, result: null, error: 'DTU not found' } };
    });
    render(<BooksPostMenu row={row} accounts={accounts} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save entry as DTU' }));
    await waitFor(() => expect(screen.getByText(/could not be read back/)).toBeTruthy());
    expect(screen.queryByText(/^Saved as private DTU/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Post to Books/i }));
    expect(screen.getByRole('button', { name: 'Send this DTU to Books' })).toBeDisabled();
  });

  it('repeats the refusal the books gave instead of claiming a post', async () => {
    lensRunMock.mockImplementation(async (spec: { domain: string }) => {
      if (spec.domain === 'dtu') return { data: { ok: true, result: { dtu: { id: 'dtu_9' } } } };
      return { data: { ok: false, result: null, error: 'unbalanced: debits 4.20 != credits 0.00' } };
    });
    const onPosted = vi.fn();
    render(<BooksPostMenu row={row} accounts={accounts} onPosted={onPosted} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save entry as DTU' }));
    await waitFor(() => expect(screen.getByText(/Saved as private DTU dtu_9\./)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Post to Books/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Send this DTU to Books' }));
    await waitFor(() => expect(screen.getByText(/Not posted\. unbalanced/)).toBeTruthy());
    expect(screen.queryByText(/^Posted/)).toBeNull();
    expect(onPosted).not.toHaveBeenCalled();
  });

  it('shows the entry the books already hold after a reload', () => {
    render(
      <BooksPostMenu
        row={row}
        accounts={accounts}
        posted={{ entryId: 'je_1', entryNumber: 'JE-00001', totalDebit: 4.2 }}
      />,
    );
    expect(screen.getByText(/In your Books as JE-00001 · \$4\.20 balanced\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open Accounting' }).getAttribute('href')).toBe('/lenses/accounting');
  });

  it('says the books have no cash account rather than posting anywhere', () => {
    render(<BooksPostMenu row={row} accounts={[]} />);
    fireEvent.click(screen.getByRole('button', { name: /Post to Books/i }));
    expect(screen.getByText(/your Books need two accounts/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send this DTU to Books' })).toBeDisabled();
  });

  it('renders nothing for a row that is not a usable ledger entry', () => {
    const { container } = render(<BooksPostMenu row={{ ...row, amount: 0 }} accounts={accounts} />);
    expect(container.innerHTML).toBe('');
  });
});