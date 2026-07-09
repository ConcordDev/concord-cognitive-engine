/**
 * /lenses/defense — four-UX-state contract for the Defense lens.
 *
 * Rewritten for the Frontend Rebuild Program pass (see
 * `docs/lens-specs/defense-capability-map.md`): the page no longer runs on
 * a disconnected generic-CRUD artifact store (`useLensData`/`useRunArtifact`
 * on fake `Operation`/`Asset`/`Personnel`/`Intel` types) — that surface was
 * genuinely fake (no backing macro) and has been removed. The Dashboard tab
 * is now `DashboardStats` (four real roll-up macros:
 * `asset-rollup`/`threat-board`/`personnel-roster`/`supply-board`) plus the
 * newly-surfaced `ResourceAllocationPanel` (`resourceAllocation`). This test
 * pins the honest four-UX-state contract against those real macro calls,
 * and pins that tab navigation mounts the right (pre-existing, real) panel.
 *
 * No fabricated data: every state is driven by a mocked `lensRun` standing
 * in for the real backend, returning exactly the shapes
 * `server/domains/defense.js` returns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act, screen } from '@testing-library/react';
import React from 'react';

// ── lensRun mock — the real backend channel for both new panels ─────────────
const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null, insights: [] }),
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
vi.mock('@/components/lens/ManifestActionBar', () => ({ ManifestActionBar: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => null }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => null }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => null }));
// Pre-existing, real, macro-wired panels this rebuild didn't touch — their own
// behavior is out of scope here (each owns its own macros/tests); inert stubs
// let this test assert on tab routing without re-testing their internals.
vi.mock('@/components/defense/ContractSearch', () => ({ ContractSearch: () => null }));
vi.mock('@/components/defense/DefenseActionPanel', () => ({ DefenseActionPanel: () => null }));
vi.mock('@/components/defense/CommonOperatingPicture', () => ({ CommonOperatingPicture: () => React.createElement('div', { 'data-testid': 'cop' }) }));
vi.mock('@/components/defense/MissionPlanner', () => ({ MissionPlanner: () => React.createElement('div', { 'data-testid': 'mission-planner' }) }));
vi.mock('@/components/defense/AssetReadiness', () => ({ AssetReadiness: () => React.createElement('div', { 'data-testid': 'asset-readiness' }) }));
vi.mock('@/components/defense/ThreatBoard', () => ({ ThreatBoard: () => React.createElement('div', { 'data-testid': 'threat-board' }) }));
vi.mock('@/components/defense/PersonnelRoster', () => ({ PersonnelRoster: () => React.createElement('div', { 'data-testid': 'personnel-roster' }) }));
vi.mock('@/components/defense/LogisticsBoard', () => ({ LogisticsBoard: () => React.createElement('div', { 'data-testid': 'logistics-board' }) }));
vi.mock('@/components/defense/CommsLog', () => ({ CommsLog: () => React.createElement('div', { 'data-testid': 'comms-log' }) }));
vi.mock('@/components/panel-polish', () => ({ PipingProvider: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children) }));
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

// DashboardStats and ResourceAllocationPanel are NOT mocked — they're the
// real, newly-added components this rebuild pass is responsible for, and
// the object of this test.
import DefenseLensPage from '@/app/lenses/defense/page';

function reply(result: Record<string, unknown>, ok = true) {
  return Promise.resolve({ data: { ok, result, error: ok ? undefined : 'defense readiness feed offline' } });
}

const ASSET_ROLLUP = { total: 12, fleetReadiness: 78, availabilityPct: 83, rollupStatus: 'green' };
const THREAT_BOARD = { total: 3, activeWatch: 2, highestSeverity: 'high' };
const PERSONNEL_ROSTER = { total: 40, deployable: 22, byAvailability: { deployed: 9, available: 22, transit: 5, leave: 3, unavailable: 1 } };
const SUPPLY_BOARD = { total: 6, openCount: 5, fulfillmentPct: 67 };

function mockRollupsOk() {
  lensRun.mockImplementation((_domain: string, action: string) => {
    if (action === 'asset-rollup') return reply(ASSET_ROLLUP);
    if (action === 'threat-board') return reply(THREAT_BOARD);
    if (action === 'personnel-roster') return reply(PERSONNEL_ROSTER);
    if (action === 'supply-board') return reply(SUPPLY_BOARD);
    return reply({});
  });
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('defense lens — Dashboard rollup four UX states (DashboardStats)', () => {
  it('WIRING: the dashboard calls lensRun on the defense domain for all four rollups', async () => {
    mockRollupsOk();
    render(<DefenseLensPage />);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('defense', 'asset-rollup', {}));
    expect(lensRun).toHaveBeenCalledWith('defense', 'threat-board', {});
    expect(lensRun).toHaveBeenCalledWith('defense', 'personnel-roster', {});
    expect(lensRun).toHaveBeenCalledWith('defense', 'supply-board', {});
  });

  it('LOADING: shows a role=status indicator while the rollups are in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {})); // never resolves
    const { container } = render(<DefenseLensPage />);
    await waitFor(() => expect(container.querySelector('[role="status"]')).toBeTruthy());
  });

  it('ERROR: every rollup failing shows role=alert + a working Retry that re-fetches', async () => {
    let fail = true;
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (fail) return reply({}, false);
      if (action === 'asset-rollup') return reply(ASSET_ROLLUP);
      if (action === 'threat-board') return reply(THREAT_BOARD);
      if (action === 'personnel-roster') return reply(PERSONNEL_ROSTER);
      if (action === 'supply-board') return reply(SUPPLY_BOARD);
      return reply({});
    });
    const { container, getByText } = render(<DefenseLensPage />);

    await waitFor(() => expect(container.querySelector('[role="alert"]')).toBeTruthy());
    expect(getByText(/defense readiness feed offline/i)).toBeInTheDocument();

    const before = lensRun.mock.calls.length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(getByText('78.0%')).toBeInTheDocument());
  });

  it('POPULATED: renders the real roll-up numbers (not a fabricated stat)', async () => {
    mockRollupsOk();
    const { getByText } = render(<DefenseLensPage />);
    await waitFor(() => expect(getByText('78.0%')).toBeInTheDocument()); // fleet readiness
    expect(getByText('2')).toBeInTheDocument(); // active threats
    expect(getByText('9')).toBeInTheDocument(); // personnel deployed
    expect(getByText(/83% available/)).toBeInTheDocument();
  });
});

describe('defense lens — Resource Allocation panel (resourceAllocation)', () => {
  it('stages a resource + a mission and runs the real allocation macro', async () => {
    mockRollupsOk();
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'resourceAllocation') {
        return reply({
          totalResources: 1,
          totalMissions: 1,
          availableAfter: 0,
          fullyStaffed: 1,
          understaffed: 0,
          allocations: [
            { mission: 'Secure Bridgehead', priority: 'critical', resourcesNeeded: 1, resourcesAssigned: 1, status: 'fully-allocated' },
          ],
        });
      }
      if (action === 'asset-rollup') return reply(ASSET_ROLLUP);
      if (action === 'threat-board') return reply(THREAT_BOARD);
      if (action === 'personnel-roster') return reply(PERSONNEL_ROSTER);
      if (action === 'supply-board') return reply(SUPPLY_BOARD);
      return reply({});
    });

    render(<DefenseLensPage />);
    await waitFor(() => expect(screen.getByText('Resource Allocation')).toBeInTheDocument());

    // Stage one resource unit + one mission — the panel starts empty by
    // design (no seeded rows) and only enables "Run Allocation" once both
    // sides have at least one entry.
    const resourceInput = screen.getByPlaceholderText(/Fireteam Alpha/i);
    fireEvent.change(resourceInput, { target: { value: 'Fireteam Alpha' } });
    fireEvent.click(screen.getByLabelText('Add resource unit'));

    const missionInput = screen.getByPlaceholderText('Mission name');
    fireEvent.change(missionInput, { target: { value: 'Secure Bridgehead' } });
    fireEvent.click(screen.getByLabelText('Add mission'));

    const runButton = screen.getByText('Run Allocation');
    await act(async () => { fireEvent.click(runButton); });

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('defense', 'resourceAllocation', expect.any(Object)));
    await waitFor(() => expect(screen.getByText('Fully allocated')).toBeInTheDocument());
  });
});

describe('defense lens — tab navigation mounts real panels', () => {
  it('Operations tab mounts MissionPlanner; Logistics tab mounts LogisticsBoard', async () => {
    mockRollupsOk();
    const { getByText, getByTestId, queryByTestId } = render(<DefenseLensPage />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());

    fireEvent.click(getByText('Operations'));
    expect(getByTestId('mission-planner')).toBeInTheDocument();
    expect(queryByTestId('logistics-board')).toBeNull();

    fireEvent.click(getByText('Logistics'));
    expect(getByTestId('logistics-board')).toBeInTheDocument();
  });
});
