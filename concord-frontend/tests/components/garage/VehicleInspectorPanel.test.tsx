import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

// garage.{get,despawn} via the real macro channel — mock the channel
// directly, same convention as tests/lenses/garage-page.test.tsx.
const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: vi.fn(() => () => {}),
  connectSocket: vi.fn(),
}));

import { VehicleInspectorPanel } from '@/components/garage/VehicleInspectorPanel';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}
function err(message: string) {
  return Promise.resolve({ data: { ok: false, result: null, error: message } });
}

const MINE_VEHICLE = {
  id: 'veh_a', world_id: 'concordia-hub', kind: 'cart', owner_kind: 'player',
  owner_id: 'driver1', ownerDisplay: 'Driver One', isMine: true,
  capacity: 4, fare_cc: 0, pos_x: 5, pos_z: 3, heading: 90, condition_pct: 80,
};

const OTHER_VEHICLE = {
  id: 'veh_b', world_id: 'concordia-hub', kind: 'boat', owner_kind: 'player',
  isMine: false, capacity: 6, fare_cc: 2, pos_x: 0, pos_z: 0,
};

describe('VehicleInspectorPanel', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
    window.confirm = vi.fn(() => true);
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('F3: renders the resolved display identity instead of a raw owner_id for the owner\u2019s own vehicle', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'garage' && action === 'get') return ok({ vehicle: MINE_VEHICLE, occupants: 0 });
      return ok({});
    });
    render(React.createElement(VehicleInspectorPanel, { vehicleId: 'veh_a', onClose: vi.fn() }));
    expect(await screen.findByText('Driver One')).toBeInTheDocument();
    expect(screen.queryByText(/driver1/)).not.toBeInTheDocument();
  });

  it('falls back to the owner_kind label when no ownerDisplay is stamped (non-owner view)', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'garage' && action === 'get') return ok({ vehicle: OTHER_VEHICLE, occupants: 1 });
      return ok({});
    });
    render(React.createElement(VehicleInspectorPanel, { vehicleId: 'veh_b', onClose: vi.fn() }));
    expect(await screen.findByText('player')).toBeInTheDocument();
    // No despawn control for a vehicle that isn't the caller's own.
    expect(screen.queryByRole('button', { name: /despawn vehicle/i })).not.toBeInTheDocument();
  });

  it('F2: the owner sees a despawn control; confirming calls garage.despawn and reports it up', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'garage' && action === 'get') return ok({ vehicle: MINE_VEHICLE, occupants: 0 });
      if (domain === 'garage' && action === 'despawn') return ok({ action: 'despawned', vehicleId: 'veh_a' });
      return ok({});
    });
    const onClose = vi.fn();
    const onDespawned = vi.fn();
    render(React.createElement(VehicleInspectorPanel, { vehicleId: 'veh_a', onClose, onDespawned }));

    const btn = await screen.findByRole('button', { name: /despawn vehicle/i });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(lensRunMock).toHaveBeenCalledWith('garage', 'despawn', { vehicleId: 'veh_a' }, expect.anything()),
    );
    // Only reports the removal up (and closes) once the real response confirms it.
    await waitFor(() => expect(onDespawned).toHaveBeenCalledWith('veh_a'));
    expect(onClose).toHaveBeenCalled();
  });

  it('F2: a failed despawn (e.g. not_authorized) leaves the vehicle in place and shows the real error', async () => {
    lensRunMock.mockImplementation((domain: string, action: string) => {
      if (domain === 'garage' && action === 'get') return ok({ vehicle: MINE_VEHICLE, occupants: 0 });
      if (domain === 'garage' && action === 'despawn') return err('not_authorized');
      return ok({});
    });
    const onClose = vi.fn();
    const onDespawned = vi.fn();
    render(React.createElement(VehicleInspectorPanel, { vehicleId: 'veh_a', onClose, onDespawned }));

    const btn = await screen.findByRole('button', { name: /despawn vehicle/i });
    fireEvent.click(btn);

    expect(await screen.findByText(/not_authorized/i)).toBeInTheDocument();
    expect(onDespawned).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
