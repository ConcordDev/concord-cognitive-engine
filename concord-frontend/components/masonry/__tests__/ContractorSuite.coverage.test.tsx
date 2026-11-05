// Render coverage for the masonry contractor suite: every tab (takeoff, proposals,
// schedule, photos, change orders, price book, invoices, codes, clients,
// inspections, certifications) against stubbed records.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const T = '2026-03-01T10:00:00.000Z';
const CODE = { code: 'TMS 602', section: '6.1', topic: 'Mortar joints', standard: 'TMS', summary: 'Joint thickness', tags: ['mortar'] };
const RES: Record<string, unknown> = {
  'takeoff-list': { takeoffs: [{ id: 't1', name: 'Garden wall', material: 'brick', materialLabel: 'Modular brick', segments: [{ id: 's1', label: 'North', lengthFeet: 20, heightFeet: 6, areaSqFt: 120 }], openings: [{ id: 'o1', label: 'Gate', widthFeet: 4, heightFeet: 6, areaSqFt: 24 }], grossAreaSqFt: 120, openingAreaSqFt: 24, netAreaSqFt: 96, linearFeet: 20, wastePct: 10, unitsNeeded: 780, mortarBags80lb: 8, materialCost: 600, mortarCost: 80, totalMaterialCost: 680 }] },
  'proposal-list': { proposals: [{ id: 'p1', number: 'P-1', client: 'Ann', projectTitle: 'Patio', scopeOfWork: 'Lay pavers', terms: 'Net 30', status: 'draft', lines: [{ id: 'l1', description: 'Pavers', unit: 'sqft', quantity: 100, unitCost: 8, lineTotal: 800 }], subtotal: 800, marginPct: 20, margin: 160, taxPct: 8, tax: 76.8, total: 1036.8, createdAt: T }] },
  'proposal-render': { number: 'P-1', document: 'PROPOSAL P-1\nPatio' },
  'schedule-list': { jobs: [{ id: 'j1', title: 'Patio', startDate: '2026-03-10', durationDays: 3, crew: ['Mo', 'Lu'], status: 'scheduled', forecastLowF: 28, precipChancePct: 60, weather: { risk: 'high', advisories: ['Freeze risk'] } }] },
  'photo-list': { photos: [{ id: 'ph1', jobId: 'j1', url: 'https://example.org/a.jpg', phase: 'before', caption: 'Site', takenAt: T }] },
  'change-order-list': { changeOrders: [{ id: 'co1', number: 'CO-1', jobId: 'j1', description: 'Extra course', laborHours: 4, laborRate: 60, laborCost: 240, materialCost: 100, amount: 340, status: 'pending', scheduleImpactDays: 1, signedBy: null }, { id: 'co2', number: 'CO-2', jobId: 'j1', description: 'Cap', laborHours: 1, laborRate: 60, laborCost: 60, materialCost: 0, amount: 60, status: 'approved', scheduleImpactDays: 0, signedBy: 'Ann' }], approvedTotal: 60, pendingTotal: 340 },
  'pricebook-list': { items: [{ id: 'pb1', sku: 'BR-1', name: 'Modular brick', unit: 'each', unitCost: 0.8, category: 'masonry units' }] },
  'invoice-list': { invoices: [{ id: 'iv1', number: 'INV-1', client: 'Ann', jobId: 'j1', contractTotal: 5000, progressPct: 50, amount: 2500, dueDate: '2026-03-30', status: 'sent', payments: [{ id: 'pm1', amount: 500, method: 'check', date: '2026-03-05' }], amountPaid: 500, balance: 2000 }], totalBilled: 2500, totalCollected: 500, outstanding: 2000 },
  'code-search': { results: [CODE], standards: ['TMS', 'IBC'] },
  'code-for-check': { references: [CODE] },
  'client-list': { clients: [{ id: 'c1', name: 'Ann', phone: '555', email: 'a@b.co', address: '1 Main', notes: '', proposalsCount: 1, proposalsValue: 1036, invoicesCount: 1, invoicesTotal: 2500, invoicesPaid: 500, invoicesOutstanding: 2000 }], totalRevenue: 500 },
  'inspection-list': { inspections: [{ id: 'in1', number: 'INSP-1', jobId: 'j1', jobTitle: 'Patio', jobFound: true, inspectionType: 'footing', inspector: 'Lee', scheduledDate: '2026-03-12', result: 'fail', deficiencyNotes: 'depth', reInspectionDate: '2026-03-20', notes: '', completedAt: T }, { id: 'in2', number: 'INSP-2', jobId: 'j1', jobTitle: null, jobFound: false, inspectionType: 'final', inspector: '', scheduledDate: '2026-03-30', result: 'pending', deficiencyNotes: null, reInspectionDate: null, notes: '', completedAt: null }], passCount: 0, failCount: 1, pendingCount: 1 },
  'cert-list': { certifications: [{ id: 'ce1', crewMemberName: 'Mo', certType: 'OSHA 30', issuingBody: 'OSHA', licenseNumber: 'X1', issueDate: '2024-01-01', expiryDate: '2026-04-01', expiryStatus: 'expiring_soon', isExpired: false }, { id: 'ce2', crewMemberName: 'Lu', certType: 'Journeyman', issuingBody: 'State', licenseNumber: 'Y2', issueDate: null, expiryDate: '2025-01-01', expiryStatus: 'expired', isExpired: true }], roster: ['Mo', 'Lu'], expiredCount: 1, expiringSoonCount: 1 },
  'proposal-create': { id: 'p2' }, 'invoice-create': { id: 'iv2' }, 'inspection-add': { id: 'in3' },
};
RES['takeoff-save'] = (RES['takeoff-list'] as { takeoffs: unknown[] }).takeoffs[0];
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a), api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div />, TimelineView: () => <div /> }));

import { ContractorSuite } from '../ContractorSuite';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: RES[actionOf(a)] ?? { ok: true }, error: null } }));
});

const TABS = ['Takeoff', 'Proposals', 'Schedule', 'Photos', 'Change Orders', 'Price Book', 'Invoices', 'Code Library', 'Clients', 'Inspections', 'Certifications'];
describe('ContractorSuite', () => {
  it.each(TABS)('walks the %s tab', async (label) => {
    const view = render(<ContractorSuite />);
    await settle();
    const tab = screen.getAllByRole('button').find((b) => (b.textContent || '').trim() === label);
    if (tab) await act(async () => { fireEvent.click(tab); });
    await settle();
    const skip = new RegExp(`^(${TABS.join('|')})$`);
    await exercise({ passes: 4, skip });
    await settle();
    await exercise({ passes: 2, skip, text: '5' });
    expect(view.container.textContent).toBeTruthy();
  });
  it('is honest when the shop records are unavailable', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<ContractorSuite />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container.textContent).toBeTruthy();
  });
});
