import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-garage-001: the vehicle inspector shows the name +
// spec and, for the owner's own vehicle, edits them via garage.update.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));
vi.mock('@/hooks/useMacroDispatchFeedback', () => ({
  useMacroDispatchFeedback: () => ({ dispatch: vi.fn(), status: 'idle', error: null, result: null }),
}));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { VehicleInspectorPanel } from '@/components/garage/VehicleInspectorPanel';

const VEHICLE = {
  id: 'veh_1', world_id: 'concordia-hub', kind: 'cart', name: '', spec: '',
  owner_kind: 'player', owner_id: 'u1', isMine: true, capacity: 2, fare_cc: 0,
  route_id: null, pos_x: 0, pos_y: 0, pos_z: 0, heading: 0, condition_pct: 100,
};

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

beforeEach(() => { lensRun.mockReset(); });

describe('VehicleInspectorPanel — edit own vehicle (FIX-garage-001)', () => {
  it('an unnamed vehicle reads as unnamed; Edit saves name/spec/capacity via garage.update', async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'get') return ok({ vehicle: VEHICLE, occupants: 0 });
      if (action === 'update') return ok({ vehicle: { ...VEHICLE, name: 'Old Reliable', spec: 'Oak bed', capacity: 4 } });
      return ok({});
    });
    render(<VehicleInspectorPanel vehicleId="veh_1" onClose={() => {}} />);
    expect(await screen.findByText('unnamed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Edit vehicle/ }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Old Reliable' } });
    fireEvent.change(screen.getByLabelText('Spec'), { target: { value: 'Oak bed' } });
    fireEvent.change(screen.getByLabelText('Capacity (seats)'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('update')).toHaveLength(1));
    expect(calls('update')[0][2]).toMatchObject({ vehicleId: 'veh_1', name: 'Old Reliable', spec: 'Oak bed', capacity: 4 });
    expect(await screen.findByText('Old Reliable')).toBeInTheDocument();
  });

  it("a stranger's vehicle shows no Edit control", async () => {
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'get') return ok({ vehicle: { ...VEHICLE, isMine: false, name: 'Theirs' }, occupants: 0 });
      return ok({});
    });
    render(<VehicleInspectorPanel vehicleId="veh_1" onClose={() => {}} />);
    expect(await screen.findByText('Theirs')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit vehicle/ })).not.toBeInTheDocument();
  });
});
