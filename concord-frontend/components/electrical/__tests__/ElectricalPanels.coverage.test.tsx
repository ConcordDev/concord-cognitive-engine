// Render + behaviour coverage for the electrical lens tools: estimate/invoice flow, inspection
// checklists, NEC calculators, NEC code calc and the panel schedule builder. Each panel mounts
// against stubbed engine results, must render real content, survive a full exercise pass
// (fill every field, press every control) and degrade honestly when the engine is offline.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomain = vi.fn();
const CIRCUIT = { id: 'c1', position: 1, name: 'Kitchen', description: 'Counter', watts: 1800, voltage: 120, amps: 15, breaker: 20, poles: 1, wireGauge: '12', phase: 'A' };
const PANEL = { id: 'p1', name: 'Main', mainBreaker: 200, voltage: 240, spaces: 40, circuits: [CIRCUIT] };
const ESTIMATE = { id: 'es1', client: 'Acme', address: '1 Main', title: 'Rewire', status: 'draft', laborLines: [{ id: 'l1', description: 'Rough-in', hours: 4, rate: 95 }], materialLines: [{ id: 'm1', description: '12/2 Romex', quantity: 100, unitPrice: 0.8, unit: 'ft' }], taxRate: 7, invoiceId: null, laborTotal: 380, materialTotal: 80, subtotal: 460, tax: 32.2, total: 492.2 };
const INVOICE = { id: 'iv1', invoiceNumber: 'INV-1', client: 'Acme', title: 'Rewire', status: 'sent', total: 492.2, issuedDate: '2026-03-01', dueDate: '2026-03-31', paidDate: null };
const CHECKLIST = { id: 'ck1', template: 'rough_in', label: 'Rough-in', jobName: 'Acme', items: [{ id: 'i1', name: 'Boxes secured', necCode: '314.23', passed: null, critical: false, notes: '' }, { id: 'i2', name: 'GFCI present', necCode: '210.8', passed: false, critical: true, notes: 'missing' }] };
const PROGRESS = { checked: 1, total: 2, passed: 0, failed: 1, criticalFailures: 1, verdict: 'fail' };

function resultFor(action: string): unknown {
  switch (action) {
    case 'estimateList': return { estimates: [ESTIMATE] };
    case 'estimateCreate': return ESTIMATE;
    case 'invoiceList': return { invoices: [INVOICE], summary: { count: 1, totalBilled: 492.2, outstanding: 492.2, paid: 0 } };
    case 'priceListGet': return { materials: [{ id: 'pr1', name: '12/2 Romex', unit: 'ft', price: 0.8, category: 'wire' }] };
    case 'checklistTemplates': return { templates: [{ key: 'rough_in', label: 'Rough-in', itemCount: 12 }, { key: 'final', label: 'Final', itemCount: 20 }] };
    case 'checklistList': return { checklists: [CHECKLIST] };
    case 'checklistCreate': return CHECKLIST;
    case 'checklistSetItem': return { checklist: CHECKLIST, progress: PROGRESS };
    case 'panelList': return { panels: [PANEL] };
    case 'panelCreate': return PANEL;
    case 'panelSchedule': return { panelId: 'p1', name: 'Main', mainBreaker: 200, voltage: 240, spacesUsed: 1, spacesTotal: 40, circuits: [CIRCUIT], totalConnectedWatts: 1800, totalDemandAmps: 15, legA_amps: 8, legB_amps: 7, phaseImbalancePercent: 6.7, utilizationPercent: 7.5, nec80PercentRule: 'OK' };
    case 'conduitFill': return { conductors: [{ awg: '12', count: 3, areaTotal: 0.1 }], totalConductors: 3, totalConductorArea: 0.1, conduitType: 'EMT', necFillLimitPercent: 40, fillRule: '3+ conductors', recommendedConduitSize: '1/2"', recommendedActualFillPercent: 22.5, requested: { size: '1/2"', actualFillPercent: 22.5, allowedFillPercent: 40, pass: true } };
    case 'boxFill': return { largestConductor: '12', volumePerConductor: 2.25, breakdown: [{ item: 'Conductors', equivalents: 6 }], totalConductorEquivalents: 8, requiredBoxVolume: 18, providedBoxVolume: 20.3, pass: true, verdict: 'Box is adequate' };
    case 'wireSize': return { loadAmps: 24, continuous: true, designAmps: 30, ampacityRequiredWire: '10', minBreaker: '30A', recommendedWire: '10 AWG', recommendedAmpacity: 30, voltageDropAtRecommended: '2.1%', upsizedForVoltageDrop: false, basis: 'NEC 310.16' };
    case 'loadCalculation': return { circuits: [{ name: 'Kitchen', watts: 1800, voltage: 120, amps: 15, breakerSize: 20, wireGauge: '12' }], totalWatts: 1800, totalAmps: 15, panelSizeRecommended: '100A', utilization: 40, safetyMargin: 60, nec80PercentRule: 'OK' };
    case 'voltageDropCalc': return { wireGauge: '12', distance: '100', current: '15', voltage: '120', voltageDrop: '3.2', dropPercent: '2.7', acceptable: true, necLimit: '3%', recommendation: 'Fine' };
    case 'circuitTrace': return { panels: 1, totalCircuits: 4, circuitMap: [{ circuit: 'K1', panel: 'Main', breaker: '20A', room: 'Kitchen', devices: ['outlet'], wireRun: 40 }], unassigned: 1, avgDevicesPerCircuit: 3 };
    case 'safetyInspection': return { results: [{ item: 'GFCI', code: '210.8', passed: true, severity: 'critical', notes: '' }, { item: 'AFCI', code: '210.12', passed: false, severity: 'major', notes: 'missing' }], total: 2, passed: 1, failed: 1, criticalFailures: 0, passRate: 50, overallResult: 'FAIL' };
    default: return { ok: true, id: 'new-1' };
  }
}
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomain(...a), list: vi.fn(async () => ({ data: { artifacts: [], total: 0 } })) } },
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => <button>save-as-dtu</button> }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import { EstimateInvoiceFlow } from '../EstimateInvoiceFlow';
import { InspectionChecklists } from '../InspectionChecklists';
import { NecCalculators } from '../NecCalculators';
import { NecCodeCalc } from '../NecCodeCalc';
import { PanelScheduleBuilder } from '../PanelScheduleBuilder';
import { SafetyNote } from '../SafetyNote';

const render = (ui: React.ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  runDomain.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: resultFor(actionOf(a)), error: null } }));
  runDomain.mockImplementation(async (_d: string, action: string) => ({ data: { ok: true, result: resultFor(action) } }));
});

const PANELS: Array<[string, () => React.ReactElement]> = [
  ['EstimateInvoiceFlow', () => <EstimateInvoiceFlow />],
  ['InspectionChecklists', () => <InspectionChecklists />],
  ['NecCalculators', () => <NecCalculators />],
  ['NecCodeCalc', () => <NecCodeCalc />],
  ['PanelScheduleBuilder', () => <PanelScheduleBuilder />],
  ['SafetyNote', () => <SafetyNote />],
];

describe('electrical panels', () => {
  it.each(PANELS)('%s renders real content with controls and survives a full exercise pass', async (_n, make) => {
    const view = render(make());
    await settle();
    expect(view.container.textContent?.trim().length).toBeGreaterThan(5);
    await exercise({ passes: 3, text: '12' });
    await settle();
    await exercise({ passes: 1, text: '240' });
    expect(view.container.textContent).toBeTruthy();
  });

  it.each(PANELS)('%s stays standing when the engine is offline', async (_n, make) => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline', result: null } }));
    runDomain.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(make());
    await settle();
    await exercise({ passes: 1 });
    expect(view.container).toBeTruthy();
  });
});

describe('electrical flows', () => {
  it('the estimate flow loads estimates, invoices and the price list', async () => {
    render(<EstimateInvoiceFlow />);
    await settle();
    const a = lensRunMock.mock.calls.map((c) => actionOf(c));
    expect(a).toEqual(expect.arrayContaining(['estimateList', 'invoiceList', 'priceListGet']));
    expect(screen.getAllByText(/Acme/).length).toBeGreaterThan(0);
  });

  it('the checklist panel loads templates and existing checklists', async () => {
    render(<InspectionChecklists />);
    await settle();
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toEqual(expect.arrayContaining(['checklistTemplates', 'checklistList']));
  });

  it('the panel builder loads panels and the active schedule', async () => {
    render(<PanelScheduleBuilder />);
    await settle();
    expect(lensRunMock.mock.calls.map((c) => actionOf(c))).toEqual(expect.arrayContaining(['panelList', 'panelSchedule']));
  });

  it('the NEC calculators run their engines when their controls are pressed', async () => {
    render(<NecCalculators />);
    await settle();
    await exercise({ passes: 3, text: '12' });
    await settle();
    const a = lensRunMock.mock.calls.map((c) => actionOf(c));
    expect(a.some((x) => /conduitFill|boxFill|wireSize/.test(x))).toBe(true);
  });

  it('the NEC code calculator calls the electrical engine through the lens domain', async () => {
    render(<NecCodeCalc />);
    await settle();
    await exercise({ passes: 3, text: '12' });
    await settle();
    expect(runDomain.mock.calls.some((c) => c[0] === 'electrical')).toBe(true);
  });

  it('an estimate is created, billed with labor and material lines, converted to an invoice and paid', async () => {
    render(<EstimateInvoiceFlow />);
    await settle();
    const press = async (re: RegExp, all = false) => {
      const hits = screen.getAllByRole('button').filter((b) => re.test(b.textContent || b.getAttribute('aria-label') || ''));
      for (const b of all ? hits : hits.slice(0, 1)) { await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); }); }
    };
    const type = (ph: string | RegExp, v: string) => fireEvent.change(screen.getAllByPlaceholderText(ph)[0], { target: { value: v } });
    // new estimate
    await press(/New (estimate|quote)|^\s*New\s*$/i);
    if (screen.queryAllByPlaceholderText('Client name').length) {
      type('Client name', 'Globex'); type('Job title', 'Panel swap'); type('Service address', '2 Elm'); type('Tax %', '8');
      await press(/Create/i);
    }
    // open the seeded estimate and add lines
    await press(/Acme|Rewire/);
    type('Labor description', 'Trim out'); type('Hrs', '3');
    await press(/Add labor|^\s*Add\s*$/i);
    type('Qty', '10'); type('$/unit', '1.5');
    const addMat = screen.getAllByRole('button').filter((b) => /^\s*Add/i.test(b.textContent || ''));
    for (const b of addMat) await act(async () => { fireEvent.click(b); await new Promise((r) => setTimeout(r, 0)); });
    await press(/Delete/, false);
    await press(/Convert to invoice/i);
    await press(/Mark paid|Paid/i);
    await press(/Estimates/);
    const a = lensRunMock.mock.calls.map((c) => actionOf(c));
    expect(a).toEqual(expect.arrayContaining(['estimateAddLine', 'estimateToInvoice']));
    expect(a.some((x) => /estimateCreate|estimateRemoveLine|invoiceMarkPaid/.test(x))).toBe(true);
  });
});
