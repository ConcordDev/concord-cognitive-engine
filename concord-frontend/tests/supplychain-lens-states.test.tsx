/**
 * /lenses/supplychain — four-UX-state contract for the Supply Chain
 * Control Tower lens (Frontend Rebuild Program, Wave 2 rebuild).
 *
 * The rebuild retired a generic multi-artifact-type CRUD library
 * (PurchaseOrder/Supplier/InventoryItem/... backed by fabricated DTU
 * artifacts unrelated to the real `supplychain` macros) that used to be
 * this lens's PRIMARY surface. This test file previously pinned that
 * generic library's four UX states; it now pins the same four states
 * against the REAL surface that replaced it — `SupplyChainOverview`, the
 * default "Overview" destination, which aggregates four live macro calls
 * (shipmentList / networkGraph / workOrderList / exceptionScan) via
 * `lensRun('supplychain', ...)`.
 *
 * a11y: loading is role=status, error is role=alert (with the real error
 * message surfaced, not swallowed), empty is a real `EmptyState` CTA that
 * jumps to the Control Tower destination, populated renders real KPI tile
 * values sourced from the mocked macro results. No fabricated data —
 * every state is driven by a mocked `lensRun` standing in for the real
 * backend in the exact shape it returns. The heavy Control Tower /
 * Scorecards / Industry Pulse children (SupplyChainPlanner /
 * SupplyChainActionPanel / SupplyChainFeed) carry their own macro coverage
 * in server/tests/supplychain-lens-macros.test.js and are inert here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

// ── the single real data channel this page depends on: lensRun ─────────────
type LensRunImpl = (domain: string, action: string, input?: unknown) => Promise<{ data: { ok: boolean; result?: unknown; error?: string } }>;
const lensRunMock = vi.fn<Parameters<LensRunImpl>, ReturnType<LensRunImpl>>();

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: null })), post: vi.fn(() => Promise.resolve({ data: {} })), delete: vi.fn(() => Promise.resolve({ data: {} })) },
  apiHelpers: { lens: { runDomain: vi.fn(() => Promise.resolve({ data: { ok: true, result: {} } })) } },
  lensRun: (...args: Parameters<LensRunImpl>) => lensRunMock(...args),
  isForbidden: () => false,
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// ── headless chrome + heavy destination panels: render-only / inert stubs ──
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
// heavy supplychain children (their own backend macros are covered by the
// supplychain server test) → inert here; the Overview destination (default
// on mount) is the one under test.
vi.mock('@/components/supplychain/SupplyChainFeed', () => ({ SupplyChainFeed: () => null }));
vi.mock('@/components/supplychain/SupplyChainActionPanel', () => ({ SupplyChainActionPanel: () => null }));
vi.mock('@/components/supplychain/SupplyChainPlanner', () => ({ SupplyChainPlanner: () => null }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }));
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

import SupplyChainLensPage from '@/app/lenses/supplychain/page';

function neverResolves() {
  return new Promise<never>(() => {});
}

const EMPTY_RESULTS: Record<string, unknown> = {
  shipmentList: { shipments: [], inTransit: 0, delivered: 0, delayed: 0 },
  networkGraph: { counts: { supplier: 0, factory: 0, warehouse: 0, customer: 0 }, edgeCount: 0, criticalLeadTime: 0 },
  workOrderList: { openValue: 0, overdueCount: 0, workOrders: [] },
  exceptionScan: { critical: 0, warning: 0, alerts: [] },
};

const POPULATED_RESULTS: Record<string, unknown> = {
  shipmentList: { shipments: [{ id: 's1' }, { id: 's2' }, { id: 's3' }], inTransit: 3, delivered: 1, delayed: 1 },
  networkGraph: { counts: { supplier: 1, factory: 0, warehouse: 1, customer: 1 }, edgeCount: 2, criticalLeadTime: 14 },
  workOrderList: { openValue: 500, overdueCount: 1, workOrders: [{ id: 'wo1' }] },
  exceptionScan: { critical: 1, warning: 2, alerts: [{ id: 'a1', severity: 'critical', kind: 'late_shipment', message: 'Shipment SHP-1 is 6d late', detail: 'carrier DHL' }] },
};

function mockResolveWith(results: Record<string, unknown>) {
  lensRunMock.mockImplementation((_domain, action) =>
    Promise.resolve({ data: { ok: true, result: results[action] } }));
}

beforeEach(() => {
  lensRunMock.mockReset();
});

describe('supplychain lens — four UX states (Control Tower Overview)', () => {
  it('WIRING: the overview dispatches real macros on the supplychain domain', async () => {
    mockResolveWith(EMPTY_RESULTS);
    render(<SupplyChainLensPage />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    const domains = lensRunMock.mock.calls.map((c) => c[0]);
    expect(domains.every((d) => d === 'supplychain')).toBe(true);
    const actions = lensRunMock.mock.calls.map((c) => c[1]);
    expect(actions).toEqual(expect.arrayContaining(['shipmentList', 'networkGraph', 'workOrderList', 'exceptionScan']));
  });

  it('LOADING: an in-flight overview shows a role=status indicator', async () => {
    lensRunMock.mockImplementation(() => neverResolves());
    const { container } = render(<SupplyChainLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('EMPTY: an empty control tower shows the honest empty-state CTA (not fabricated data)', async () => {
    mockResolveWith(EMPTY_RESULTS);
    const { getByText, getAllByText } = render(<SupplyChainLensPage />);
    await waitFor(() => expect(getByText(/control tower is empty/i)).toBeInTheDocument());
    // the CTA is a real navigation affordance into the Control Tower destination
    // (it appears both in the empty-state CTA and the quick-link card below).
    expect(getAllByText(/Open Control Tower/i).length).toBeGreaterThan(0);
  });

  it('ERROR: a failed macro call shows role=alert with the real error (not a silent empty page)', async () => {
    lensRunMock.mockImplementation(() => Promise.reject(new Error('supplychain store offline')));
    const { container, getByText, queryByText } = render(<SupplyChainLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/supplychain store offline/i)).toBeInTheDocument();
    // a silent-empty page would show the empty-state CTA instead — it must NOT.
    expect(queryByText(/control tower is empty/i)).toBeNull();
  });

  it('POPULATED: real shipment/network/PO/exception counts render as KPI tiles', async () => {
    mockResolveWith(POPULATED_RESULTS);
    const { getByText, getAllByText } = render(<SupplyChainLensPage />);
    // Shipments-in-transit tile: real value 3 from the mocked shipmentList.
    await waitFor(() => expect(getAllByText('3').length).toBeGreaterThan(0));
    // Open PO value tile: real $500 from the mocked workOrderList.
    expect(getAllByText(/\$500/).length).toBeGreaterThan(0);
    // Live exceptions panel renders the real alert message.
    expect(getByText(/Shipment SHP-1 is 6d late/i)).toBeInTheDocument();
  });

  it('REFRESH: clicking Refresh re-dispatches all four macros and updates the "Updated" timestamp (real state change, not decorative)', async () => {
    mockResolveWith(EMPTY_RESULTS);
    const { getByText, getAllByText } = render(<SupplyChainLensPage />);
    await waitFor(() => expect(getByText(/control tower is empty/i)).toBeInTheDocument());
    const callsBeforeRefresh = lensRunMock.mock.calls.length;

    const POPULATED_AFTER_REFRESH: Record<string, unknown> = {
      shipmentList: { shipments: [{ id: 's1' }], inTransit: 1, delivered: 0, delayed: 0 },
      networkGraph: { counts: { supplier: 0, factory: 0, warehouse: 0, customer: 0 }, edgeCount: 0, criticalLeadTime: 0 },
      workOrderList: { openValue: 0, overdueCount: 0, workOrders: [] },
      exceptionScan: { critical: 0, warning: 0, alerts: [] },
    };
    mockResolveWith(POPULATED_AFTER_REFRESH);

    const refreshBtn = getAllByText(/^Refresh$/i)[0].closest('button') as HTMLButtonElement;
    expect(refreshBtn).toBeTruthy();
    await act(async () => { fireEvent.click(refreshBtn); });

    // A real second round of the same four macro calls fired (not a no-op).
    await waitFor(() => expect(lensRunMock.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeRefresh + 4));
    // The new data actually replaced the old — the shipments-in-transit tile
    // now shows the freshly-fetched value, proving refresh isn't decorative.
    await waitFor(() => expect(getAllByText('1').length).toBeGreaterThan(0));
    // "Updated" timestamp reflects the completed reload.
    expect(getAllByText(/Updated/i).length).toBeGreaterThan(0);
  });

  it('EXCEPTION FILTER: kind chips are grounded in the real byKind breakdown and narrow the visible alerts on click', async () => {
    const MULTI_KIND_RESULTS: Record<string, unknown> = {
      ...EMPTY_RESULTS,
      exceptionScan: {
        critical: 1, warning: 1,
        alerts: [
          { id: 'a1', severity: 'critical', kind: 'late_shipment', message: 'Shipment SHP-1 is 6d late', detail: 'carrier DHL' },
          { id: 'a2', severity: 'warning', kind: 'overdue_po', message: 'PO 1002 overdue at stage ordered', detail: 'widget' },
        ],
        byKind: { late_shipment: 1, overdue_po: 1 },
      },
    };
    mockResolveWith(MULTI_KIND_RESULTS);
    const { getByText, queryByText } = render(<SupplyChainLensPage />);
    await waitFor(() => expect(getByText(/Shipment SHP-1 is 6d late/i)).toBeInTheDocument());
    // Both alerts visible by default ("All" filter).
    expect(getByText(/PO 1002 overdue/i)).toBeInTheDocument();

    // Clicking the "late shipment" chip narrows to just that kind.
    const chip = getByText(/late shipment \(1\)/i);
    fireEvent.click(chip);
    await waitFor(() => expect(queryByText(/PO 1002 overdue/i)).toBeNull());
    expect(getByText(/Shipment SHP-1 is 6d late/i)).toBeInTheDocument();

    // Clicking the same chip again toggles the filter back off.
    fireEvent.click(chip);
    await waitFor(() => expect(getByText(/PO 1002 overdue/i)).toBeInTheDocument());
  });
});
