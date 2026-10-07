import { beforeEach, describe, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
const persist = vi.fn();
let restoredState: Record<string, unknown> | null = null;

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/lib/lens-state-persistence', () => ({
  useLensStatePersistence: () => ({ restore: () => restoredState, persist, clear: vi.fn() }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { username: 'ramaj' } }) }));
vi.mock('@/hooks/useRealtimeLens', () => ({
  useRealtimeLens: () => ({ latestData: null, isLive: false, lastUpdated: null, insights: [] }),
}));
vi.mock('@/hooks/useLensNav', () => ({ useLensNav: () => {} }));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/hooks/useLensIdentity', () => ({ useLensIdentity: () => {} }));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div data-testid="lens-shell">{children}</div>,
}));
vi.mock('@/components/lens/FirstRunTour', () => ({ FirstRunTour: () => null }));
vi.mock('@/components/lens/DepthBadge', () => ({ DepthBadge: () => null }));
vi.mock('@/components/lens/LiveIndicator', () => ({ LiveIndicator: () => <div data-testid="live-indicator" /> }));
vi.mock('@/components/lens/DTUExportButton', () => ({ DTUExportButton: () => <button>Export DTU</button> }));
vi.mock('@/components/lens/RealtimeDataPanel', () => ({ RealtimeDataPanel: () => <div data-testid="realtime-panel" /> }));
vi.mock('@/components/panel-polish', () => ({
  PipingProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/defense/CommonOperatingPicture', () => ({ CommonOperatingPicture: () => <div data-testid="cop" /> }));
vi.mock('@/components/defense/MissionPlanner', () => ({ MissionPlanner: () => <div data-testid="mission-planner" /> }));
vi.mock('@/components/defense/AssetReadiness', () => ({ AssetReadiness: () => <div data-testid="asset-readiness" /> }));
vi.mock('@/components/defense/ThreatBoard', () => ({ ThreatBoard: () => <div data-testid="threat-board" /> }));
vi.mock('@/components/defense/PersonnelRoster', () => ({ PersonnelRoster: () => <div data-testid="personnel-roster" /> }));
vi.mock('@/components/defense/LogisticsBoard', () => ({ LogisticsBoard: () => <div data-testid="logistics-board" /> }));
vi.mock('@/components/defense/CommsLog', () => ({ CommsLog: () => <div data-testid="comms-log" /> }));
vi.mock('@/components/defense/ContractSearch', () => ({ ContractSearch: () => <div data-testid="contract-search" /> }));
vi.mock('@/components/defense/DefenseActionPanel', () => ({ DefenseActionPanel: () => <div data-testid="analysis-panel" /> }));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...props }: Record<string, unknown>) => <div {...props}>{children as React.ReactNode}</div> }),
}));
vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<HTMLSpanElement, Record<string, unknown>>((props, ref) => <span data-testid={`icon-${name}`} ref={ref} {...props} />);
    Icon.displayName = name;
    return Icon;
  };
  return new Proxy(actual, {
    get: (target, prop: string) => (prop in target ? make(prop) : (target as Record<string, unknown>)[prop]),
  });
});

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

function openBrief() {
  fireEvent.click(screen.getByRole('button', { name: 'Open a brief' }));
}

beforeEach(() => {
  lensRun.mockReset();
  persist.mockReset();
  restoredState = null;
});

describe('defense lens — one brief architecture', () => {
  it('starts at the north-star empty brief and opens the real overview on one action', async () => {
    mockRollupsOk();
    render(<DefenseLensPage />);

    expect(screen.getByRole('heading', { name: 'The brief, Ramaj' })).toBeInTheDocument();
    expect(screen.getByText('No brief open.')).toBeInTheDocument();
    expect(lensRun).not.toHaveBeenCalled();

    openBrief();
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('defense', 'asset-rollup', {}));
    expect(persist).toHaveBeenCalledWith({ opened: true, tool: 'overview' });
  });

  it('restores one persisted tool instead of creating another navigation state machine', () => {
    restoredState = { opened: true, tool: 'communications' };
    mockRollupsOk();
    render(<DefenseLensPage />);
    expect(screen.getByTestId('comms-log')).toBeInTheDocument();
    expect(screen.queryByText('No brief open.')).not.toBeInTheDocument();
  });

  it('keeps every surviving product panel behind the one brief tool rail', async () => {
    mockRollupsOk();
    render(<DefenseLensPage />);
    openBrief();
    await waitFor(() => expect(screen.getByText('Fleet Readiness')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Map/ }));
    expect(screen.getByTestId('cop')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Missions/ }));
    expect(screen.getByTestId('mission-planner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Contracts/ }));
    expect(screen.getByTestId('contract-search')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Live feed/ }));
    expect(screen.getByTestId('realtime-panel')).toBeInTheDocument();
  });
});

describe('defense brief overview — honest rollup states', () => {
  it('shows loading while all four real rollups are in flight', async () => {
    lensRun.mockImplementation(() => new Promise(() => {}));
    render(<DefenseLensPage />);
    openBrief();
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });

  it('shows a retryable error when every rollup fails', async () => {
    let fail = true;
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (fail) return reply({}, false);
      if (action === 'asset-rollup') return reply(ASSET_ROLLUP);
      if (action === 'threat-board') return reply(THREAT_BOARD);
      if (action === 'personnel-roster') return reply(PERSONNEL_ROSTER);
      if (action === 'supply-board') return reply(SUPPLY_BOARD);
      return reply({});
    });
    render(<DefenseLensPage />);
    openBrief();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    fail = false;
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('78.0%')).toBeInTheDocument());
  });

  it('renders backend rollup values rather than invented dashboard metrics', async () => {
    mockRollupsOk();
    render(<DefenseLensPage />);
    openBrief();
    await waitFor(() => expect(screen.getByText('78.0%')).toBeInTheDocument());
    expect(screen.getByText(/83% available/)).toBeInTheDocument();
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('9').length).toBeGreaterThan(0);
  });
});

describe('defense brief analysis', () => {
  it('labels allocation as transient and runs the real optimizer', async () => {
    mockRollupsOk();
    lensRun.mockImplementation((_domain: string, action: string) => {
      if (action === 'resourceAllocation') {
        return reply({
          totalResources: 1,
          totalMissions: 1,
          availableAfter: 0,
          fullyStaffed: 1,
          understaffed: 0,
          allocations: [{ mission: 'Secure Bridgehead', priority: 'critical', resourcesNeeded: 1, resourcesAssigned: 1, status: 'fully-allocated' }],
        });
      }
      if (action === 'asset-rollup') return reply(ASSET_ROLLUP);
      if (action === 'threat-board') return reply(THREAT_BOARD);
      if (action === 'personnel-roster') return reply(PERSONNEL_ROSTER);
      if (action === 'supply-board') return reply(SUPPLY_BOARD);
      return reply({});
    });

    render(<DefenseLensPage />);
    openBrief();
    fireEvent.click(screen.getByRole('button', { name: /Analysis/ }));
    expect(screen.getByText(/Inputs remain transient/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Fireteam Alpha/i), { target: { value: 'Fireteam Alpha' } });
    fireEvent.click(screen.getByLabelText('Add resource unit'));
    fireEvent.change(screen.getByPlaceholderText('Mission name'), { target: { value: 'Secure Bridgehead' } });
    fireEvent.click(screen.getByLabelText('Add mission'));
    await act(async () => { fireEvent.click(screen.getByText('Run Allocation')); });

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('defense', 'resourceAllocation', expect.any(Object)));
    await waitFor(() => expect(screen.getByText('Fully allocated')).toBeInTheDocument());
  });
});
