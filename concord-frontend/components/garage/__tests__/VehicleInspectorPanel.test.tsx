/**
 * VehicleInspectorPanel — pins for the garage build's shipped surfaces:
 * F2 (despawn: the lifecycle exit R4's pass found absent everywhere)
 * and F3 (one owner rendering: the inspector reads the account's
 * display identity, never a raw id fragment). The panel is exercised
 * through the real useMacroDispatchFeedback dispatch path with the
 * api client mocked at the lensRun seam; the realtime side-channel
 * the hook also listens to is stubbed (it carries lifecycle echoes,
 * never the result).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VehicleInspectorPanel } from '../VehicleInspectorPanel';

const hoisted = vi.hoisted(() => ({
  vehicle: null as null | Record<string, unknown>,
  calls: [] as Array<{ domain: string; action: string; input: Record<string, unknown> }>,
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: async (domain: string, action: string, input: Record<string, unknown>) => {
    hoisted.calls.push({ domain, action, input });
    if (action === 'get') {
      return { data: { ok: true, result: { vehicle: hoisted.vehicle, occupants: 0 } } };
    }
    if (action === 'despawn') {
      return { data: { ok: true, result: { action: 'despawned', vehicleId: input.vehicleId } } };
    }
    return { data: { ok: true, result: {} } };
  },
}));

vi.mock('@/lib/realtime/socket', () => ({
  subscribe: () => () => {},
  connectSocket: () => {},
}));

const OWN_VEHICLE = {
  id: 'veh_test_own_1', world_id: 'concordia-hub', kind: 'cart', owner_kind: 'player',
  owner_id: 'fleet-owner-9f2c', ownerDisplay: 'Fleet Owner', isMine: true,
  capacity: 4, fare_cc: 0, pos_x: 0, pos_y: 0, pos_z: 0, heading: 0, condition_pct: 100,
};
const OTHER_VEHICLE = {
  id: 'veh_test_other_1', world_id: 'concordia-hub', kind: 'boat', owner_kind: 'player',
  isMine: false, capacity: 6, fare_cc: 0, pos_x: 0, pos_y: 0, pos_z: 0, heading: 0, condition_pct: 88,
};

describe('VehicleInspectorPanel — F2/F3 surfaces', () => {
  beforeEach(() => {
    hoisted.calls = [];
    vi.stubGlobal('confirm', () => true);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('an own vehicle renders the display identity and the Despawn control (F2/F3)', async () => {
    hoisted.vehicle = OWN_VEHICLE;
    render(<VehicleInspectorPanel vehicleId={OWN_VEHICLE.id} onClose={() => {}} />);
    expect(await screen.findByText('Fleet Owner')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Despawn vehicle/ })).toBeTruthy();
    expect(screen.queryByText(/fleet-owner/)).toBeNull();
  });

  it('confirming Despawn dispatches garage.despawn and reconciles via onDespawned (F2)', async () => {
    hoisted.vehicle = OWN_VEHICLE;
    const onDespawned = vi.fn();
    render(<VehicleInspectorPanel vehicleId={OWN_VEHICLE.id} onClose={() => {}} onDespawned={onDespawned} />);
    fireEvent.click(await screen.findByRole('button', { name: /Despawn vehicle/ }));
    await waitFor(() => expect(onDespawned).toHaveBeenCalledWith(OWN_VEHICLE.id));
    const despawnCall = hoisted.calls.find((c) => c.action === 'despawn');
    expect(despawnCall?.domain).toBe('garage');
    expect(despawnCall?.input).toEqual({ vehicleId: OWN_VEHICLE.id });
  });

  it("another player's vehicle shows no Despawn control and no owner identity (F2/F3)", async () => {
    hoisted.vehicle = OTHER_VEHICLE;
    render(<VehicleInspectorPanel vehicleId={OTHER_VEHICLE.id} onClose={() => {}} />);
    expect(await screen.findByText('player')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Despawn/ })).toBeNull();
  });
});
