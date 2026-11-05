/**
 * Consulting build (GB-1088 Wave 1) — pins for the R5 first-pass findings:
 *
 *   F3/F4  the desk header and the Time records / Proposal archive read the
 *          PRACTICE store (consulting-dashboard / invoice-list /
 *          engagement-list / proposal-list), not the freeform artifact
 *          store — a logged hour and a collected invoice show up here.
 *   F5     a proposal's collapsed row counts its creation-time sections and
 *          prints the signer + date inline (previously "0% complete" over
 *          checked sections, signer hidden until expanded).
 *   F6     a billed retainer period shows the invoice it created.
 *   F7     expenses carry a Billable-to-client total and flag.
 *   F8     the allocation week field starts as a real current-week value,
 *          and records pointing at a deleted engagement say so.
 *   Dialog genus: typing a Space inside a dialog field must not close the
 *          dialog (the keydown→click container handlers are gone).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
}));
vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: [], isLoading: false, isError: false, error: null,
    refetch: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(),
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...props }: Record<string, unknown>) => <div {...props}>{children as React.ReactNode}</div>,
  }),
}));

import { ConsultingDeskPanel } from '@/components/consulting/ConsultingDeskPanel';
import { ProposalBuilder } from '@/components/consulting/ProposalBuilder';
import { RetainerManager } from '@/components/consulting/RetainerManager';
import { ExpenseTracker } from '@/components/consulting/ExpenseTracker';
import { StaffingPlanner } from '@/components/consulting/StaffingPlanner';

const env = (result: unknown) => ({ data: { ok: true, result } });

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

const ENGAGEMENT = {
  id: 'e1', name: 'PR5CN Engagement', client: 'Acme', rate: 100, status: 'active',
  loggedHours: 2,
  timeEntries: [{ id: 't1', hours: 2, note: 'kickoff', date: '2026-11-01' }],
};
const PROPOSAL = {
  id: 'p1', title: 'Growth Plan', client: 'Acme', value: 5000, status: 'draft',
  sections: [], completeness: 0, sectionCount: 8, filledCount: 0, signature: null,
};
const SIGNED = {
  id: 'p2', title: 'Signed Plan', client: 'Acme', value: 9000, status: 'accepted',
  sections: [], completeness: 100, sectionCount: 8, filledCount: 8,
  signature: { signerName: 'Jamie Client', signedAt: '2026-11-02T00:00:00.000Z', ip: 'test' },
};

function practiceMock() {
  lensRunMock.mockImplementation((_lens: string, action: string) => {
    switch (action) {
      case 'consulting-dashboard':
        return Promise.resolve(env({ engagements: 1, active: 1, loggedHours: 2, billed: 200 }));
      case 'invoice-list':
        return Promise.resolve(env({ invoices: [], collected: 221.1, outstanding: 50, overdue: 0 }));
      case 'engagement-list':
        return Promise.resolve(env({ engagements: [ENGAGEMENT], count: 1 }));
      case 'proposal-list':
        return Promise.resolve(env({ proposals: [PROPOSAL], count: 1 }));
      case 'proposal-templates':
        return Promise.resolve(env({ sections: [{ key: 'executive-summary', prompt: 'Overview.' }] }));
      default:
        return Promise.resolve(env({}));
    }
  });
}

describe('ConsultingDeskPanel — F3/F4 practice-store records', () => {
  beforeEach(() => { lensRunMock.mockReset(); practiceMock(); });

  it('header shows collected revenue from the practice store, not $0', async () => {
    const { getByText } = render(wrap(<ConsultingDeskPanel mode="timesheets" />));
    await waitFor(() => expect(getByText('$221.1')).toBeInTheDocument());
    expect(getByText('$50')).toBeInTheDocument();
  });

  it('Time records list the practice time entries', async () => {
    const { getByText } = render(wrap(<ConsultingDeskPanel mode="timesheets" />));
    await waitFor(() => expect(getByText('PR5CN Engagement')).toBeInTheDocument());
    expect(getByText(/kickoff/)).toBeInTheDocument();
    expect(getByText('Unbilled')).toBeInTheDocument();
  });

  it('Proposal archive lists practice proposals with section counts', async () => {
    const { getByText } = render(wrap(<ConsultingDeskPanel mode="proposals" />));
    await waitFor(() => expect(getByText('Growth Plan')).toBeInTheDocument());
    expect(getByText(/8 sections · 0% complete/)).toBeInTheDocument();
  });
});

describe('ProposalBuilder — F5 state display + dialog typing', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((_lens: string, action: string) => {
      if (action === 'proposal-templates') return Promise.resolve(env({ sections: [{ key: 'executive-summary', prompt: 'Overview.' }] }));
      if (action === 'proposal-list') return Promise.resolve(env({ proposals: [SIGNED], count: 1 }));
      return Promise.resolve(env({}));
    });
  });

  it('collapsed row counts sections and prints the signer inline', async () => {
    const { getByText } = render(wrap(<ProposalBuilder />));
    await waitFor(() => expect(getByText('Signed Plan')).toBeInTheDocument());
    expect(getByText(/8 sections · 100% complete/)).toBeInTheDocument();
    expect(getByText(/Signed by Jamie Client/)).toBeInTheDocument();
  });

  it('typing a space in the create dialog does not close it', async () => {
    const { getByText, getByPlaceholderText } = render(wrap(<ProposalBuilder />));
    await waitFor(() => expect(getByText('Signed Plan')).toBeInTheDocument());
    fireEvent.click(getByText('New Proposal'));
    const title = getByPlaceholderText('Proposal title');
    fireEvent.keyDown(title, { key: ' ' });
    expect(getByPlaceholderText('Proposal title')).toBeInTheDocument();
  });
});

describe('RetainerManager — F6 billed period shows its invoice', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((_lens: string, action: string) => {
      if (action === 'retainer-list') {
        return Promise.resolve(env({
          mrr: 1000,
          retainers: [{
            id: 'r1', client: 'Acme', label: 'Acme Retainer', monthlyAmount: 1000,
            cadence: 'monthly', includedHours: 10, status: 'active', nextBillDate: '2026-12-01',
            periods: [{
              id: 'rp1', amount: 1000, hoursUsed: 5, includedHours: 10, overageHours: 0,
              billedAt: '2026-11-01', status: 'billed', invoiceId: 'inv_1', invoiceNumber: 'INV-0001',
            }],
          }],
        }));
      }
      return Promise.resolve(env({}));
    });
  });

  it('period row names the created invoice', async () => {
    const { getByText } = render(wrap(<RetainerManager />));
    await waitFor(() => expect(getByText('Acme Retainer')).toBeInTheDocument());
    fireEvent.click(getByText('Acme Retainer'));
    await waitFor(() => expect(getByText(/Invoice INV-0001/)).toBeInTheDocument());
  });
});

describe('ExpenseTracker — F7 billable control and totals', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation((_lens: string, action: string) => {
      if (action === 'expense-list') {
        return Promise.resolve(env({
          total: 250, reimbursable: 200, billable: 200, approved: 0,
          expenses: [
            { id: 'x1', engagementId: 'e1', engagementName: 'Engagement One', description: 'Flight', category: 'Travel', amount: 200, reimbursable: true, billable: true, status: 'pending', date: '2026-11-01' },
            { id: 'x2', engagementId: 'gone', engagementName: 'Old Engagement', description: 'Taxi', category: 'Travel', amount: 50, reimbursable: false, billable: false, status: 'pending', date: '2026-11-01' },
          ],
        }));
      }
      return Promise.resolve(env({}));
    });
  });

  it('shows the billable total, flags billable rows, marks deleted engagements', async () => {
    const { getByText, getAllByText } = render(wrap(<ExpenseTracker engagements={[{ id: 'e1', name: 'Engagement One' }]} />));
    await waitFor(() => expect(getByText('Flight')).toBeInTheDocument());
    expect(getAllByText(/billable to client/i).length).toBeGreaterThan(0);
    expect(getByText(/Old Engagement \(deleted\)/)).toBeInTheDocument();
  });
});

describe('StaffingPlanner — F8 week field holds a real value', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    lensRunMock.mockImplementation(() => Promise.resolve(env({ rows: [], allocations: [] })));
  });

  it('week input starts filled with the current ISO week', async () => {
    const { getByLabelText } = render(wrap(<StaffingPlanner engagements={[]} />));
    await waitFor(() => expect(getByLabelText('Week')).toBeInTheDocument());
    const week = getByLabelText('Week') as HTMLInputElement;
    expect(week.value).toMatch(/^\d{4}-W\d{2}$/);
  });
});
