/**
 * /lenses/emergency-services — four-UX-state contract.
 *
 * Rewritten for the Frontend Rebuild Program pass (see
 * `docs/lens-specs/emergency-services-capability-map.md`): the page no
 * longer runs on a disconnected generic-CRUD artifact store
 * (`useLensData('emergency-services', 'Call'|'Unit'|'FireIncident'|…)`) —
 * two of those type strings never matched any registered backend macro, and
 * the Dashboard's "Avg Response: 4.2m" tile was a literal hardcoded string
 * with no computation behind it. Both are gone. The Dashboard tab is now
 * `EmsOverviewPanel`, wiring the real `ems-dashboard` + `readiness-rollup`
 * macros into honest KPI tiles, and the CAD Console / Quick Actions /
 * Seismic Feed tabs are all real, pre-existing panels now reachable from
 * the tab nav (they used to be bolted below it, unreachable).
 *
 * This closes the swallowed-fetch → silent-empty defect for a
 * SAFETY-relevant lens: a failed CAD summary must surface the error + a
 * working retry, NOT a blank/fabricated page that hides an outage from a
 * dispatcher. No fabricated data: every state is driven by a mocked
 * `lensRun` standing in for the real backend, returning exactly the shapes
 * `server/domains/emergencyservices.js` returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the real backend channel for EmsOverviewPanel ────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

// ── headless chrome: render-only / inert stubs ──────────────────────────────
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/components/lens/RecentMineCard', () => ({ RecentMineCard: () => null }));
vi.mock('@/components/lens/AutoActionStrip', () => ({ AutoActionStrip: () => null }));
vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
// Pre-existing, real, macro-wired panels this rebuild didn't touch (their own
// behavior/macros are out of scope here) — inert stubs let this test assert
// on tab routing (they're now reachable from the tab nav) without
// re-testing their internals.
vi.mock('@/components/emergency-services/QuakeFeed', () => ({ QuakeFeed: () => React.createElement('div', { 'data-testid': 'quake-feed' }) }));
vi.mock('@/components/emergency-services/CADConsole', () => ({ CADConsole: () => React.createElement('div', { 'data-testid': 'cad-console' }) }));
vi.mock('@/components/emergency-services/EmergencyServicesActionPanel', () => ({ EmergencyServicesActionPanel: () => React.createElement('div', { 'data-testid': 'ems-action-panel' }) }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  usePipe: () => ({ publish: vi.fn() }),
  useRecallableAction: () => ({ run: vi.fn() }),
  RecallSlot: () => null,
}));
// framer-motion: render plain elements so animated nodes mount synchronously.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
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

// EmsOverviewPanel is NOT mocked — it's the real, newly-added Dashboard
// component this rebuild pass is responsible for, and the object of this test.
import EmergencyServicesLensPage from '@/app/lenses/emergency-services/page';

function reply(result: Record<string, unknown>, ok = true, error = 'CAD store offline') {
  return Promise.resolve({ data: { ok, result, error: ok ? undefined : error } });
}

const EMS_DASHBOARD = {
  incidents: 8,
  openIncidents: 3,
  units: 6,
  availableUnits: 4,
  byKind: { medical: 5, fire: 2, hazmat: 1 },
};
const READINESS_ROLLUP = {
  totalUnits: 6, available: 4, committed: 1, outOfService: 1, readinessPct: 67,
  status: 'operational', byStatus: {}, byKind: {}, kindCoverageGaps: ['hazmat'],
};

function mockDashboardOk() {
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'ems-dashboard') return reply(EMS_DASHBOARD);
    if (action === 'readiness-rollup') return reply(READINESS_ROLLUP);
    return reply({});
  });
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('emergency-services lens — Dashboard four UX states (EmsOverviewPanel)', () => {
  it('WIRING: the dashboard calls lensRun on the emergency-services domain', async () => {
    mockDashboardOk();
    render(<EmergencyServicesLensPage />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('emergency-services', 'ems-dashboard', {}));
    expect(lensRun).toHaveBeenCalledWith('emergency-services', 'readiness-rollup', {});
  });

  it('LOADING: shows a role=status indicator while the summary is in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { container } = render(<EmergencyServicesLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('ERROR: a failed ems-dashboard call shows role=alert + a working Retry that re-fetches (not a silent fabricated page)', async () => {
    let fail = true;
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'ems-dashboard') return fail ? reply({}, false) : reply(EMS_DASHBOARD);
      if (action === 'readiness-rollup') return reply(READINESS_ROLLUP);
      return reply({});
    });
    const { container, getByText } = render(<EmergencyServicesLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText('CAD store offline')).toBeInTheDocument();

    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(getByText('Open Incidents')).toBeInTheDocument());
  });

  it('POPULATED: renders the real ops-summary counts (not the old fabricated "4.2m" stat)', async () => {
    mockDashboardOk();
    const { getByText, queryByText } = render(<EmergencyServicesLensPage />);
    await waitFor(() => expect(getByText('3')).toBeInTheDocument()); // openIncidents
    expect(getByText('of 8 total')).toBeInTheDocument();
    expect(getByText('4')).toBeInTheDocument(); // availableUnits
    expect(getByText('67%')).toBeInTheDocument(); // readinessPct via StatTile
    expect(getByText(/No available unit of type: hazmat/)).toBeInTheDocument();
    // the old literal fabricated stat must never come back.
    expect(queryByText('4.2m')).toBeNull();
  });
});

describe('emergency-services lens — tab navigation mounts real panels', () => {
  it('CAD Console / Quick Actions / Seismic Feed are all reachable from the tab nav', async () => {
    mockDashboardOk();
    const { getByText, getByTestId, queryByTestId } = render(<EmergencyServicesLensPage />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());

    fireEvent.click(getByText('CAD Console'));
    expect(getByTestId('cad-console')).toBeInTheDocument();
    expect(queryByTestId('quake-feed')).toBeNull();

    fireEvent.click(getByText('Quick Actions'));
    expect(getByTestId('ems-action-panel')).toBeInTheDocument();

    fireEvent.click(getByText('Seismic Feed'));
    expect(getByTestId('quake-feed')).toBeInTheDocument();
  });
});
