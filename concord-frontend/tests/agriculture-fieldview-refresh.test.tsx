import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

// FIX-agriculture-014 — a field created in the Farm Workbench overlay must
// appear in the FieldView (Precision-Ag) NDVI field dropdown without a page
// reload. PrecisionAgPanel fetched field-list once on mount; the workbench
// now broadcasts 'agriculture:fields-changed' on create/update/delete and
// the panel refetches on that event (Climate FieldView pattern: create a
// field anywhere, it is immediately selectable everywhere).

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import PrecisionAgPanel from '@/components/agriculture/PrecisionAgPanel';

const north40 = { id: 'fld_north40', name: 'North 40', acreage: 40, lat: 42.1, lng: -97.3, soilType: 'loam', currentCrop: 'corn' };
const riverBend = { id: 'fld_riverbend', name: 'River Bend', acreage: 25, lat: 42.2, lng: -97.4, soilType: 'silt', currentCrop: 'soy' };

let serverFields = [north40];

function fieldListCalls() {
  return lensRunMock.mock.calls.filter((c) => c[1] === 'field-list').length;
}

beforeEach(() => {
  serverFields = [north40];
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (_domain: string, action: string) => {
    if (action === 'field-list') return { data: { ok: true, result: { fields: serverFields } } };
    return { data: { ok: true, result: {} } };
  });
});

describe('FIX-agriculture-014 — FieldView NDVI dropdown tracks workbench field changes', () => {
  it('a field created after mount appears in the NDVI dropdown on the fields-changed broadcast, no reload', async () => {
    render(<PrecisionAgPanel />);
    expect(await screen.findByRole('option', { name: /North 40/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /River Bend/ })).toBeNull();

    // The workbench creates River Bend server-side and broadcasts the change.
    serverFields = [north40, riverBend];
    const before = fieldListCalls();
    act(() => { window.dispatchEvent(new CustomEvent('agriculture:fields-changed')); });

    expect(await screen.findByRole('option', { name: /River Bend/ })).toBeTruthy();
    expect(fieldListCalls()).toBeGreaterThan(before);
  });

  it('without the broadcast the dropdown keeps the mount-time list (no polling)', async () => {
    render(<PrecisionAgPanel />);
    expect(await screen.findByRole('option', { name: /North 40/ })).toBeTruthy();

    serverFields = [north40, riverBend];
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByRole('option', { name: /River Bend/ })).toBeNull();
    await waitFor(() => expect(screen.getByRole('option', { name: /North 40/ })).toBeTruthy());
  });
});
