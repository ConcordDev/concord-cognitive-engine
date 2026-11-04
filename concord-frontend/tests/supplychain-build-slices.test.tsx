/**
 * Supplychain full lens build (GB-1088 Wave 1) — frontend slice pins.
 *
 * F1  the manifest declares the tier the substrate earns (REAL_FREE).
 * F2  bulk editors hold NO example text as value or placeholder — examples
 *     live outside the input, labelled, and load only on a deliberate click.
 * F3  the Overview joins the last Planner scan (exceptionLatest) into the
 *     exceptions tile + list, with provenance, instead of reading only
 *     live shipment/PO alerts.
 * F4  team shipments/work orders carry the same controls as the personal
 *     panels (advance/delete, role-gated), and the team PO form sends
 *     quantity + unit cost (no more $0 POs).
 * F6  the forecast card sends the α the user set and prints the method.
 * F7  the scorecard names its top supplier on 2-metric lines, discloses
 *     partial scoring, and renders an honest state — never "undefined".
 * F9  ETA drift renders absolute ("1d early", never "-1d early"); the
 *     saved network reloads into the network editors (networkGet).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

type LensRunImpl = (domain: string, action: string, input?: unknown) => Promise<{ data: { ok: boolean; result?: unknown; error?: string } }>;
const lensRunMock = vi.fn<Parameters<LensRunImpl>, ReturnType<LensRunImpl>>();
const runDomainMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: Parameters<LensRunImpl>) => lensRunMock(...args),
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...args: unknown[]) => runDomainMock(...args) } },
  isForbidden: () => false,
}));

vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', email: 'me@x', role: 'user' }, isLoading: false, isAuthenticated: true }),
}));
vi.mock('@/components/viz', () => ({
  ChartKit: () => null, TimelineView: () => null, TreeDiagram: () => null, MapView: () => null,
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: async (fn: () => Promise<unknown>) => fn() }),
  RecallSlot: () => null,
  PipingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({
  withContentLicense: (x: unknown) => x,
}));

import { LENS_MANIFESTS } from '@/lib/lenses/manifest';
import { SupplyChainOverview } from '@/components/supplychain/SupplyChainOverview';
import { SupplyChainPlanner } from '@/components/supplychain/SupplyChainPlanner';
import { SupplyChainActionPanel } from '@/components/supplychain/SupplyChainActionPanel';
import { OrgCollabPanel } from '@/components/supplychain/OrgCollabPanel';

function mockByAction(handlers: Record<string, unknown | ((input: unknown) => unknown)>) {
  lensRunMock.mockImplementation((_domain, action, input) => {
    if (!(action in handlers)) return Promise.resolve({ data: { ok: true, result: null } });
    const h = handlers[action];
    const result = typeof h === 'function' ? (h as (i: unknown) => unknown)(input) : h;
    return Promise.resolve({ data: { ok: true, result } });
  });
}

beforeEach(() => {
  lensRunMock.mockReset();
  runDomainMock.mockReset();
});

const EMPTY_GRAPH = { tree: [], markers: [], counts: { supplier: 0, factory: 0, warehouse: 0, customer: 0 }, edgeCount: 0, criticalLeadTime: 0, orphans: [] };

/* ─────────────────────────────── F1 ─────────────────────────────── */

describe('F1 manifest tier declaration', () => {
  it('supplychain declares REAL_FREE and its empty-state copy no longer claims a simulated engine', () => {
    const entry = LENS_MANIFESTS.find((m) => m.domain === 'supplychain');
    expect(entry).toBeTruthy();
    expect(entry?.dataTier).toBe('REAL_FREE');
    expect(entry?.emptyState.caption).not.toContain('SIM_GRADE_A');
  });
});

/* ─────────────────────────────── F3 ─────────────────────────────── */

describe('F3 Overview — scan results reach the control tower', () => {
  const base = {
    shipmentList: { shipments: [], inTransit: 0, delivered: 0, delayed: 0 },
    networkGraph: EMPTY_GRAPH,
    workOrderList: { openValue: 0, overdueCount: 0, workOrders: [] },
    exceptionScan: {
      critical: 1, warning: 0,
      alerts: [{ id: 'a1', severity: 'critical', kind: 'late_shipment', message: 'Shipment SHP-9 is 3d late', detail: 'carrier Acme' }],
      byKind: { late_shipment: 1 },
    },
  };

  it('merges the last scan into tile counts + alert list, with provenance', async () => {
    mockByAction({
      ...base,
      exceptionLatest: {
        scan: {
          scannedAt: Date.now(), critical: 1, warning: 1,
          alerts: [
            { id: 'a2', severity: 'critical', kind: 'stockout', message: 'Widget A is out of stock', detail: '12/day demand unmet' },
            { id: 'a3', severity: 'warning', kind: 'at_risk_supplier', message: 'Acme Corp performance at risk', detail: 'quality 45, on-time 55%' },
          ],
        },
      },
    });
    render(<SupplyChainOverview onJump={() => {}} />);
    // NOTE: the KPI tiles are framer-motion wrappers whose text does not
    // paint under jsdom in the borrowed test env (the pre-existing
    // lens-states POPULATED/REFRESH tests hit the same wall there), so the
    // join is asserted on the exceptions section, which renders the same
    // merged object the tiles read.
    await waitFor(() => expect(screen.getByText('Widget A is out of stock')).toBeInTheDocument());
    expect(screen.getByText('Acme Corp performance at risk')).toBeInTheDocument();
    expect(screen.getByText('Shipment SHP-9 is 3d late')).toBeInTheDocument();
    expect(screen.getByText(/All \(3\)/)).toBeInTheDocument();
    expect(screen.getByText(/from your last Control Tower scan/)).toBeInTheDocument();
  });

  it('without a stored scan, says how inventory/supplier alerts get here', async () => {
    mockByAction({ ...base, exceptionLatest: { scan: null } });
    render(<SupplyChainOverview onJump={() => {}} />);
    await waitFor(() => expect(screen.getByText('Shipment SHP-9 is 3d late')).toBeInTheDocument());
    expect(screen.getByText(/Run a scan in the Control Tower/)).toBeInTheDocument();
  });
});

/* ──────────────────────── F2 + F9 — the Planner ─────────────────────── */

describe('F2/F9 Planner — editors, saved network, ETA wording', () => {
  it('network editors start empty with no placeholder text; the saved network reloads into them', async () => {
    mockByAction({
      networkGraph: EMPTY_GRAPH,
      networkGet: {
        saved: true,
        nodes: [{ id: 's1', label: 'Shenzhen Mill', kind: 'supplier', location: 'Shenzhen', capacity: 5000 }],
        edges: [],
      },
      shipmentList: { shipments: [], inTransit: 0, delivered: 0, delayed: 0 },
    });
    const { container } = render(<SupplyChainPlanner />);
    fireEvent.click(screen.getByText('Supply network'));
    await waitFor(() => expect(screen.getByText(/Showing your saved network/)).toBeInTheDocument());
    const tas = container.querySelectorAll('textarea');
    expect(tas.length).toBeGreaterThanOrEqual(2);
    tas.forEach((ta) => expect(ta.getAttribute('placeholder')).toBeNull());
    expect((tas[0] as HTMLTextAreaElement).value).toContain('s1 | Shenzhen Mill | supplier | Shenzhen | 5000');
    expect(screen.getAllByText(/Example — not your data/).length).toBeGreaterThan(0);
  });

  it('loading an example fills the editor with real lines (line breaks preserved)', async () => {
    mockByAction({
      networkGraph: EMPTY_GRAPH,
      networkGet: { saved: false, nodes: [], edges: [] },
      shipmentList: { shipments: [], inTransit: 0, delivered: 0, delayed: 0 },
    });
    const { container } = render(<SupplyChainPlanner />);
    fireEvent.click(screen.getByText('Multi-echelon'));
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toBe('');
    fireEvent.click(screen.getByText('Load example'));
    expect(ta.value.split('\n')).toHaveLength(3);
    expect(ta.value).toContain('LA DC | regional | 120 | 7 | 900 | 40');
  });

  it('a delivered shipment 1 day early reads "1d early", never "-1d early"', async () => {
    mockByAction({
      shipmentList: {
        shipments: [{
          id: 'sh1', reference: 'SHP-EARLY', carrier: 'Acme', trackingNumber: '', origin: 'Shanghai', destination: 'Los Angeles',
          status: 'delivered', value: 0, plannedEtaDays: 10, createdAt: 0, etaAt: 0, deliveredAt: 0,
          etaDriftDays: -1, late: false, health: 'delivered', checkpoints: [], route: [],
        }],
        inTransit: 0, delivered: 1, delayed: 0,
      },
    });
    render(<SupplyChainPlanner />);
    await waitFor(() => expect(screen.getByText('SHP-EARLY')).toBeInTheDocument());
    expect(screen.getByText(/1d early/)).toBeInTheDocument();
    expect(screen.queryByText(/-1d early/)).toBeNull();
  });

  it('the Scan button persists (feeds the tower); the mount scan does not', async () => {
    mockByAction({
      exceptionScan: { alerts: [], critical: 0, warning: 0, byKind: {}, ropModel: 'A supplied reorder point is used as given; a row without one derives ROP = daily demand × lead time × 1.5 (0.5 safety factor — the inventory optimizer\'s rule).' },
      shipmentList: { shipments: [], inTransit: 0, delivered: 0, delayed: 0 },
    });
    render(<SupplyChainPlanner />);
    fireEvent.click(screen.getByText('Exceptions'));
    await waitFor(() => {
      const calls = lensRunMock.mock.calls.filter((c) => c[1] === 'exceptionScan');
      expect(calls.length).toBeGreaterThan(0);
      expect((calls[0][2] as Record<string, unknown>).persist).toBe(false);
    });
    fireEvent.click(screen.getByText(/Scan exceptions/));
    await waitFor(() => {
      const calls = lensRunMock.mock.calls.filter((c) => c[1] === 'exceptionScan');
      expect((calls[calls.length - 1][2] as Record<string, unknown>).persist).toBe(true);
    });
    expect(await screen.findByText(/derives ROP = daily demand/)).toBeInTheDocument();
  });
});

/* ───────────────────── F6 + F7 — the ActionPanel ───────────────────── */

describe('F6/F7 ActionPanel — α input, method line, honest scorecard', () => {
  function mockRunDomain(byAction: Record<string, unknown>) {
    runDomainMock.mockImplementation((_domain: string, action: string) => {
      return Promise.resolve({ data: { ok: true, result: byAction[action] ?? {} } });
    });
  }

  it('scorecard on 2-metric lines names the top supplier and discloses partial scoring', async () => {
    mockRunDomain({
      supplierScore: {
        suppliers: [
          { supplier: 'Globex', quality: 80, delivery: 92, price: null, responsiveness: null, totalScore: 86, tier: 'preferred', scoredOn: ['qualityScore', 'onTimePercent'], missingInputs: ['priceCompetitiveness', 'responsiveness'] },
          { supplier: 'Ghost', quality: null, delivery: null, price: null, responsiveness: null, totalScore: null, tier: null, scoredOn: [], missingInputs: ['qualityScore'] },
        ],
        topSupplier: 'Globex', atRisk: 0, method: 'Weighted score over the metrics supplied for each supplier.',
      },
    });
    const { container } = render(<SupplyChainActionPanel />);
    const supArea = container.querySelectorAll('textarea')[2];
    fireEvent.change(supArea, { target: { value: 'Globex | 80 | 92' } });
    fireEvent.click(screen.getByText('Score suppliers'));
    await waitFor(() => expect(screen.getByText(/top: Globex/)).toBeInTheDocument());
    expect(screen.getByText(/on 2\/4 metrics/)).toBeInTheDocument();
    expect(screen.getByText(/not scored — no metrics supplied/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('undefined');
  });

  it('when nobody scores, the card says "none scored" — never "undefined"', async () => {
    mockRunDomain({ supplierScore: { suppliers: [], topSupplier: null, atRisk: 0 } });
    const { container } = render(<SupplyChainActionPanel />);
    const supArea = container.querySelectorAll('textarea')[2];
    fireEvent.change(supArea, { target: { value: 'Ghost |' } });
    fireEvent.click(screen.getByText('Score suppliers'));
    await waitFor(() => expect(screen.getByText(/none scored/)).toBeInTheDocument());
    expect(container.textContent).not.toContain('undefined');
  });

  it('forecast sends the α the user set and prints the method + fit', async () => {
    mockRunDomain({
      demandForecast: {
        historicalPeriods: 4, avgDemand: 115, trend: 'increasing',
        forecast: [{ period: '+1', predicted: 115, confidence: 'high' }],
        method: 'simple-exponential-smoothing', alpha: 0.5, mapePct: 13.4, accuracy: 'good',
      },
    });
    const { container } = render(<SupplyChainActionPanel />);
    const histArea = container.querySelectorAll('textarea')[3];
    fireEvent.change(histArea, { target: { value: '100 110 120 130' } });
    fireEvent.change(screen.getByLabelText(/Smoothing α/), { target: { value: '0.5' } });
    fireEvent.click(screen.getByText('Forecast demand'));
    await waitFor(() => expect(runDomainMock).toHaveBeenCalled());
    const call = runDomainMock.mock.calls.find((c) => c[1] === 'demandForecast');
    expect(JSON.stringify(call?.[2])).toContain('"alpha":0.5');
    expect(await screen.findByText(/Exponential smoothing \(α 0.5\)/)).toBeInTheDocument();
    expect(screen.getByText(/MAPE 13.4%/)).toBeInTheDocument();
  });
});

/* ──────────────────────── F4 — team controls ─────────────────────── */

describe('F4 OrgCollabPanel — team entries carry controls; the PO form sends qty/cost', () => {
  const ORG = { id: 'org_1', name: 'Meridian Logistics', type: 'firm', leaderId: 'me', memberCount: 1, myRole: 'leader', myScRole: 'planner' };
  const MEMBERS = {
    organization: ORG,
    members: [{ userId: 'me', role: 'leader', scRole: 'planner' }],
    pending: [], myRole: 'planner', myOrgRole: 'leader',
  };
  const SHIPMENTS = {
    shipments: [{ id: 'ship_1', reference: 'TEAM-1', status: 'in_transit', origin: 'Shanghai', destination: 'Los Angeles' }],
    inTransit: 1, delivered: 0, delayed: 0,
  };
  const WORK_ORDERS = {
    workOrders: [{ id: 'wo_1', poNumber: 'PO-1001', item: 'Resin', quantity: 3, totalCost: 30, stage: 'requisition' }],
    openValue: 30, overdueCount: 0,
  };

  function setup(role: 'planner' | 'analyst') {
    mockByAction({
      orgMine: { organizations: [{ ...ORG, myScRole: role, myRole: role === 'planner' ? 'leader' : 'apprentice' }] },
      orgMembers: role === 'planner' ? MEMBERS : { ...MEMBERS, members: [{ userId: 'me', role: 'apprentice', scRole: 'analyst' }], myRole: 'analyst', myOrgRole: 'apprentice' },
      shipmentList: SHIPMENTS,
      workOrderList: WORK_ORDERS,
      shipmentCheckpoint: {}, shipmentDelete: {}, workOrderAdvance: {}, workOrderDelete: {}, workOrderCreate: {}, shipmentCreate: {},
    });
  }

  it('a planner sees advance/delete on team entries and the shared-scope caption', async () => {
    setup('planner');
    render(<OrgCollabPanel />);
    await waitFor(() => expect(screen.getByText('TEAM-1')).toBeInTheDocument());
    expect(screen.getByText(/Shanghai → Los Angeles · in transit/)).toBeInTheDocument();
    expect(screen.getByLabelText('Advance TEAM-1')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete TEAM-1')).toBeInTheDocument();
    expect(screen.getByText(/PO-1001 · Resin ×3/)).toBeInTheDocument();
    expect(screen.getByLabelText('Advance PO-1001')).toBeInTheDocument();
    expect(screen.getByLabelText('Delete PO-1001')).toBeInTheDocument();
    expect(screen.getByText(/personal control-tower items stay in your own workspace/)).toBeInTheDocument();
  });

  it('advancing a team work order calls workOrderAdvance scoped to the org', async () => {
    setup('planner');
    render(<OrgCollabPanel />);
    await waitFor(() => screen.getByLabelText('Advance PO-1001'));
    fireEvent.click(screen.getByLabelText('Advance PO-1001'));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'workOrderAdvance');
      expect(call?.[2]).toMatchObject({ orgId: 'org_1', workOrderId: 'wo_1' });
    });
  });

  it('the team PO form sends the quantity and unit cost it collects', async () => {
    setup('planner');
    render(<OrgCollabPanel />);
    await waitFor(() => screen.getByPlaceholderText(/New PO item/i));
    fireEvent.change(screen.getByPlaceholderText(/New PO item/i), { target: { value: 'Resin' } });
    fireEvent.change(screen.getByPlaceholderText('Qty'), { target: { value: '4' } });
    fireEvent.change(screen.getByPlaceholderText('Unit cost'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Raise PO'));
    await waitFor(() => {
      const call = lensRunMock.mock.calls.find((c) => c[1] === 'workOrderCreate');
      expect(call?.[2]).toMatchObject({ orgId: 'org_1', item: 'Resin', quantity: 4, unitCost: 12 });
    });
  });

  it('an analyst sees the shared data but no write controls on team entries', async () => {
    setup('analyst');
    render(<OrgCollabPanel />);
    await waitFor(() => expect(screen.getByText('TEAM-1')).toBeInTheDocument());
    expect(screen.queryByLabelText('Advance TEAM-1')).toBeNull();
    expect(screen.queryByLabelText('Delete PO-1001')).toBeNull();
  });
});
