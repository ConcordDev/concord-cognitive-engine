/// <reference types="@testing-library/jest-dom/vitest" />
/**
 * Wave 4 (docs/lens-specs/accounting-capability-map.md "validate-ledger has
 * no button" closure) — pins that AccountingActionPanel's Validate button
 * calls the real `accounting.validate-ledger` macro against the pasted
 * books JSON and renders its real result: an honest balanced/"no issues"
 * state when the macro reports none, or the real per-account issue list
 * when it does — never a fabricated result and never a raw JSON dump.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const runDomain = vi.fn();
const lensRunMock = vi.fn();
const apiPost = vi.fn();
const apiDelete = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { post: (...args: unknown[]) => apiPost(...args), delete: (...args: unknown[]) => apiDelete(...args) },
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomain(...args) } },
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag: string) => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, ...rest } = props as Record<string, unknown>;
      void _i; void _a; void _e; void _t; void _l;
      return React.createElement(tag, rest, props.children);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { AccountingActionPanel } from '@/components/accounting/AccountingActionPanel';

const BOOKS_JSON = JSON.stringify({
  accounts: [
    { accountNumber: '1000', name: 'Cash', type: 'asset', entries: [{ date: '2026-01-01', debit: 45000, credit: 0 }] },
    { accountNumber: '4000', name: 'Sales', type: 'revenue', entries: [{ date: '2026-01-01', debit: 0, credit: 45000 }] },
  ],
});

function pasteBooksJson() {
  const tbTextarea = screen.getByPlaceholderText(/"accountNumber":"1000","name":"Cash"/);
  fireEvent.change(tbTextarea, { target: { value: BOOKS_JSON } });
}

describe('AccountingActionPanel — Validate ledger', () => {
  beforeEach(() => {
    runDomain.mockReset();
    lensRunMock.mockReset();
    apiPost.mockReset();
    apiDelete.mockReset();
  });

  it('renders a Validate action wired to the validate-ledger macro', () => {
    render(<AccountingActionPanel />);
    expect(screen.getByText('Validate')).toBeInTheDocument();
    expect(screen.getByText('validate-ledger')).toBeInTheDocument();
  });

  it('refuses to validate with no books pasted (honest, no fabricated call)', async () => {
    render(<AccountingActionPanel />);
    fireEvent.click(screen.getByText('Validate'));
    await waitFor(() => expect(screen.getByText(/Paste books JSON in the TB field first/)).toBeInTheDocument());
    expect(runDomain).not.toHaveBeenCalled();
  });

  it('calls validate-ledger with the pasted books and renders the real balanced result', async () => {
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: {
          validatedAt: '2026-07-12T00:00:00.000Z',
          totalDebits: 45000,
          totalCredits: 45000,
          difference: 0,
          isBalanced: true,
          accountCount: 2,
          accountIssues: [],
          severity: 'ok',
          message: 'Ledger balances. 2 accounts validated.',
        },
      },
    });
    render(<AccountingActionPanel />);
    pasteBooksJson();
    fireEvent.click(screen.getByText('Validate'));

    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    const call = runDomain.mock.calls[0];
    expect(call[0]).toBe('accounting');
    expect(call[1]).toBe('validate-ledger');
    const sentInput = (call[2] as { input?: { artifact?: { data?: unknown } } })?.input;
    expect((sentInput?.artifact?.data as { accounts?: unknown[] })?.accounts?.length).toBe(2);

    // Honest "no issues" state — no fabricated warnings when the macro
    // reports none.
    await waitFor(() => expect(screen.getByText('Ledger validation')).toBeInTheDocument());
    expect(screen.getByText(/balanced/)).toBeInTheDocument();
    expect(screen.getByText('2 accounts checked')).toBeInTheDocument();
    expect(screen.getByText('Ledger balances. 2 accounts validated.')).toBeInTheDocument();
    expect(screen.queryByText(/credit balance on debit-normal account/)).not.toBeInTheDocument();
  });

  it('renders the macro-reported account issues, not a raw JSON dump', async () => {
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: {
          validatedAt: '2026-07-12T00:00:00.000Z',
          totalDebits: 45000,
          totalCredits: 45000,
          difference: 0,
          isBalanced: true,
          accountCount: 2,
          accountIssues: [{ account: 'Sales', issue: 'debit balance on credit-normal account', balance: -120.5 }],
          severity: 'warning',
          message: 'Ledger balances overall, but 1 account(s) have suspicious balance side.',
        },
      },
    });
    render(<AccountingActionPanel />);
    pasteBooksJson();
    fireEvent.click(screen.getByText('Validate'));

    const issueLine = await screen.findByText(/debit balance on credit-normal account/);
    // Structured field render, not a <pre>/JSON.stringify dump of the result.
    expect(screen.queryByText(/"accountIssues"/)).not.toBeInTheDocument();
    expect(issueLine.closest('div')?.textContent).toContain('Sales');
  });

  it('surfaces an out-of-balance error result honestly', async () => {
    runDomain.mockResolvedValue({
      data: {
        ok: true,
        result: {
          validatedAt: '2026-07-12T00:00:00.000Z',
          totalDebits: 45000,
          totalCredits: 44000,
          difference: 1000,
          isBalanced: false,
          accountCount: 2,
          accountIssues: [],
          severity: 'error',
          message: 'Ledger is OUT OF BALANCE by 1000.00. Total debits (45000) ≠ total credits (44000).',
        },
      },
    });
    render(<AccountingActionPanel />);
    pasteBooksJson();
    fireEvent.click(screen.getByText('Validate'));

    await waitFor(() => expect(screen.getByText(/OUT OF BALANCE/)).toBeInTheDocument());
    expect(screen.getByText(/off by \$1000/)).toBeInTheDocument();
  });
});
