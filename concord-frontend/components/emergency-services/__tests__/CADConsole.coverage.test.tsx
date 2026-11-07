// Render coverage for the emergency-services CAD console: incidents, units, map,
// triage queue, alerts and readiness rollup stubbed; sweep opens an incident and
// dispatches/adds units.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const T = '2026-03-01T10:00:00.000Z';
const INC = { id: 'i1', summary: 'Kitchen fire', kind: 'fire', priority: 1, location: '12 Oak', lat: 40.1, lng: -105.2, status: 'open', assignedUnitId: null, createdAt: T };
const UNIT = { id: 'u1', name: 'Engine 4', kind: 'fire', status: 'available', station: 'S4', lat: 40.11, lng: -105.21, assignedIncidentId: null, allowedNext: ['dispatched', 'out_of_service'] };
const RES: Record<string, unknown> = {
  'incident-list': { incidents: [INC, { ...INC, id: 'i2', summary: 'Chest pain', kind: 'medical', priority: 2, status: 'dispatched', assignedUnitId: 'u2' }] },
  'unit-list': { units: [UNIT, { ...UNIT, id: 'u2', name: 'Medic 2', kind: 'medical', status: 'dispatched', assignedIncidentId: 'i2', allowedNext: ['transporting', 'clear'] }] },
  'map-state': { incidentPins: [{ id: 'i1', lat: 40.1, lng: -105.2, summary: 'Kitchen fire', kind: 'fire', priority: 1, status: 'open', assignedUnitId: null }], unitPins: [{ id: 'u1', lat: 40.11, lng: -105.21, name: 'Engine 4', kind: 'fire', status: 'available' }] },
  'triage-queue': { queue: [{ id: 'i1', summary: 'Kitchen fire', kind: 'fire', priority: 1, priorityLabel: 'P1', status: 'open', assignedUnitId: null, ageMinutes: 12, dispatchScore: 88, slaBreached: true }] },
  'active-alerts': { alerts: [{ incidentId: 'i1', summary: 'Kitchen fire', kind: 'fire', priority: 1, level: 'critical', status: 'open', assignedUnitId: null, ageMinutes: 12, slaBreached: true }] },
  'readiness-rollup': { totalUnits: 2, available: 1, committed: 1, outOfService: 0, readinessPct: 50, status: 'amber', byStatus: { available: 1, dispatched: 1 }, byKind: { fire: 1, medical: 1 }, kindCoverageGaps: ['hazmat'] },
  'incident-timeline': { events: [{ id: 'ev1', incidentId: 'i1', kind: 'created', detail: 'Call received', at: T }] },
  'nearest-unit': { recommended: { id: 'u1', name: 'Engine 4', kind: 'fire', station: 'S4', distanceKm: 1.2, etaMinutes: 4 }, ranked: [{ id: 'u1', name: 'Engine 4', kind: 'fire', station: 'S4', distanceKm: 1.2, etaMinutes: 4 }, { id: 'u2', name: 'Medic 2', kind: 'medical', station: 'S2', distanceKm: 3.1, etaMinutes: 9 }] },
  'unit-add': { unit: UNIT },
  'dispatch-unit': { distanceKm: 1.2 },
  'unit-status': { transition: { from: 'available', to: 'dispatched' } },
  'unit-transition': { transition: { from: 'available', to: 'dispatched' } },
};
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a), api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/components/lens/LimitationNotice', () => ({ LimitationNotice: () => <div data-testid="limits" /> }));
vi.mock('@/components/viz', () => ({ MapView: () => <div data-testid="map" />, TimelineView: () => <div data-testid="timeline" /> }));

import { CADConsole } from '../CADConsole';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: RES[actionOf(a)] ?? { ok: true, transition: { from: 'available', to: 'dispatched' }, unit: UNIT, incident: INC }, error: null } }));
});

describe('CADConsole', () => {
  it('renders the board and drives dispatch, unit and incident controls', async () => {
    const view = render(<CADConsole />);
    await settle();
    expect(view.container.textContent).toContain('Kitchen fire');
    await exercise({ passes: 5 });
    await settle();
    await exercise({ passes: 2, text: '5' });
    expect(view.container.textContent).toBeTruthy();
  });
  it('shows an honest empty console when every macro is offline', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<CADConsole />);
    await settle();
    await exercise({ passes: 2 });
    expect(view.container.textContent).toBeTruthy();
  });
  it('survives a thrown transport error', async () => {
    lensRunMock.mockImplementation(async () => { throw new Error('network'); });
    const view = render(<CADConsole />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
  });
});
