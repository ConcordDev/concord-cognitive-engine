import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

// LensShell wraps children in an a11y context provider that registers with a
// UI store; stub it to a plain pass-through so the page renders in isolation.
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: React.PropsWithChildren) => React.createElement('div', null, children),
}));

// The inspector panel does its own `garage.get` lensRun call on mount; stub
// it — these tests exercise the fleet-browser page's own four UX states +
// spawn flow, not the inspector's independent fetch.
vi.mock('@/components/garage/VehicleInspectorPanel', () => ({
  VehicleInspectorPanel: ({ vehicleId }: { vehicleId: string }) =>
    React.createElement('div', { 'data-testid': 'inspector' }, vehicleId),
}));

// Auth-gated (Sign in to spawn / My fleet tab); default to signed-in so the
// spawn flow is exercisable, per-test overridable via mockReturnValue.
const useAuthMock = vi.fn();
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => useAuthMock(),
}));

// useMacroDispatchFeedback (spawn) best-effort connects the realtime socket
// for a live 'running' status — stub the channel so no real socket.io
// connection is attempted under jsdom (same convention as
// tests/lenses/achievements-page.test.tsx).
vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
  connectSocket: vi.fn(),
}));

// The rebuild (Frontend Rebuild Program) moved list/mine/spawn off raw REST
// `fetch` onto the real macro channel — `lensRun('garage', 'list' | 'mine' |
// 'spawn', input)` → POST /api/lens/run, answered by server/domains/garage.js
// (see the capability-map comment at the top of app/lenses/garage/page.tsx).
// Mock that channel directly (see tests/detective-lens-states.test.tsx for
// the same convention).
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import GarageLensPage from '@/app/lenses/garage/page';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function err(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

const VEHICLES = [
  { id: 'veh_a', world_id: 'concordia-hub', kind: 'cart', owner_kind: 'player', owner_id: 'driver1', capacity: 4, fare_cc: 0, pos_x: 5, pos_z: 3 },
  { id: 'veh_b', world_id: 'concordia-hub', kind: 'boat', owner_kind: 'none', capacity: 6, fare_cc: 0 },
];

/** Wires list/mine/spawn with sensible defaults, overridable per test. */
function wireLensRun(overrides: Partial<Record<'list' | 'mine' | 'spawn', () => Promise<unknown>>> = {}) {
  lensRunMock.mockImplementation((domain: string, action: string) => {
    if (domain !== 'garage') return ok({});
    if (action === 'list') return (overrides.list ?? (() => ok({ worldId: 'concordia-hub', vehicles: VEHICLES })))();
    if (action === 'mine') return (overrides.mine ?? (() => ok({ worldId: 'concordia-hub', vehicles: [] })))();
    if (action === 'spawn') return (overrides.spawn ?? (() => ok({ vehicleId: 'veh_new', kind: 'cart', capacity: 4, fare_cc: 0 })))();
    return ok({});
  });
}

describe('GarageLensPage — four UX states', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    useAuthMock.mockReset();
    useAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
    window.localStorage.setItem('concordia:activeWorldId', 'concordia-hub');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('LOADING: shows a busy status before the macro dispatch resolves', async () => {
    lensRunMock.mockImplementation(() => new Promise(() => {}));
    render(React.createElement(GarageLensPage));
    expect(await screen.findByText('Loading')).toBeInTheDocument();
  });

  it('POPULATED: renders the real vehicle list', async () => {
    wireLensRun();
    render(React.createElement(GarageLensPage));
    await screen.findByText('player:driver1');
    expect(screen.getByText('none')).toBeInTheDocument();
    // The row renders the live position from the persisted vehicle.
    expect(screen.getByText('(5, 3)')).toBeInTheDocument();
    // Two data rows for two vehicles (role="row" also includes the header row).
    expect(screen.getAllByRole('row')).toHaveLength(3);
  });

  it('EMPTY: honest empty state when the world has no vehicles', async () => {
    wireLensRun({ list: () => ok({ worldId: 'concordia-hub', vehicles: [] }) });
    render(React.createElement(GarageLensPage));
    expect(await screen.findByText(/no vehicles in this world yet/i)).toBeInTheDocument();
  });

  it('ERROR: surfaces an honest error with a working retry', async () => {
    let attempt = 0;
    wireLensRun({
      list: () => {
        attempt += 1;
        return attempt === 1 ? err('HTTP 500') : ok({ worldId: 'concordia-hub', vehicles: VEHICLES });
      },
    });
    render(React.createElement(GarageLensPage));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn.t load garage data/i);
    // Retry recovers into the populated state.
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('player:driver1')).toBeInTheDocument());
  });

  it('SPAWN: only offers the real free-spawn archetypes (no fabricated kinds)', async () => {
    wireLensRun({ list: () => ok({ worldId: 'concordia-hub', vehicles: [] }) });
    render(React.createElement(GarageLensPage));
    const spawnSelect = await screen.findByLabelText(/spawn a vehicle/i);
    const opts = Array.from(spawnSelect.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(opts).toEqual(['cart', 'boat']);
    // No fabricated kinds anywhere on the page.
    expect(screen.queryByText('horse')).not.toBeInTheDocument();
    expect(screen.queryByText('glider')).not.toBeInTheDocument();
  });

  it('SPAWN dispatches a player-owned vehicle then refreshes into My fleet', async () => {
    let spawned = false;
    wireLensRun({
      list: () => ok({ worldId: 'concordia-hub', vehicles: spawned ? VEHICLES : [] }),
      mine: () => ok({ worldId: 'concordia-hub', vehicles: spawned ? VEHICLES : [] }),
      spawn: () => { spawned = true; return ok({ vehicleId: 'veh_new', kind: 'cart', capacity: 4, fare_cc: 0 }); },
    });
    render(React.createElement(GarageLensPage));
    await screen.findByText(/no vehicles in this world yet/i);

    fireEvent.click(screen.getByRole('button', { name: /^spawn$/i }));

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('garage', 'spawn', expect.objectContaining({ kind: 'cart', ownerKind: 'player' }), expect.anything()),
    );
    // Spawn success flips to the "My fleet" tab and refreshes both fleets.
    await waitFor(() => expect(screen.getByText('player:driver1')).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /my fleet/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('unauthenticated: My fleet tab shows an honest sign-in prompt, spawn is disabled', async () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false });
    wireLensRun();
    render(React.createElement(GarageLensPage));
    await screen.findByText('player:driver1');

    fireEvent.click(screen.getByRole('tab', { name: /my fleet/i }));
    expect(await screen.findByText(/sign in to see your fleet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^spawn$/i })).toBeDisabled();
  });
});
