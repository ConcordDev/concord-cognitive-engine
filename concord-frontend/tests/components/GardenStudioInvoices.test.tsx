/**
 * GardenStudio — proposal -> invoice status machine (Feature 10).
 *
 * `proposal-build` (server/domains/landscaping.js) only ever produced a
 * renderable document — there was no way to turn a built proposal into a
 * tracked, payable invoice (the "Invoices" GENUINELY-MISSING gap in
 * docs/lens-specs/landscaping-capability-map.md). This pins the new
 * "Convert to invoice" action on the Proposal tab and the new Invoices
 * tab (InvoiceTracker) that walks the draft -> sent -> accepted -> paid
 * status machine against invoice-from-proposal / invoice-list /
 * invoice-send / invoice-accept / invoice-record-payment.
 *
 * Hermetic: lensRun + next/image + @/components/viz are mocked. No
 * network, no server boot.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz', () => ({
  TimelineView: () => null,
  ChartKit: () => null,
}));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => React.createElement('img', props),
}));

import { GardenStudio } from '@/components/landscaping/GardenStudio';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function fail(error: string) {
  return Promise.resolve({ data: { ok: false, error, result: null } });
}

const EMPTY_INVOICE_LIST = {
  invoices: [], count: 0,
  draftCount: 0, sentCount: 0, acceptedCount: 0, paidCount: 0,
  outstanding: 0, collected: 0,
};

const DRAFT_INVOICE = {
  id: 'inv_a', number: 'INV-0001', proposalRef: null,
  client: 'Jane Doe', project: 'Front yard refresh',
  lineItems: [
    { description: 'Labor', category: 'labor', unit: 'hr', quantity: 10, unitCost: 50, lineTotal: 500 },
  ],
  subtotal: 500, overhead: 50, margin: 110, tax: 0, total: 660,
  status: 'draft', amountPaid: 0, payments: [], dueDate: '',
  createdAt: '2026-07-01T00:00:00.000Z', sentAt: null, acceptedAt: null, paidAt: null,
};

const ACCEPTED_INVOICE = {
  ...DRAFT_INVOICE, id: 'inv_b', number: 'INV-0002', status: 'accepted',
  sentAt: '2026-07-02T00:00:00.000Z', acceptedAt: '2026-07-03T00:00:00.000Z',
};

// Fallback for any macro call this test suite doesn't care about (e.g. the
// on-mount layout-list / bed-list calls from other GardenStudio tabs).
function mockRoute(behaviors: Record<string, () => Promise<unknown>>) {
  lensRun.mockImplementation((_domain: string, action: string) => {
    const fn = behaviors[action];
    if (fn) return fn();
    return ok({});
  });
}

async function goToTab(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('GardenStudio — Invoices tab (InvoiceTracker)', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders the empty state when there are no invoices', async () => {
    mockRoute({ 'invoice-list': () => ok(EMPTY_INVOICE_LIST) });
    render(<GardenStudio />);
    await goToTab(/^Invoices$/);
    expect(await screen.findByText(/No invoices yet/i)).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('landscaping', 'invoice-list', {});
  });

  it('renders invoice cards with status badges and AR summary stats', async () => {
    mockRoute({
      'invoice-list': () => ok({
        invoices: [DRAFT_INVOICE, ACCEPTED_INVOICE], count: 2,
        draftCount: 1, sentCount: 0, acceptedCount: 1, paidCount: 0,
        outstanding: 660, collected: 0,
      }),
    });
    render(<GardenStudio />);
    await goToTab(/^Invoices$/);

    expect(await screen.findByText('INV-0001')).toBeInTheDocument();
    expect(screen.getByText('INV-0002')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.getAllByText('$660').length).toBeGreaterThan(0);
  });

  it('filters by status via invoice-list', async () => {
    mockRoute({ 'invoice-list': () => ok(EMPTY_INVOICE_LIST) });
    render(<GardenStudio />);
    await goToTab(/^Invoices$/);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('landscaping', 'invoice-list', {}));

    fireEvent.click(screen.getByRole('button', { name: 'accepted' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'landscaping', 'invoice-list', { status: 'accepted' },
    ));
  });

  it('sends a draft invoice via invoice-send and reloads the list', async () => {
    mockRoute({
      'invoice-list': () => ok({
        invoices: [DRAFT_INVOICE], count: 1,
        draftCount: 1, sentCount: 0, acceptedCount: 0, paidCount: 0,
        outstanding: 0, collected: 0,
      }),
      'invoice-send': () => ok({ invoice: { ...DRAFT_INVOICE, status: 'sent' } }),
    });
    render(<GardenStudio />);
    await goToTab(/^Invoices$/);
    fireEvent.click(await screen.findByText('INV-0001')); // expand the card

    fireEvent.click(screen.getByRole('button', { name: /Send to client/i }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'landscaping', 'invoice-send', { id: 'inv_a' },
    ));
    // reloads after a successful transition
    await waitFor(() => {
      const calls = lensRun.mock.calls.filter((c) => c[1] === 'invoice-list');
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('records a payment on an accepted invoice', async () => {
    mockRoute({
      'invoice-list': () => ok({
        invoices: [ACCEPTED_INVOICE], count: 1,
        draftCount: 0, sentCount: 0, acceptedCount: 1, paidCount: 0,
        outstanding: 660, collected: 0,
      }),
      'invoice-record-payment': () => ok({
        invoice: { ...ACCEPTED_INVOICE, status: 'paid', amountPaid: 660, paidAt: '2026-07-05T00:00:00.000Z' },
        balanceDue: 0,
      }),
    });
    render(<GardenStudio />);
    await goToTab(/^Invoices$/);
    fireEvent.click(await screen.findByText('INV-0002')); // expand

    const amountInput = screen.getByPlaceholderText(/Up to \$660/);
    fireEvent.change(amountInput, { target: { value: '660' } });
    fireEvent.click(screen.getByRole('button', { name: /Record payment/i }));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'landscaping', 'invoice-record-payment',
      expect.objectContaining({ id: 'inv_b', amount: 660 }),
    ));
    // let the post-payment reload settle before the test (and its render
    // tree) is torn down, so no state update lands on an unmounted node.
    await waitFor(() => {
      const calls = lensRun.mock.calls.filter((c) => c[1] === 'invoice-list');
      expect(calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('rejects recording a payment with no amount entered (no macro call fired)', async () => {
    mockRoute({
      'invoice-list': () => ok({
        invoices: [ACCEPTED_INVOICE], count: 1,
        draftCount: 0, sentCount: 0, acceptedCount: 1, paidCount: 0,
        outstanding: 660, collected: 0,
      }),
    });
    render(<GardenStudio />);
    await goToTab(/^Invoices$/);
    fireEvent.click(await screen.findByText('INV-0002'));

    fireEvent.click(screen.getByRole('button', { name: /Record payment/i }));
    expect(await screen.findByText(/enter a payment amount/i)).toBeInTheDocument();
    expect(lensRun.mock.calls.some((c) => c[1] === 'invoice-record-payment')).toBe(false);
  });
});

describe('GardenStudio — Proposal tab: convert to invoice', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('builds a proposal, converts it to an invoice, and surfaces the confirmation', async () => {
    mockRoute({
      'proposal-build': () => ok({
        client: 'Jane Doe', project: 'Front yard refresh',
        lineItems: [{ description: 'Labor', category: 'labor', unit: 'hr', quantity: 1, unitCost: 500, lineTotal: 500 }],
        subtotal: 500, overhead: 50, margin: 110, tax: 0, total: 660,
        proposalMarkdown: '# Landscaping Proposal',
      }),
      'invoice-from-proposal': () => ok({ invoice: { ...DRAFT_INVOICE, number: 'INV-0007' } }),
      'invoice-list': () => ok(EMPTY_INVOICE_LIST),
    });
    render(<GardenStudio />);
    await goToTab(/^Proposal$/);

    fireEvent.change(screen.getByPlaceholderText('Client name'), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: 'Labor' } });
    fireEvent.change(screen.getByPlaceholderText('Unit $'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /Build proposal/i }));

    const convertBtn = await screen.findByRole('button', { name: /Convert to invoice/i });
    fireEvent.click(convertBtn);

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'landscaping', 'invoice-from-proposal',
      expect.objectContaining({ client: 'Jane Doe' }),
    ));
    expect(await screen.findByText(/Converted to invoice INV-0007/i)).toBeInTheDocument();

    // Clicking through switches the studio to the Invoices tab, which
    // mounts InvoiceTracker and fires its own invoice-list load. Wait for
    // the resulting render (not just the mock call) so the load's state
    // update settles before the test tears the tree down.
    fireEvent.click(screen.getByRole('button', { name: /View in Invoices/i }));
    expect(await screen.findByText(/No invoices yet/i)).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('landscaping', 'invoice-list', {});
  });

  it('surfaces a convert-to-invoice failure without crashing', async () => {
    mockRoute({
      'proposal-build': () => ok({
        client: 'Jane Doe', project: 'Front yard refresh',
        lineItems: [{ description: 'Labor', category: 'labor', unit: 'hr', quantity: 1, unitCost: 500, lineTotal: 500 }],
        subtotal: 500, overhead: 50, margin: 110, tax: 0, total: 660,
        proposalMarkdown: '# Landscaping Proposal',
      }),
      'invoice-from-proposal': () => fail('handler_error'),
    });
    render(<GardenStudio />);
    await goToTab(/^Proposal$/);

    fireEvent.change(screen.getByPlaceholderText('Description'), { target: { value: 'Labor' } });
    fireEvent.change(screen.getByPlaceholderText('Unit $'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: /Build proposal/i }));

    const convertBtn = await screen.findByRole('button', { name: /Convert to invoice/i });
    fireEvent.click(convertBtn);

    expect(await screen.findByText('handler_error')).toBeInTheDocument();
  });
});
