/**
 * welding-build-slices — behaviour tests for the welding full-lens build.
 *  S3/F5 — the Jobs panel opens a job detail editor riding job-update.
 *  S4/F6 — the estimate card prints its breakdown; a draft converts directly.
 *  S1/F3 — two-step delete removes the object.
 *  S6    — the PQR section records and lists a qualification record.
 *  S7/F8 — a mutation refetches the header stats without a tab switch.
 * The lensRun fake is a small in-memory welding store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

const h = vi.hoisted(() => {
  let seq = 0;
  const store = {
    jobs: [] as Record<string, unknown>[],
    estimates: [] as Record<string, unknown>[],
    invoices: [] as Record<string, unknown>[],
    wps: [] as Record<string, unknown>[],
    pqr: [] as Record<string, unknown>[],
    opsCalls: 0,
    lastUpdate: null as Record<string, unknown> | null,
  };
  const nid = (p: string) => `${p}_${++seq}`;
  function dispatch(action: string, input: Record<string, unknown>) {
    const ok = (result: unknown) => ({ ok: true, result });
    switch (action) {
      case 'ops-summary': {
        store.opsCalls += 1;
        return ok({
          activeJobs: store.jobs.filter((j) => j.status === 'scheduled' || j.status === 'in_progress').length,
          completedJobs: store.jobs.filter((j) => j.status === 'completed').length,
          pipelineValue: store.estimates.filter((e) => e.status === 'draft' || e.status === 'sent').reduce((t, e) => t + (e.total as number), 0),
          outstanding: 0, collected: 0, overdueInvoices: 0, certAtRisk: 0,
        });
      }
      case 'calendar': return ok({ days: [], unscheduled: store.jobs.filter((j) => !j.scheduledDate), crewLoad: {}, scheduledCount: store.jobs.length });
      case 'job-list': return ok({ jobs: store.jobs });
      case 'job-schedule': { const job = { id: nid('job'), status: 'scheduled', ...input }; store.jobs.push(job); return ok({ job }); }
      case 'job-update': { store.lastUpdate = input; const job = store.jobs.find((j) => j.id === input.jobId); if (job) Object.assign(job, input); return ok({ job }); }
      case 'job-delete': store.jobs = store.jobs.filter((j) => j.id !== input.jobId); return ok({ deleted: input.jobId });
      case 'estimate-create': {
        const items = (input.lineItems as { quantity: number; unitPrice: number }[]) || [];
        const subtotal = items.reduce((t, li) => t + li.quantity * li.unitPrice, 0);
        const taxRate = (input.taxRate as number) || 0;
        const est = { id: nid('est'), ...input, lineItems: items, subtotal, taxRate, tax: subtotal * taxRate, total: subtotal * (1 + taxRate), status: 'draft', jobId: null };
        store.estimates.push(est); return ok({ estimate: est });
      }
      case 'estimate-list': return ok({ estimates: store.estimates, pipelineValue: store.estimates.filter((e) => e.status === 'draft' || e.status === 'sent').reduce((t, e) => t + (e.total as number), 0), wonValue: 0 });
      case 'estimate-send': { const e = store.estimates.find((x) => x.id === input.estimateId); if (e) e.status = 'sent'; return ok({ estimate: e, portalToken: 'tok1' }); }
      case 'estimate-to-job': { const e = store.estimates.find((x) => x.id === input.estimateId); const job = { id: nid('job'), title: e?.title, status: 'scheduled' }; store.jobs.push(job); if (e) { e.jobId = job.id; e.status = 'accepted'; } return ok({ job, estimate: e }); }
      case 'estimate-delete': store.estimates = store.estimates.filter((e) => e.id !== input.estimateId); return ok({ deleted: input.estimateId });
      case 'invoice-list': return ok({ invoices: store.invoices, outstanding: 0, collected: 0, overdueCount: 0 });
      case 'wps-list': return ok({ wps: store.wps });
      case 'wps-create': { const w = { id: nid('wps'), revision: '0', status: 'draft', positions: input.positions || [], ...input, wpsNumber: (input.wpsNumber as string) || `WPS-00${store.wps.length + 1}` }; store.wps.push(w); return ok({ wps: w }); }
      case 'wps-approve': { const w = store.wps.find((x) => x.id === input.wpsId); if (w) { w.status = 'approved'; w.approvedBy = 'Sam Welder'; } return ok({ wps: w }); }
      case 'wps-delete': store.wps = store.wps.filter((w) => w.id !== input.wpsId); return ok({ deleted: input.wpsId });
      case 'cert-status': return ok({ certs: [], alerts: [], validCount: 0, atRiskCount: 0 });
      case 'pqr-create': { const p = { id: nid('pqr'), code: 'AWS D1.1', ...input, pqrNumber: (input.pqrNumber as string) || `PQR-00${store.pqr.length + 1}` }; store.pqr.push(p); return ok({ pqr: p }); }
      case 'pqr-list': return ok({ pqr: store.pqr });
      case 'pqr-delete': store.pqr = store.pqr.filter((p) => p.id !== input.pqrId); return ok({ deleted: input.pqrId });
      case 'photo-list': return ok({ photos: [], byStage: {} });
      case 'code-search': return ok({ results: [], codes: [] });
      default: return { ok: false, error: `unhandled ${action}` };
    }
  }
  return { store, dispatch, reset() { store.jobs = []; store.estimates = []; store.invoices = []; store.wps = []; store.pqr = []; store.opsCalls = 0; store.lastUpdate = null; } };
});

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, action: string, input: Record<string, unknown> = {}) => ({ data: h.dispatch(action, input) })),
  apiHelpers: { lens: { runDomain: vi.fn(async () => ({ data: { ok: false } })) } },
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => null }));

import { WeldingOperations } from '@/components/welding/WeldingOperations';

beforeEach(() => { h.reset(); });

describe('welding build slices', () => {
  it('S3 — the Jobs panel opens a detail editor; saving rides job-update and refreshes the header', async () => {
    h.store.jobs.push({ id: 'job1', title: 'Gate repair', client: 'Acme', scheduledDate: '2026-11-10', durationDays: 1, status: 'scheduled', crew: ['Sam'], notes: 'bring rods' });
    render(<WeldingOperations />);
    const row = await screen.findByRole('button', { name: /Gate repair/ });
    fireEvent.click(row);
    expect(await screen.findByRole('button', { name: 'Save changes' })).toBeTruthy();
    const opsBefore = h.store.opsCalls;
    fireEvent.change(screen.getByLabelText('Job status'), { target: { value: 'completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(h.store.lastUpdate?.status).toBe('completed'));
    await vi.waitFor(() => expect(h.store.opsCalls).toBeGreaterThan(opsBefore));
  });

  it('S4 — the estimate card prints its breakdown and a draft converts without sending', async () => {
    h.store.estimates.push({ id: 'est1', title: 'Rack build', client: 'Acme', lineItems: [{ description: 'Labor', quantity: 1, unitPrice: 850, kind: 'labor' }], subtotal: 850, taxRate: 0.1, tax: 85, total: 935, status: 'draft', jobId: null });
    render(<WeldingOperations />);
    fireEvent.click(await screen.findByRole('button', { name: /Quotes/ }));
    expect(await screen.findByText(/Subtotal/)).toBeTruthy();
    expect(screen.getByText('$850')).toBeTruthy();
    expect(screen.getByText(/Tax \(10%\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Convert to job/ }));
    expect(await screen.findByText('linked to job')).toBeTruthy();
  });

  it('S1 — two-step delete removes the estimate', async () => {
    h.store.estimates.push({ id: 'est9', title: 'Doomed quote', client: 'Acme', lineItems: [], subtotal: 0, taxRate: 0, tax: 0, total: 0, status: 'draft', jobId: null });
    render(<WeldingOperations />);
    fireEvent.click(await screen.findByRole('button', { name: /Quotes/ }));
    expect(await screen.findByText('Doomed quote')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
    await vi.waitFor(() => expect(screen.queryByText('Doomed quote')).toBeNull());
    expect(h.store.estimates.length).toBe(0);
  });

  it('S6 — the PQR section records a qualification record', async () => {
    render(<WeldingOperations />);
    fireEvent.click(await screen.findByRole('button', { name: /WPS/ }));
    expect(await screen.findByText(/Procedure Qualification Records \(PQR\)/)).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Supports WPS #'), { target: { value: 'WPS-001' } });
    fireEvent.click(screen.getByRole('button', { name: /Record PQR/ }));
    expect(await screen.findByText(/PQR-001/)).toBeTruthy();
    expect(h.store.pqr.length).toBe(1);
    expect(h.store.pqr[0].wpsNumber).toBe('WPS-001');
  });

  it('S7 — creating an estimate refetches the header stats on the same tab', async () => {
    render(<WeldingOperations />);
    fireEvent.click(await screen.findByRole('button', { name: /Quotes/ }));
    await screen.findByText('No estimates yet.');
    const opsBefore = h.store.opsCalls;
    fireEvent.change(screen.getByPlaceholderText('Estimate title'), { target: { value: 'New rack' } });
    fireEvent.change(screen.getByPlaceholderText('Line item description'), { target: { value: 'Labor' } });
    fireEvent.change(screen.getByPlaceholderText('Unit $'), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: /Create estimate/ }));
    await vi.waitFor(() => expect(h.store.opsCalls).toBeGreaterThan(opsBefore));
    expect(await screen.findByText('New rack')).toBeTruthy();
  });
});
