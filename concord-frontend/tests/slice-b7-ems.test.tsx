import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Slice B7 — emergency-services trio (FIX-emergency-services-002/-014
// FE legs): the CAD detail panel gains Close + two-step Delete; the
// agency board gains per-incident Close/Delete; agency creation takes
// a listing choice that defaults to Private, and the chief can flip
// the listing from the workspace header.

const lensRun = vi.fn();

vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));
vi.mock('@/components/viz', () => ({
  MapView: () => <div data-testid="map-view" />,
  TimelineView: () => <div data-testid="timeline-view" />,
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

import { CADConsole } from '@/components/emergency-services/CADConsole';
import { AgencyMutualAidPanel } from '@/components/emergency-services/AgencyMutualAidPanel';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function calls(action: string) {
  return lensRun.mock.calls.filter((c) => c[1] === action);
}

const INC = {
  id: 'inc_1', summary: 'Structure fire on Main St', kind: 'fire', priority: 1,
  location: 'Main St', lat: null, lng: null, status: 'open', assignedUnitId: null,
};
const QROW = {
  id: 'inc_1', summary: 'Structure fire on Main St', kind: 'fire', priority: 1,
  priorityLabel: 'P1', status: 'open', ageMinutes: 4, dispatchScore: 91, slaBreached: false,
};
const ROLLUP = {
  totalUnits: 0, available: 0, committed: 0, outOfService: 0,
  readinessPct: 0, status: 'critical', byStatus: {}, byKind: {}, kindCoverageGaps: [],
};

function cadRoute() {
  return (_d: string, action: string) => {
    switch (action) {
      case 'incident-list': return ok({ incidents: [INC] });
      case 'unit-list': return ok({ units: [], count: 0, available: 0 });
      case 'map-state': return ok({ incidentPins: [], unitPins: [] });
      case 'triage-queue': return ok({ queue: [QROW] });
      case 'active-alerts': return ok({ alerts: [] });
      case 'readiness-rollup': return ok(ROLLUP);
      case 'incident-timeline': return ok({ events: [] });
      case 'nearest-unit': return ok({ recommended: null, ranked: [] });
      case 'incident-status': return ok({ incident: { ...INC, status: 'resolved' } });
      case 'incident-delete': return ok({ deleted: true, incident: INC });
      default: return ok({});
    }
  };
}

const ORG = {
  id: 'org_1', name: 'Riverside Fire & EMS', type: 'department', leaderId: 'u1',
  memberCount: 1, myRole: 'leader', myEmsRole: 'chief', recruitCriteria: 'closed',
};
const AGENCY_INC = {
  id: 'inc_9', summary: 'Agency medical call', kind: 'medical', priority: 2,
  location: '', status: 'open', assignedUnitId: null, createdAt: '2026-11-12T00:00:00Z', orgId: 'org_1',
};

function agencyRoute(withOrg: boolean) {
  return (_d: string, action: string) => {
    switch (action) {
      case 'agency-mine': return ok({ organizations: withOrg ? [ORG] : [] });
      case 'agency-members': return ok({
        organization: ORG,
        members: [{ userId: 'u1', role: 'leader', emsRole: 'chief' }],
        myRole: 'chief', myOrgRole: 'leader',
      });
      case 'incident-list': return ok({ incidents: [AGENCY_INC] });
      case 'unit-list': return ok({ units: [] });
      case 'incident-status': return ok({ incident: { ...AGENCY_INC, status: 'resolved' } });
      case 'incident-delete': return ok({ deleted: true, incident: AGENCY_INC });
      case 'agency-set-visibility': return ok({ organization: { ...ORG, recruitCriteria: 'open' }, recruitCriteria: 'open' });
      case 'agency-create': return ok({ organization: ORG, role: 'chief', orgRole: 'leader' });
      default: return ok({});
    }
  };
}

beforeEach(() => {
  lensRun.mockReset();
});

describe('CADConsole — incident lifecycle exits (FIX-emergency-services-002)', () => {
  it('the detail panel closes the incident and deletes it behind a two-step confirm', async () => {
    lensRun.mockImplementation(cadRoute());
    render(<CADConsole />);
    const row = await screen.findByRole('button', { name: /Structure fire on Main St/ });
    fireEvent.click(row);
    const closeBtn = await screen.findByRole('button', { name: 'Close incident' });
    fireEvent.click(closeBtn);
    await waitFor(() => expect(calls('incident-status')).toHaveLength(1));
    expect(calls('incident-status')[0][2]).toMatchObject({ id: 'inc_1', status: 'resolved' });

    // Re-open the detail and delete: the arm fires nothing, the
    // confirm fires incident-delete exactly once.
    fireEvent.click(await screen.findByRole('button', { name: /Structure fire on Main St/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete this incident record?')).toBeInTheDocument();
    expect(calls('incident-delete')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls('incident-delete')).toHaveLength(1));
    expect(calls('incident-delete')[0][2]).toMatchObject({ id: 'inc_1' });
    expect(await screen.findByText(/Incident deleted/)).toBeInTheDocument();
  });
});

describe('AgencyMutualAidPanel — listing choice + board exits (FIX-emergency-services-002/-014)', () => {
  it('creation defaults to a Private listing and sends the choice', async () => {
    lensRun.mockImplementation(agencyRoute(false));
    render(<AgencyMutualAidPanel />);
    const nameInput = await screen.findByPlaceholderText(/Riverside Fire/);
    fireEvent.change(nameInput, { target: { value: 'Riverside Fire & EMS' } });
    const listing = screen.getByLabelText('Agency listing') as HTMLSelectElement;
    expect(listing.value).toBe('private');
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls('agency-create')).toHaveLength(1));
    expect(calls('agency-create')[0][2]).toMatchObject({ name: 'Riverside Fire & EMS', visibility: 'private' });
  });

  it('the workspace shows the private state, flips the listing, and closes/deletes board incidents', async () => {
    lensRun.mockImplementation(agencyRoute(true));
    render(<AgencyMutualAidPanel />);
    expect(await screen.findByText('Private — members only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /List in Browse/ }));
    await waitFor(() => expect(calls('agency-set-visibility')).toHaveLength(1));
    expect(calls('agency-set-visibility')[0][2]).toMatchObject({ orgId: 'org_1', visibility: 'open' });

    fireEvent.click(await screen.findByRole('button', { name: 'Close incident Agency medical call' }));
    await waitFor(() => expect(calls('incident-status')).toHaveLength(1));
    expect(calls('incident-status')[0][2]).toMatchObject({ orgId: 'org_1', id: 'inc_9', status: 'resolved' });

    fireEvent.click(screen.getByRole('button', { name: 'Delete incident Agency medical call' }));
    expect(calls('incident-delete')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(calls('incident-delete')).toHaveLength(1));
    expect(calls('incident-delete')[0][2]).toMatchObject({ orgId: 'org_1', id: 'inc_9' });
  });
});
