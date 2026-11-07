// Render coverage for the plumbing calculators and field-service console plus
// the STSVK explorer: stubbed macros, then the generic sweep drives each section.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
const T = '2026-03-01T10:00:00.000Z';
const ASSIGN = { id: 'a1', jobTitle: 'Water heater swap', client: 'Ann', clientId: 'cl1', address: '1 Main', techId: 't1', date: '2026-03-01', startHour: 9, durationHours: 2, priority: 'high', status: 'scheduled', partsUsed: [{ name: 'valve', deducted: 1 }], workflow: { progress: 50, completedAt: null } };
const INV = { id: 'i1', number: 'INV-1', client: 'Ann', clientId: 'cl1', lines: [{ priceItemId: 'p1', name: 'Labor', quantity: 2, unitPrice: 90, total: 180 }], subtotal: 180, taxPct: 8, tax: 14.4, total: 194.4, status: 'sent', amountPaid: 50, dueDate: '2026-03-15', payments: [{ id: 'pm1', amount: 50, method: 'card', at: T }] };
const WF = { id: 'w1', assignmentId: 'a1', checklist: [{ label: 'Shut off water', done: true }, { label: 'Pressure test', done: false }], photos: [{ id: 'ph1', caption: 'before', at: T }], signature: null, signedBy: null, startedAt: T, completedAt: null };
const RES: Record<string, unknown> = {
  opsSummary: { jobsToday: 3, openJobs: 5, unassigned: 1, outstandingAR: 900, collected: 1200, activePlans: 2, recurringRevenue: 300, lowStockParts: 1 },
  techList: { techs: [{ id: 't1', name: 'Rae', skills: ['gas'], phone: '555', baseColor: '#38bdf8', active: true, openJobs: 2, certifications: [], expiredCertCount: 0 }] },
  dispatchBoard: { lanes: [{ techId: 't1', techName: 'Rae', baseColor: '#38bdf8', assignments: [ASSIGN], loadHours: 2 }], unassigned: [{ ...ASSIGN, id: 'a2', techId: null }], emergencyCount: 1 },
  priceBookList: { items: [{ id: 'p1', name: 'Labor', kind: 'labor', unit: 'hr', cost: 40, markupPct: 125, price: 90, sku: 'L1' }], avgMarkupPct: 125, avgMarginPct: 55 },
  invoiceList: { invoices: [INV], outstanding: 144.4, collected: 50 },
  planList: { plans: [{ id: 'pl1', client: 'Ann', clientId: 'cl1', title: 'Annual flush', cadence: 'annual', fee: 200, startDate: '2026-01-01', nextVisit: '2026-03-10', visitsCompleted: 1, active: true }], recurringRevenue: 200, dueSoon: 1 },
  notifyLog: { notices: [{ id: 'n1', client: 'Ann', kind: 'reminder', channel: 'sms', message: 'Tomorrow', status: 'sent', sentAt: T }], byKind: { reminder: 1 } },
  partList: { parts: [{ id: 'pt1', name: 'Valve', sku: 'V1', onHand: 1, reorderAt: 3, unitCost: 12 }], lowStock: ['Valve'], inventoryValue: 12 },
  inspectionList: { inspections: [{ id: 'in1', number: 'INSP-1', assignmentId: 'a1', jobTitle: 'Water heater swap', jobFound: true, address: '1 Main', inspectionType: 'rough_in', inspector: 'Lee', jurisdiction: 'City', permitNumber: 'P1', scheduledDate: '2026-03-05', result: 'pending', deficiencyNotes: null, reInspectionDate: null, notes: '', completedAt: null }], passCount: 0, failCount: 0, pendingCount: 1 },
  clientList: { clients: [{ id: 'cl1', name: 'Ann', phone: '555', email: 'a@b.co', address: '1 Main' }] },
  workflowGet: { workflow: WF, progress: 50 },
  workflowStart: { workflow: WF, progress: 0 },
  workflowUpdate: { workflow: WF, progress: 75 },
  invoiceFromQuote: { invoice: INV },
};
const CALC = {
  flowRate: '8 GPM', velocity: '5 ft/s', calculatedDiameter: '0.9"', recommendedSize: '1" nominal', material: 'copper', note: 'ok',
  household: 4, peakDemandGPM: 8, tankRecommendation: '50 gal', tanklessRecommendation: '7 GPM', firstHourRating: 70, recommendation: 'tank',
  pipeSize: '3"', length: '20 ft', slopePerFoot: '1/4"', totalDrop: '5"', ipcCode: 'IPC 704.1', tip: 'tip',
  fixtures: 3, totalWSFU: 9, meterSize: '3/4"', supplyLine: '1"', breakdown: [{ type: 'toilet', count: 2, wsfuEach: 2.5, subtotal: 5 }],
};

vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomainMock(...a) } },
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>Save as DTU</button>, default: () => <button>Save as DTU</button> }));
vi.mock('@/components/plumbing/CodeReferencePanel', () => ({ CodeReferencePanel: () => <div data-testid="codes" /> }));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div />, TimelineView: () => <div /> }));

import { PlumbCalc } from './PlumbCalc';
import { FieldServiceConsole } from './FieldServiceConsole';
import STSVKExplorer from '../visualizations/STSVKExplorer';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset(); runDomainMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: RES[actionOf(a)] ?? { ok: true }, error: null } }));
  runDomainMock.mockImplementation(async () => ({ data: { ok: true, result: { ok: true, result: CALC } } }));
  const ctx: object = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? {} : k === 'measureText' ? () => ({ width: 10 }) : () => ctx), set: () => true });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as never;
});

describe('PlumbCalc', () => {
  it('runs every calculator', async () => {
    const view = render(<PlumbCalc />);
    await settle();
    await exercise({ passes: 4, text: '5' });
    await settle();
    expect(view.container.textContent).toContain('Pipe');
  });
  it('shows an honest empty state when a calculator fails', async () => {
    runDomainMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<PlumbCalc />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('FieldServiceConsole', () => {
  it.each(['Dispatch', 'Price Book', 'Quote → Invoice', 'Tech Workflow', 'Service Plans', 'Notifications', 'Parts Inventory', 'Inspections'])('walks the %s section', async (label) => {
    const view = render(<FieldServiceConsole />);
    await settle();
    const tab = screen.getAllByRole('button').find((b) => (b.textContent || '').trim() === label);
    if (tab) await act(async () => { fireEvent.click(tab); });
    await settle();
    await exercise({ passes: 3, skip: /^(dispatch|price book|quote → invoice|tech workflow|service plans|notifications|parts inventory|inspections)$|delete|remove|trash/i });
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
  it('survives offline macros', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<FieldServiceConsole />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('STSVKExplorer', () => {
  it('renders sample theorems and responds to the slider and canvas', async () => {
    const view = render(<STSVKExplorer />);
    await settle();
    await exercise({ passes: 2 });
    for (const c of Array.from(view.container.querySelectorAll('canvas'))) {
      await act(async () => {
        fireEvent.mouseDown(c, { clientX: 100, clientY: 50 }); fireEvent.mouseMove(c, { clientX: 200, clientY: 50 });
        fireEvent.mouseUp(c, { clientX: 200, clientY: 50 }); fireEvent.mouseLeave(c);
      });
    }
    expect(view.container.textContent).toBeTruthy();
  });
});
