import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';

// CADConsole roster lifecycle (S2) + the Call board's limitation copy
// (S1). lensRun is routed by action; the roster payloads carry the
// server-computed allowedNext the console now renders from.

const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/viz', () => ({
  MapView: () => <div data-testid="map-view" />,
  TimelineView: () => <div data-testid="timeline-view" />,
}));

import { CADConsole } from '@/components/emergency-services/CADConsole';

const UNIT_AVAILABLE = {
  id: 'unit_1', name: 'Engine 3', kind: 'fire_engine', status: 'available',
  station: 'ST-1', lat: 41.7, lng: -73.9, assignedIncidentId: null,
  allowedNext: ['dispatched', 'out_of_service'],
};
const UNIT_OUT = {
  id: 'unit_2', name: 'Medic 1', kind: 'ambulance', status: 'out_of_service',
  station: 'ST-2', assignedIncidentId: null, allowedNext: ['available'],
};
const ROLLUP = {
  totalUnits: 2, available: 1, committed: 0, outOfService: 1,
  readinessPct: 50, status: 'operational', byStatus: {}, byKind: {}, kindCoverageGaps: [],
};

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}

function route(units: unknown[]) {
  return (_domain: string, action: string, _input?: unknown) => {
    switch (action) {
      case 'incident-list': return ok({ incidents: [] });
      case 'unit-list': return ok({ units, count: units.length, available: 1 });
      case 'map-state': return ok({ incidentPins: [], unitPins: [] });
      case 'triage-queue': return ok({ queue: [] });
      case 'active-alerts': return ok({ alerts: [] });
      case 'readiness-rollup': return ok(ROLLUP);
      case 'unit-status-advance': return ok({ transition: { from: 'available', to: 'out_of_service' }, unit: UNIT_AVAILABLE });
      case 'unit-update': return ok({ unit: { ...UNIT_AVAILABLE, name: 'Engine 3 (corrected)' } });
      case 'unit-delete': return ok({ deleted: true, unit: UNIT_AVAILABLE });
      default: return ok({});
    }
  };
}

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation(route([UNIT_AVAILABLE, UNIT_OUT]));
});

describe('CADConsole — Call board limitation copy (S1)', () => {
  it('stands the not-an-emergency notice at the head of the board', async () => {
    const { getByText } = render(<CADConsole />);
    await waitFor(() => expect(getByText('Unit Roster (2)')).toBeInTheDocument());
    expect(getByText(/Not an emergency service\./)).toBeInTheDocument();
    expect(getByText(/call 911 now/)).toBeInTheDocument();
  });
});

describe('CADConsole — roster lifecycle (S2)', () => {
  it('offers the full legal status set, including the non-dispatch out-of-service path', async () => {
    const { getByText } = render(<CADConsole />);
    await waitFor(() => expect(getByText('Unit Roster (2)')).toBeInTheDocument());
    // From available: the registered flow's whole set — not just dispatch.
    expect(getByText('→ out of service')).toBeInTheDocument();
    expect(getByText('→ dispatched')).toBeInTheDocument();
    // An out-of-service unit is no longer stranded without controls.
    expect(getByText('→ available')).toBeInTheDocument();

    fireEvent.click(getByText('→ out of service'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'emergency-services', 'unit-status-advance', { id: 'unit_1', status: 'out_of_service' },
    ));
  });

  it('edits a unit through unit-update with the corrected record', async () => {
    const { getAllByText, getByLabelText, getByText } = render(<CADConsole />);
    await waitFor(() => expect(getByText('Unit Roster (2)')).toBeInTheDocument());

    fireEvent.click(getAllByText('Edit')[0]);
    const nameField = getByLabelText('Unit call-sign') as HTMLInputElement;
    expect(nameField.value).toBe('Engine 3');
    fireEvent.change(nameField, { target: { value: 'Engine 3 (corrected)' } });
    fireEvent.click(getByText('Save changes'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'emergency-services', 'unit-update',
      expect.objectContaining({ id: 'unit_1', name: 'Engine 3 (corrected)', kind: 'fire_engine', station: 'ST-1' }),
    ));
  });

  it('removes a unit only after the explicit confirmation step', async () => {
    const { getAllByText, getByText, queryByText } = render(<CADConsole />);
    await waitFor(() => expect(getByText('Unit Roster (2)')).toBeInTheDocument());

    fireEvent.click(getAllByText('Remove')[0]);
    // One click never deletes: the confirmation step names the unit.
    expect(queryByText('Remove Engine 3 from the roster?')).toBeInTheDocument();
    expect(lensRun).not.toHaveBeenCalledWith('emergency-services', 'unit-delete', expect.anything());

    fireEvent.click(getByText('Confirm remove'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith(
      'emergency-services', 'unit-delete', { id: 'unit_1' },
    ));
  });

  it('shows the honest refusal when the server will not delete an assigned unit', async () => {
    lensRun.mockImplementation((_domain: string, action: string, input?: unknown) => {
      if (action === 'unit-delete') {
        return Promise.resolve({ data: { ok: false, error: 'unit_is_assigned' } });
      }
      return route([UNIT_AVAILABLE, UNIT_OUT])(_domain, action, input);
    });
    const { getAllByText, getByText } = render(<CADConsole />);
    await waitFor(() => expect(getByText('Unit Roster (2)')).toBeInTheDocument());

    fireEvent.click(getAllByText('Remove')[0]);
    fireEvent.click(getByText('Confirm remove'));
    await waitFor(() => expect(getByText(/is assigned to an incident — clear it before removing/)).toBeInTheDocument());
  });
});
