import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const runDomain = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a) } },
}));

vi.mock('framer-motion', () => ({
  // Preserve the tag name so motion.form stays a <form>, motion.div stays a <div>, etc.
  motion: new Proxy({}, {
    get: (_t, prop: string) => (props: Record<string, unknown>) =>
      React.createElement(prop, props, props.children as React.ReactNode),
  }),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/dtu/SaveAsDtuButton', () => ({
  SaveAsDtuButton: () => React.createElement('button', { 'data-testid': 'save-dtu' }, 'Save DTU'),
}));

import { StripeInvoicePanel } from '@/components/accounting/StripeInvoicePanel';

const DRAFT = { id: 'i1', number: 'INV-1', customerName: 'Acme', total: 100, status: 'draft', issuedAt: '2026-05-01', dueAt: '2026-06-01', paidAt: null };
const OPEN = { id: 'i2', number: 'INV-2', customerName: 'Globex', total: 200, status: 'open', issuedAt: '2026-05-02', dueAt: '2099-01-01', paidAt: null };
const OPEN_STRIPE = { id: 'i3', number: 'INV-3', customerName: 'Initech', total: 300, status: 'open', issuedAt: '2026-05-03', dueAt: '2099-01-01', paidAt: null, stripeHostedInvoiceUrl: 'http://stripe/3', stripeInvoicePdfUrl: 'http://stripe/3.pdf' };
const PAID = { id: 'i4', number: 'INV-4', customerName: 'Hooli', total: 400, status: 'paid', issuedAt: '2026-05-04', dueAt: '2026-06-04', paidAt: '2026-05-10' };

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StripeInvoicePanel />
    </QueryClientProvider>,
  );
}

function listResult(invoices: unknown[]) {
  return { data: { ok: true, result: { invoices } } };
}

describe('StripeInvoicePanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders tabs and the unpaid empty state with no invoices', async () => {
    runDomain.mockResolvedValue(listResult([]));
    renderPanel();
    expect(await screen.findByText(/No unpaid invoices yet/)).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('All')).toBeInTheDocument();
  });

  it('renders open invoices on the default unpaid tab', async () => {
    runDomain.mockResolvedValue(listResult([DRAFT, OPEN, PAID]));
    renderPanel();
    expect(await screen.findByText('Globex')).toBeInTheDocument();
    // unpaid tab shows only open
    expect(screen.queryByText('Acme')).toBeNull();
  });

  it('switches to the draft tab and the all tab', async () => {
    runDomain.mockResolvedValue(listResult([DRAFT, OPEN, PAID]));
    renderPanel();
    await screen.findByText('Globex');
    fireEvent.click(screen.getByText('Draft'));
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    fireEvent.click(screen.getByText('All'));
    expect(await screen.findByText('Hooli')).toBeInTheDocument();
  });

  it('opens the composer and rejects an invalid total', async () => {
    runDomain.mockResolvedValue(listResult([]));
    renderPanel();
    await screen.findByText(/No unpaid invoices yet/);
    fireEvent.click(screen.getByText('New invoice'));
    fireEvent.change(screen.getByPlaceholderText('Customer name'), { target: { value: 'X' } });
    // total left blank/0 -> submit should not call create
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(runDomain).not.toHaveBeenCalledWith('accounting', 'invoice-create', expect.anything()),
    );
  });

  it('creates an invoice through the composer', async () => {
    runDomain.mockImplementation((_d: string, action: string) => {
      if (action === 'invoice-list') return Promise.resolve(listResult([]));
      if (action === 'invoice-create') return Promise.resolve({ data: { ok: true, result: { ok: true, result: { invoice: { ...DRAFT, id: 'new' } } } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    renderPanel();
    await screen.findByText(/No unpaid invoices yet/);
    fireEvent.click(screen.getByText('New invoice'));
    fireEvent.change(screen.getByPlaceholderText('Customer name'), { target: { value: 'New Co' } });
    fireEvent.change(screen.getByPlaceholderText('Total $'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(runDomain).toHaveBeenCalledWith('accounting', 'invoice-create', expect.objectContaining({
        input: expect.objectContaining({ customerName: 'New Co', total: 150 }),
      })),
    );
  });

  it('shows an error banner when create fails and dismisses it', async () => {
    runDomain.mockImplementation((_d: string, action: string) => {
      if (action === 'invoice-list') return Promise.resolve(listResult([]));
      if (action === 'invoice-create') return Promise.resolve({ data: { ok: true, result: { ok: false, error: 'duplicate' } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    renderPanel();
    await screen.findByText(/No unpaid invoices yet/);
    fireEvent.click(screen.getByText('New invoice'));
    fireEvent.change(screen.getByPlaceholderText('Customer name'), { target: { value: 'New Co' } });
    fireEvent.change(screen.getByPlaceholderText('Total $'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('duplicate')).toBeInTheDocument();
    fireEvent.click(screen.getByText('×'));
    await waitFor(() => expect(screen.queryByText('duplicate')).toBeNull());
  });

  it('sends an open invoice via Stripe', async () => {
    runDomain.mockImplementation((_d: string, action: string) => {
      if (action === 'invoice-list') return Promise.resolve(listResult([OPEN]));
      if (action === 'invoice-create-payment-link') return Promise.resolve({ data: { ok: true, result: { ok: true, result: { invoice: OPEN_STRIPE } } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    renderPanel();
    await screen.findByText('Globex');
    fireEvent.change(screen.getByPlaceholderText('customer email'), { target: { value: 'pay@x.com' } });
    fireEvent.click(screen.getByText('Send via Stripe'));
    await waitFor(() =>
      expect(runDomain).toHaveBeenCalledWith('accounting', 'invoice-create-payment-link', expect.objectContaining({
        input: expect.objectContaining({ id: 'i2', customerEmail: 'pay@x.com' }),
      })),
    );
  });

  it('renders Stripe links and a save-as-DTU button for a stripe-backed invoice', async () => {
    runDomain.mockResolvedValue(listResult([OPEN_STRIPE]));
    renderPanel();
    expect(await screen.findByText('Hosted Pay Page')).toBeInTheDocument();
    expect(screen.getByText('PDF')).toBeInTheDocument();
    expect(screen.getByTestId('save-dtu')).toBeInTheDocument();
  });

  it('marks an invoice paid', async () => {
    runDomain.mockImplementation((_d: string, action: string) => {
      if (action === 'invoice-list') return Promise.resolve(listResult([OPEN]));
      if (action === 'invoice-mark-paid') return Promise.resolve({ data: { ok: true, result: { ok: true, result: { invoice: { ...OPEN, status: 'paid' } } } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    renderPanel();
    await screen.findByText('Globex');
    fireEvent.click(screen.getByText('Mark paid'));
    await waitFor(() =>
      expect(runDomain).toHaveBeenCalledWith('accounting', 'invoice-mark-paid', expect.objectContaining({
        input: expect.objectContaining({ id: 'i2' }),
      })),
    );
  });

  it('renders the past-due badge for an overdue open invoice', async () => {
    const overdue = { ...OPEN, dueAt: '2000-01-01' };
    runDomain.mockResolvedValue(listResult([overdue]));
    renderPanel();
    expect(await screen.findByText(/past due/)).toBeInTheDocument();
  });

  it('shows the settled state for a paid invoice on the all tab', async () => {
    runDomain.mockResolvedValue(listResult([PAID]));
    renderPanel();
    await waitFor(() => expect(runDomain).toHaveBeenCalled());
    fireEvent.click(screen.getByText('All'));
    expect(await screen.findByText('Settled')).toBeInTheDocument();
  });
});
