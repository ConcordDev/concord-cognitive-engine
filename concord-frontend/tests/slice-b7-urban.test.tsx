import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — FIX-urban-planning-003: parcels and scenarios gain edit
// forms over the new parcel-update / scenario-update verbs.

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  api: { post: vi.fn(), delete: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));
vi.mock('@/components/urban-planning/CityMap', () => ({ CityMap: () => null }));

import { ParcelManager } from '@/components/urban-planning/ParcelManager';
import { ScenarioStudio } from '@/components/urban-planning/ScenarioStudio';

function ok(result: unknown = {}) {
  return Promise.resolve({ data: { ok: true, result } });
}
function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

beforeEach(() => { lensRun.mockReset(); });

describe('urban-planning edit controls (FIX-urban-planning-003)', () => {
  it('a parcel edits its address + lot size via parcel-update', async () => {
    const parcel = { id: 'parcel_1', apn: '123-45', address: '1 Main St', zoneType: 'residential', lotSizeSqFt: 4000, lat: null, lng: null, owner: '', district: '' };
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'parcel-list') return ok({ parcels: [parcel] });
      return ok();
    });
    render(<ParcelManager />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit parcel 123-45' }));
    const addr = await screen.findByLabelText('Edit parcel address') as HTMLInputElement;
    expect(addr.value).toBe('1 Main St');
    fireEvent.change(addr, { target: { value: '2 Main St' } });
    fireEvent.change(screen.getByLabelText('Edit parcel lot size'), { target: { value: '6500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('parcel-update')).toHaveLength(1));
    expect(calls('parcel-update')[0][2]).toMatchObject({ id: 'parcel_1', address: '2 Main St', lotSizeSqFt: 6500 });
  });

  it('a scenario edits its name via scenario-update', async () => {
    const scenario = { id: 'scn_1', name: 'Plan A', description: '', zoneType: 'residential', lotSizeSqFt: 5000, useMix: 'residential', efficiency: 0.82, parcelId: null };
    lensRun.mockImplementation((_d: string, action: string) => {
      if (action === 'scenario-list') return ok({ scenarios: [scenario] });
      if (action === 'parcel-list') return ok({ parcels: [] });
      return ok();
    });
    render(<ScenarioStudio />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit scenario Plan A' }));
    const name = await screen.findByLabelText('Edit scenario name') as HTMLInputElement;
    expect(name.value).toBe('Plan A');
    fireEvent.change(name, { target: { value: 'Plan A revised' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls('scenario-update')).toHaveLength(1));
    expect(calls('scenario-update')[0][2]).toMatchObject({ id: 'scn_1', name: 'Plan A revised' });
  });
});
