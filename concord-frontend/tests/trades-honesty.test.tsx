// Trades honesty: customers, jobs, quotes, invoices, timesheets and the
// project desk are the user's own persisted records, so the header must not
// say "Simulated". Surfaces that implied something happened when nothing
// did are now labelled as what they are: payment requests (no checkout link),
// reminders that are logged and not sent, straight-line route miles, and
// receivables aged by real dates.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getLensManifest } from '@/lib/lenses/manifest';
import { tradesDtuCall } from '@/components/trades/tradesReport';

const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
let respond: (action: string, input: Record<string, unknown>) => unknown = () => ({ ok: true, result: {} });

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn((a: unknown, b?: string, c?: Record<string, unknown>) => {
    const spec = typeof a === 'string' ? { domain: a, action: b!, input: c || {} } : (a as { domain: string; action: string; input: Record<string, unknown> });
    calls.push({ action: `${spec.domain}.${spec.action}`, input: spec.input });
    return Promise.resolve({ data: respond(spec.action, spec.input) });
  }),
}));

import PaymentsPanel from '@/components/trades/PaymentsPanel';
import NotificationsPanel from '@/components/trades/NotificationsPanel';
import RouteOptimizerPanel from '@/components/trades/RouteOptimizerPanel';
import { TradesWorkbench } from '@/components/trades/TradesWorkbench';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const serverSrc = readFileSync(join(__dirname, '../../server/domains/trades.js'), 'utf8');

describe('Trades lens honesty', () => {
  beforeEach(() => { calls.length = 0; respond = () => ({ ok: true, result: {} }); });

  it('is on the Real tier and only advertises actions the server registers', () => {
    const m = getLensManifest('trades')!;
    expect(m.dataTier).toBe('REAL_FREE');
    for (const a of m.actions) expect(serverSrc).toContain(`registerLensAction("trades", "${a}"`);
    const copy = JSON.stringify([m.emptyState, m.firstRunGuide]);
    expect(copy).not.toMatch(/safetyChecklist|changeOrderGenerate|permit fee tables/);
    expect(copy).toMatch(/recorded, not sent/);
  });

  it('payments are requests with no fake checkout link to copy', async () => {
    respond = (action) => action === 'payments-list'
      ? { ok: true, result: { payments: [{ id: 'pay_1', invoiceRef: 'INV-1', amount: 120, status: 'pending', hostedUrl: null, createdAt: '2026-10-05T19:00:00Z' }] } }
      : { ok: true, result: {} };
    render(<PaymentsPanel />);
    await waitFor(() => expect(screen.getByText('INV-1')).toBeTruthy());
    expect(screen.queryByTitle('Copy link')).toBeNull();
    expect(screen.getByText(/Online checkout isn.t connected yet/)).toBeTruthy();
    expect(serverSrc).toMatch(/hostedUrl: null/);
  });

  it('a refused payment shows the error instead of vanishing', async () => {
    respond = (action) => action === 'payments-create-link' ? { ok: false, error: 'invoiceRef and amount required' } : { ok: true, result: { payments: [] } };
    render(<PaymentsPanel />);
    fireEvent.change(screen.getByPlaceholderText('Invoice ref'), { target: { value: 'X' } });
    fireEvent.change(screen.getByPlaceholderText('Amount $'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /Record/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Not recorded\. invoiceRef and amount required/));
  });

  it('reminders say they are logged, not sent', async () => {
    respond = (action) => action === 'notifications-list'
      ? { ok: true, result: { notifications: [{ id: 'n1', channel: 'sms', kind: 'reminder', recipient: '555-0100', message: 'See you at 9', status: 'not_sent', createdAt: '2026-10-05T19:00:00Z' }] } }
      : { ok: true, result: { jobs: [] } };
    render(<NotificationsPanel />);
    await waitFor(() => expect(screen.getByText('555-0100')).toBeTruthy());
    expect(screen.getByText('not sent')).toBeTruthy();
    expect(screen.getByText('1 logged')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Log SMS reminder/ })).toBeTruthy();
    expect(serverSrc).toMatch(/status: "not_sent"/);
  });

  it('the route planner starts empty and reports straight-line miles', () => {
    render(<RouteOptimizerPanel />);
    expect(screen.getByText('Stops (0)')).toBeTruthy();
    expect(screen.queryByText('SF')).toBeNull();
    const src = read('components/trades/RouteOptimizerPanel.tsx');
    expect(src).not.toMatch(/units/);
    expect(src).not.toMatch(/Optimal order/);
    expect(serverSrc).toMatch(/AVG_MPH = 30/);
  });

  it('desk receivables are aged by date and crew is foreman coverage, not invented capacity', () => {
    const src = read('components/trades/ProjectDeskPanel.tsx');
    expect(src).not.toMatch(/invoicedItems\.length \* 0\.5/);
    expect(src).not.toMatch(/activeJobs \* 3/);
    expect(src).toMatch(/Foreman Coverage/);
  });

  it('the workbench shows a refused job instead of dropping it', async () => {
    respond = (action) => {
      if (action === 'customer-list') return { ok: true, result: { customers: [{ id: 'cust_1', name: 'Proof Customer' }] } };
      if (action === 'job-list') return { ok: true, result: { jobs: [] } };
      if (action === 'job-create') return { ok: false, error: 'customer not found' };
      return { ok: true, result: {} };
    };
    render(<TradesWorkbench open inline onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /New job/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /New job/ }));
    await waitFor(() => expect(screen.getByRole('option', { name: /Proof Customer/ })).toBeTruthy());
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'cust_1' } });
    fireEvent.change(screen.getByPlaceholderText('Description of the job'), { target: { value: 'Fix a leak' } });
    const dispatch = screen.getAllByRole('button').filter((b) => /Dispatch/.test(b.textContent || '')).pop()!;
    fireEvent.click(dispatch);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('customer not found'));
  });

  it('the kept DTU title carries the job id so JOB-00001 for two users does not collide', () => {
    const call = tradesDtuCall({ job: { id: 'job_abc', number: 'JOB-00001', customerName: 'Proof Customer', priority: 'high', status: 'unassigned', estimatedHours: 4, description: 'x' } } as never)!;
    expect(String(call.input.title)).toMatch(/· job_abc$/);
  });
});
