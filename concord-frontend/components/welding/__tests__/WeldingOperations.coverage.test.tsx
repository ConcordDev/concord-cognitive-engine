// Render + behaviour coverage for the welding operations console: every tab (schedule, quotes,
// invoices, WPS/PQR, certs, photos, codes) driven against an action-keyed fake of the welding
// domain with real result shapes.

import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const JOB = (id: string, status: string, date?: string) => ({ id, title: `Job ${id}`, client: 'Acme', address: '1 Main', crew: ['Ann', 'Bo'], scheduledDate: date, durationDays: 2, status, estimateId: null, contractValue: 5000, notes: '' });
const EST = (id: string, status: string) => ({ id, title: `Estimate ${id}`, client: 'Acme', address: '1 Main', lineItems: [{ description: 'Labor', quantity: 10, unitPrice: 80, kind: 'labor' }, { description: 'Steel', quantity: 5, unitPrice: 40, kind: 'material' }], subtotal: 1000, taxRate: 0.08, tax: 80, total: 1080, status, jobId: status === 'accepted' ? 'j1' : null, portalToken: 'tok123' });
const INV = (id: string, status: string, overdue = false) => ({ id, invoiceNumber: `INV-${id}`, jobId: 'j1', client: 'Acme', title: 'Frame weld', amount: 2000, amountPaid: status === 'paid' ? 2000 : 500, balance: status === 'paid' ? 0 : 1500, status, issuedDate: '2026-03-01', dueDate: '2026-03-31', payments: [{ id: 'pay1', amount: 500, method: 'check', reference: '#44', recordedAt: '2026-03-05T00:00:00Z' }], portalToken: 'tok999', overdue });
const WPS = (id: string, status: string) => ({ id, wpsNumber: `WPS-${id}`, jobId: null, process: 'SMAW', baseMetal: 'mild-steel', jointDesign: 'fillet', positions: ['flat', 'vertical'], fillerMetal: 'E7018', amperageRange: '90-130', voltageRange: '20-24', thicknessRange: '3-19mm', preheat: '50C', code: 'AWS D1.1', revision: 'A', status, approvedBy: status === 'approved' ? 'QA' : undefined });
const CERT = (id: string, standing: string, dte: number | null) => ({ id, welder: `Welder ${id}`, certType: 'AWS D1.1 3G', certNumber: 'C-1', process: 'SMAW', position: '3G', issuedBy: 'AWS', issuedDate: '2025-01-01', expiryDate: '2026-12-01', lastContinuityDate: '2026-02-01', daysToExpiry: dte, daysSinceContinuity: 40, standing });
function resultFor(action: string): unknown {
  switch (action) {
    case 'ops-summary': return { activeJobs: 3, completedJobs: 9, pipelineValue: 12000, outstanding: 3000, collected: 8000, overdueInvoices: 1, certAtRisk: 1 };
    case 'calendar': return { days: [{ date: '2026-03-10', jobs: [{ id: 'j1', title: 'Job j1', client: 'Acme', status: 'scheduled', crew: ['Ann'] }] }, { date: '2026-03-11', jobs: [] }], unscheduled: [{ id: 'j2', title: 'Job j2', client: 'Beta' }], crewLoad: { Ann: 3, Bo: 1 }, scheduledCount: 1 };
    case 'job-list': return { jobs: [JOB('j1', 'scheduled', '2026-03-10'), JOB('j2', 'in_progress'), JOB('j3', 'completed', '2026-02-01')] };
    case 'job-schedule': return { job: JOB('j9', 'scheduled', '2026-03-12') };
    case 'estimate-list': return { estimates: [EST('e1', 'draft'), EST('e2', 'sent'), EST('e3', 'accepted')], pipelineValue: 2160, wonValue: 1080 };
    case 'invoice-list': return { invoices: [INV('i1', 'sent'), INV('i2', 'paid'), INV('i3', 'sent', true)], outstanding: 3000, collected: 2000, overdueCount: 1 };
    case 'wps-list': return { wps: [WPS('w1', 'draft'), WPS('w2', 'approved')] };
    case 'pqr-list': return { pqr: [{ id: 'q1', pqrNumber: 'PQR-1', process: 'SMAW', baseMetal: 'mild-steel', thickness: '19mm', result: 'pass', testedDate: '2026-01-10', wpsId: 'w2' }], pqrs: [{ id: 'q1', pqrNumber: 'PQR-1', process: 'SMAW', baseMetal: 'mild-steel', thickness: '19mm', result: 'pass', testedDate: '2026-01-10' }] };
    case 'cert-status': return { certs: [CERT('c1', 'valid', 200), CERT('c2', 'expiring', 20), CERT('c3', 'expired', -10)], alerts: [{ certId: 'c2', welder: 'Welder c2', certType: 'AWS D1.1 3G', standing: 'expiring', message: 'Expires in 20 days' }], validCount: 1, atRiskCount: 2 };
    case 'photo-list': return { photos: [{ id: 'ph1', url: 'https://img/1.jpg', stage: 'fit-up', caption: 'Root pass', weldId: 'W-1', addedAt: '2026-03-01T00:00:00Z' }], byStage: { 'fit-up': 1 } };
    case 'code-search': return { results: [{ id: 'cd1', code: 'AWS D1.1', clause: '5.2', title: 'Preheat', body: 'Minimum preheat per table 5.8', keywords: ['preheat'], relevance: 0.9 }], codes: ['AWS D1.1', 'ASME IX'] };
    default: return { ok: true, estimate: EST('en', 'draft'), invoice: INV('in', 'sent'), job: JOB('j9', 'scheduled'), wps: WPS('wn', 'draft'), cert: CERT('cn', 'valid', 300), deleted: true };
  }
}
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a) }));
vi.mock('@/components/viz', () => ({ ChartKit: ({ data }: { data?: unknown[] }) => <div>chart:{data?.length ?? 0}</div> }));

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
const sent = () => lensRunMock.mock.calls.map((c) => actionOf(c));
const TAB_RE = /^(Schedule|Quotes|Invoices|WPS|Certs|Photos|Codes)$/;
const goTab = async (name: string) => { const b = screen.getAllByRole('button').find((x) => (x.textContent || '').trim() === name); if (b) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 25)); }); };
const mount = async () => { const { WeldingOperations } = await import('../WeldingOperations'); const v = render(<WeldingOperations />); await settle(); return v; };
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)) } }));
  vi.spyOn(window, 'alert').mockImplementation(() => {});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
});

describe('WeldingOperations', () => {
  it('shows header stats and walks every tab exercising its controls', { timeout: 150000 }, async () => {
    const v = await mount();
    expect(sent()).toContain('ops-summary');
    for (const t of ['Schedule', 'Quotes', 'Invoices', 'WPS', 'Certs', 'Photos', 'Codes']) {
      await goTab(t);
      await exercise({ passes: 2, text: '25', skip: new RegExp(`${TAB_RE.source}|delete|remove|trash|discard|cancel|close|dismiss|clear|^×$`, 'i') });
      await settle();
    }
    const calls = sent();
    for (const a of ['calendar', 'job-list', 'estimate-list', 'invoice-list', 'wps-list', 'cert-status', 'code-search']) expect(calls).toContain(a);
    expect(v.container.textContent?.length).toBeGreaterThan(100);
  });

  it('runs destructive paths too (deletes, removes) across tabs', { timeout: 150000 }, async () => {
    const v = await mount();
    for (const t of ['Schedule', 'Quotes', 'Invoices', 'WPS', 'Certs', 'Photos']) {
      await goTab(t);
      await exercise({ passes: 2, text: 'x', skip: new RegExp(`${TAB_RE.source}|cancel|close|dismiss|^×$`, 'i') });
      await settle();
    }
    expect(sent().some((x) => /-delete$|-remove$/.test(x))).toBe(true);
    expect(v.container.textContent?.length).toBeGreaterThan(50);
  });

  it('survives failing and empty backends on every tab', { timeout: 150000 }, async () => {
    lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: false, error: actionOf(a) === 'wps-approve' ? 'incomplete_wps' : 'welding offline' } }));
    const v = await mount();
    for (const t of ['Schedule', 'Quotes', 'Invoices', 'WPS', 'Certs', 'Photos', 'Codes']) {
      await goTab(t);
      await exercise({ passes: 1, text: '7', skip: new RegExp(`${TAB_RE.source}|delete|remove|cancel|close|^×$`, 'i') });
    }
    cleanup();
    lensRunMock.mockImplementation(async () => ({ data: { ok: true, result: { jobs: [], estimates: [], invoices: [], wps: [], certs: [], alerts: [], photos: [], byStage: {}, results: [], days: [], unscheduled: [], crewLoad: {}, pqr: [] } } }));
    const empty = await mount();
    for (const t of ['Schedule', 'Quotes', 'Invoices', 'WPS', 'Certs', 'Photos', 'Codes']) await goTab(t);
    expect(empty.container.textContent?.length).toBeGreaterThan(20);
  });
});
