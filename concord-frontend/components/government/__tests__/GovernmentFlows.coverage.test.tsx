// Behaviour flows for the government panels the generic render pass cannot drive on its own:
// FOIA draft save, document publish/sign/delete, fine creation, checkout (with and without Stripe)
// and refund. Every flow asserts the macro the user action sends.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const lensRunMock = vi.fn();
const calls = () => lensRunMock.mock.calls.map((c) => (c[0] as { action: string; input: Record<string, unknown> }));
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

const PERMIT = { id: 'pm1', recordNumber: 'PRM-1', feeUsd: 75, paid: false, kind: 'building' };
const FINE = { id: 'fn1', payerName: 'Ann Lee', reason: 'Parking', amountUsd: 40, paid: false, caseNumber: 'C-9', issuedAt: '2026-03-01' };
const PAID = { id: 'py1', kind: 'fine', refId: 'fn0', amountUsd: 20, description: 'Fine C-1', status: 'succeeded', createdAt: '2026-03-01', confirmedAt: '2026-03-01', cardLast4: '4242', receiptNumber: 'R-1' };
const PENDING = { ...PAID, id: 'py2', status: 'pending', confirmedAt: undefined, cardLast4: undefined, receiptNumber: undefined };
const REFUNDED = { ...PAID, id: 'py3', status: 'refunded', refundedAt: '2026-03-02', refundReason: 'duplicate' };
const DOC = { id: 'doc-1', title: 'Zoning ordinance', category: 'ordinance', bodyText: 'Section 1', fileUrl: 'https://example.org/z.pdf', requiresSignature: true, signatures: [{ id: 's1', signerName: 'Ann', signedAt: '2026-03-02' }] };
const REQ = { id: 'fo1', agency: 'GSA', subject: 'Contracts', body: 'All records', status: 'draft', createdAt: '2026-03-01' };

let stripe = true;
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiHelpers: { lens: {} },
}));
vi.mock('@/components/payment/StripePaymentForm', () => ({
  StripePaymentForm: (p: { onSuccess: (id: string) => void; onCancel: () => void }) => (
    <div>stripe form<button onClick={() => p.onSuccess('pi_test')}>stripe ok</button><button onClick={p.onCancel}>stripe cancel</button></div>
  ),
}));

import { FOIATracker } from '../FOIATracker';
import { DocumentLibraryPanel } from '../DocumentLibraryPanel';
import { PaymentsPanel } from '../PaymentsPanel';

afterEach(() => cleanup());
beforeEach(() => {
  stripe = true;
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (arg: { action: string }) => {
    const ok = (result: unknown) => ({ data: { ok: true, result } });
    switch (arg.action) {
      case 'foia-list': return ok({ requests: [REQ] });
      case 'documents-list': return ok({ documents: [DOC] });
      case 'permits-list': return ok({ permits: [PERMIT] });
      case 'fines-list': return ok({ fines: [FINE] });
      case 'payments-list': return ok({ payments: [PAID, PENDING, REFUNDED], stripeConfigured: true });
      case 'payments-checkout': return ok({ payment: { ...PENDING, id: 'py9' } });
      case 'payments-create-intent': return stripe ? ok({ clientSecret: 'cs_test' }) : { data: { ok: false, error: 'stripe_not_configured' } };
      default: return ok({ ok: true });
    }
  });
});

describe('FOIATracker flow', () => {
  it('lists the saved request, starts a draft from a template, and saves it through foia-create', async () => {
    render(<FOIATracker />);
    await settle();
    expect(screen.getByText(/Contracts/)).toBeTruthy();
    fireEvent.click(screen.getByTitle('New request'));
    await settle();
    fireEvent.change(screen.getByPlaceholderText(/Agency/), { target: { value: 'FBI' } });
    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'Case file' } });
    fireEvent.change(screen.getByPlaceholderText('Request body...'), { target: { value: 'Please send it' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save draft/ })); });
    await settle();
    const create = calls().find((c) => c.action === 'foia-create');
    expect(create?.input).toEqual({ agency: 'FBI', subject: 'Case file', body: 'Please send it' });
    expect(calls().filter((c) => c.action === 'foia-list').length).toBeGreaterThan(1);
  });

  it('a template button fills the draft', async () => {
    render(<FOIATracker />);
    await settle();
    fireEvent.click(screen.getByTitle('New request'));
    await settle();
    const tpl = screen.getByText('Government contracts (vendor X)');
    fireEvent.click(tpl);
    expect((screen.getByPlaceholderText(/Agency/) as HTMLInputElement).value).toBe('GSA');
  });

  it('survives a failing list and a failing save', async () => {
    lensRunMock.mockImplementation(async () => { throw new Error('down'); });
    render(<FOIATracker />);
    await settle();
    fireEvent.click(screen.getByTitle('New request'));
    fireEvent.change(screen.getByPlaceholderText(/Agency/), { target: { value: 'A' } });
    fireEvent.change(screen.getByPlaceholderText('Subject'), { target: { value: 'S' } });
    fireEvent.change(screen.getByPlaceholderText('Request body...'), { target: { value: 'B' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Save draft/ })); });
    await settle();
    expect(screen.getByTitle('New request')).toBeTruthy();
  });
});

describe('DocumentLibraryPanel flow', () => {
  it('publishes a document, expands one to sign it, and deletes one', async () => {
    render(<DocumentLibraryPanel />);
    await settle();
    expect(screen.getByText('Zoning ordinance')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Document title'), { target: { value: 'Noise rules' } });
    fireEvent.change(screen.getByPlaceholderText('Document body / form text'), { target: { value: 'No noise after 10pm' } });
    fireEvent.change(screen.getByPlaceholderText('Attachment URL (optional)'), { target: { value: 'https://example.org/n.pdf' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Publish document/ })); });
    await settle();
    expect(calls().find((c) => c.action === 'documents-publish')?.input).toMatchObject({ title: 'Noise rules' });

    await act(async () => { fireEvent.click(screen.getByText('Zoning ordinance')); });
    await settle();
    fireEvent.change(screen.getByPlaceholderText(/Full legal name/i), { target: { value: 'Bo Reed' } });
    fireEvent.change(screen.getByPlaceholderText(/Email/i), { target: { value: 'bo@example.org' } });
    fireEvent.change(screen.getByPlaceholderText(/Type your full name/i), { target: { value: 'Bo Reed' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Sign document/ })); });
    await settle();
    expect(calls().find((c) => c.action === 'documents-sign')?.input).toMatchObject({ id: 'doc-1' });

    await act(async () => { fireEvent.click(screen.getByLabelText('Delete')); });
    await settle();
    expect(calls().find((c) => c.action === 'documents-delete')?.input).toEqual({ id: 'doc-1' });
  });

  it('shows the sign error when signing is refused', async () => {
    lensRunMock.mockImplementation(async (arg: { action: string }) => arg.action === 'documents-sign'
      ? { data: { ok: false, error: 'already signed' } }
      : { data: { ok: true, result: { documents: [DOC] } } });
    render(<DocumentLibraryPanel />);
    await settle();
    await act(async () => { fireEvent.click(screen.getByText('Zoning ordinance')); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Sign document/ })); });
    await settle();
    expect(document.body.textContent).toMatch(/already signed|sign/i);
  });
});

describe('PaymentsPanel flow', () => {
  it('creates a fine, runs checkout with Stripe configured, closes it, and refunds a payment', async () => {
    render(<PaymentsPanel />);
    await settle();
    fireEvent.change(screen.getByPlaceholderText('Payer name'), { target: { value: 'Cy Doe' } });
    fireEvent.change(screen.getByPlaceholderText('Reason'), { target: { value: 'Late filing' } });
    fireEvent.change(screen.getByPlaceholderText('Case #'), { target: { value: 'C-77' } });
    fireEvent.change(screen.getByPlaceholderText('$ Amount'), { target: { value: '55' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Add fine|Create fine|Issue fine|fine/i })); });
    await settle();
    expect(calls().find((c) => c.action === 'fines-create')?.input).toMatchObject({ payerName: 'Cy Doe', amountUsd: 55 });

    const pay = screen.getAllByRole('button', { name: /pay/i });
    await act(async () => { fireEvent.click(pay[0]); });
    await settle();
    expect(calls().find((c) => c.action === 'payments-checkout')?.input).toMatchObject({ refId: expect.any(String) });
    expect(calls().some((c) => c.action === 'payments-create-intent')).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'stripe ok' })); });
    await settle();

    await act(async () => { fireEvent.click(screen.getAllByTitle('Refund')[0]); });
    await settle();
    expect(calls().some((c) => c.action === 'payments-refund')).toBe(true);
  });

  it('checkout without Stripe configured still opens an honest receipt view', async () => {
    stripe = false;
    render(<PaymentsPanel />);
    await settle();
    const pay = screen.getAllByRole('button', { name: /pay/i });
    await act(async () => { fireEvent.click(pay[0]); });
    await settle();
    expect(calls().some((c) => c.action === 'payments-create-intent')).toBe(true);
    expect(document.body.textContent).toMatch(/Online payment is not configured/);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close' })); });
    expect(document.body.textContent).not.toMatch(/Online payment is not configured/);
  });

  it('reports a checkout that fails to start', async () => {
    lensRunMock.mockImplementation(async (arg: { action: string }) => {
      if (arg.action === 'payments-checkout') return { data: { ok: false, error: 'cannot start' } };
      if (arg.action === 'permits-list') return { data: { ok: true, result: { permits: [PERMIT] } } };
      return { data: { ok: true, result: { fines: [FINE], payments: [], stripeConfigured: true } } };
    });
    render(<PaymentsPanel />);
    await settle();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: /pay/i })[0]); });
    await settle();
    expect(document.body.textContent).toMatch(/cannot start/);
  });
});
