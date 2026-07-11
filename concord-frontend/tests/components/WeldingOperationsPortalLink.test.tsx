/**
 * WeldingOperations — client-portal link banner.
 *
 * Wave 4 gap closure: `welding.estimate-send` / `invoice-from-job` mint a
 * real `portalToken` (server/domains/welding.js) that resolves through the
 * newly-public `/welding-portal/[token]` page (server.js
 * `GET /api/welding/portal/:token`). Before this fix, the only UI surface
 * for that token was a raw string in the Quotes tab ("Client-portal token
 * issued: <token>") with no URL at all in the Invoices tab — a welder had
 * no way to actually get a working link to send a customer. This pins that
 * both tabs now render the REAL `/welding-portal/:token` URL (not just the
 * bare token) after send/generate, sourced from the real lensRun response
 * shape for each macro (`estimate-send` returns `result.portalToken` at the
 * top level; `invoice-from-job` returns it nested at
 * `result.invoice.portalToken` — a shape mismatch that was hand-verified
 * against server/domains/welding.js, not assumed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { WeldingOperations } from '@/components/welding/WeldingOperations';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

const CALENDAR_RESULT = {
  days: [{ date: '2026-07-11', jobs: [{ id: 'job_1', title: 'Fence job', client: 'Acme', status: 'completed' }] }],
  unscheduled: [],
  crewLoad: {},
  scheduledCount: 1,
};

describe('WeldingOperations — client-portal link banner', () => {
  beforeEach(() => {
    lensRun.mockReset();
    lensRun.mockImplementation((_domain: string, action: string) => {
      switch (action) {
        case 'ops-summary':
          return ok({ activeJobs: 0, completedJobs: 0, pipelineValue: 0, outstanding: 0, collected: 0, overdueInvoices: 0, certAtRisk: 0 });
        case 'calendar':
          return ok(CALENDAR_RESULT);
        case 'estimate-list':
          return ok({
            estimates: [{ id: 'est_1', title: 'Fence repair', client: 'Acme', lineItems: [], subtotal: 100, taxRate: 0, tax: 0, total: 100, status: 'draft' }],
            pipelineValue: 100,
            wonValue: 0,
          });
        case 'estimate-send':
          // Real shape: server/domains/welding.js `estimate-send` returns
          // { estimate, portalToken } — portalToken at the TOP level.
          return ok({ estimate: { id: 'est_1', status: 'sent' }, portalToken: 'PORTAL_TOKEN_ABC123' });
        case 'invoice-list':
          return ok({ invoices: [], outstanding: 0, collected: 0, overdueCount: 0 });
        case 'invoice-from-job':
          // Real shape: server/domains/welding.js `invoice-from-job` returns
          // { invoice } — portalToken NESTED under invoice, no top-level field.
          return ok({
            invoice: {
              id: 'inv_1', invoiceNumber: 'INV-0001', jobId: 'job_1', amount: 100,
              amountPaid: 0, balance: 100, status: 'unpaid', issuedDate: '2026-07-11',
              dueDate: '2026-08-10', payments: [], portalToken: 'PORTAL_TOKEN_XYZ789',
            },
          });
        default:
          return ok(null);
      }
    });
  });

  it('quotes tab: sending an estimate shows a real, copyable /welding-portal/:token link (not a bare token)', async () => {
    render(React.createElement(WeldingOperations));
    fireEvent.click(screen.getByText('Quotes'));

    const sendBtn = await screen.findByText('Send to client');
    fireEvent.click(sendBtn);

    const link = await screen.findByText(/\/welding-portal\/PORTAL_TOKEN_ABC123$/);
    expect(link.textContent).toContain('/welding-portal/PORTAL_TOKEN_ABC123');
    // The raw un-linkified token string must NOT be the sole representation.
    expect(screen.queryByText('PORTAL_TOKEN_ABC123')).toBeNull();
    expect(screen.getByText('Copy link')).toBeTruthy();
  });

  it('invoices tab: generating an invoice shows a real, copyable /welding-portal/:token link sourced from result.invoice.portalToken', async () => {
    render(React.createElement(WeldingOperations));
    fireEvent.click(screen.getByText('Invoices'));

    const select = await screen.findByDisplayValue('Select a job to invoice…');
    fireEvent.change(select, { target: { value: 'job_1' } });
    fireEvent.click(screen.getByText('Generate invoice'));

    const link = await screen.findByText(/\/welding-portal\/PORTAL_TOKEN_XYZ789$/);
    expect(link.textContent).toContain('/welding-portal/PORTAL_TOKEN_XYZ789');
  });

  it('copy button copies the full URL, not the bare token, to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(React.createElement(WeldingOperations));
    fireEvent.click(screen.getByText('Quotes'));
    const sendBtn = await screen.findByText('Send to client');
    fireEvent.click(sendBtn);
    await screen.findByText(/\/welding-portal\/PORTAL_TOKEN_ABC123$/);

    fireEvent.click(screen.getByText('Copy link'));
    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy());
    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedArg = writeText.mock.calls[0][0] as string;
    expect(copiedArg.endsWith('/welding-portal/PORTAL_TOKEN_ABC123')).toBe(true);
  });
});
