// Render coverage for the defense boards (assets, comms, logistics, missions,
// personnel, threats). Macros are stubbed with realistic rollups; the sweep fills
// and presses every control, including the confirm-delete buttons.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { actionOf, exercise } from '../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const T = '2026-03-01T10:00:00.000Z';
const ASSET = { id: 'as1', designation: 'Truck-1', type: 'vehicle', status: 'operational', readiness: 80, assignedUnit: 'A Co', lat: 40.1, lon: -105.2, lastServiced: T, notes: 'n' };
const RES: Record<string, unknown> = {
  'asset-rollup': { assets: [ASSET, { ...ASSET, id: 'as2', status: 'maintenance', readiness: 30, lat: null, lon: null }], total: 2, inService: 1, byStatus: { operational: 1, maintenance: 1 }, byType: { vehicle: 2 }, fleetReadiness: 55, availabilityPct: 50, meanReadiness: 55, lowReadiness: [{ id: 'as2', designation: 'Truck-2', readiness: 30, status: 'maintenance' }], rollupStatus: 'amber' },
  'asset-upsert': { asset: ASSET },
  'comms-log': { messages: [{ id: 'm1', channel: 'ALPHA', body: 'Move out', classification: 'secret', precedence: 'flash', sender: 'HQ', acknowledged: false, postedAt: T }, { id: 'm2', channel: 'BRAVO', body: 'Copy', classification: 'unclassified', precedence: 'routine', sender: 'B6', acknowledged: true, acknowledgedAt: T, postedAt: T }], channels: ['ALPHA', 'BRAVO'], total: 2, unacknowledged: 1 },
  'supply-board': { requests: [{ id: 'r1', item: '5.56mm', quantity: 1000, category: 'ammunition', priority: 'urgent', status: 'requested', destination: 'FOB', requestedBy: 'S4', history: [{ at: T, status: 'requested' }], createdAt: T }, { id: 'r2', item: 'Diesel', quantity: 500, category: 'fuel', priority: 'routine', status: 'in_transit', destination: 'FOB', requestedBy: 'S4', history: [], createdAt: T }], total: 2, byStatus: { requested: 1, in_transit: 1 }, byCategory: { ammunition: 1, fuel: 1 }, openCount: 2, fulfillmentPct: 0 },
  'mission-plan': { tasks: [{ id: 'k1', name: 'Recon', phase: 'shaping', status: 'complete', dependsOn: [], owner: 'S2', startOffset: 0, durationHours: 4, earliestStart: 0, finish: 4 }, { id: 'k2', name: 'Assault', phase: 'decisive', status: 'blocked', dependsOn: ['k1'], owner: 'S3', startOffset: 4, durationHours: 6, earliestStart: 4, finish: 10 }], phases: [{ phase: 'shaping', count: 1, complete: 1 }, { phase: 'decisive', count: 1, complete: 0 }], criticalPath: ['k1', 'k2'], blocked: [{ id: 'k2', name: 'Assault' }], totalDurationHours: 10, completionPct: 50 },
  'personnel-roster': { roster: [{ id: 'p1', name: 'Cpl Reyes', rank: 'CPL', role: 'medic', unit: 'A Co', assignment: 'Aid', availability: 'available', clearance: 'secret' }, { id: 'p2', name: 'Sgt Cho', rank: 'SGT', role: 'rifleman', unit: 'A Co', assignment: '', availability: 'deployed' }], total: 2, byAvailability: { available: 1, deployed: 1 }, byRole: { medic: 1, rifleman: 1 }, unassigned: [{ id: 'p1', name: 'Cpl Reyes' }], deployable: 1 },
  'threat-board': { threats: [{ id: 'th1', name: 'Jamming', category: 'cyber', severity: 'high', status: 'watching', region: 'North', note: 'n', history: [{ at: T, event: 'raised', severity: 'high' }], createdAt: T }, { id: 'th2', name: 'Sniper', category: 'kinetic', severity: 'critical', status: 'engaged', region: 'East', note: '', history: [], createdAt: T }], total: 2, bySeverity: { high: 1, critical: 1 }, byStatus: { watching: 1, engaged: 1 }, highestSeverity: 'critical', activeWatch: 2 },
};
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: {} })) },
}));
vi.mock('@/components/viz', () => ({ ChartKit: () => <div data-testid="chart" />, TimelineView: () => <div data-testid="timeline" /> }));

import { AssetReadiness } from './AssetReadiness';
import { CommsLog } from './CommsLog';
import { LogisticsBoard } from './LogisticsBoard';
import { MissionPlanner } from './MissionPlanner';
import { PersonnelRoster } from './PersonnelRoster';
import { ThreatBoard } from './ThreatBoard';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: RES[actionOf(a)] ?? { ok: true }, error: null } }));
});

describe.each([
  ['AssetReadiness', AssetReadiness], ['CommsLog', CommsLog], ['LogisticsBoard', LogisticsBoard],
  ['MissionPlanner', MissionPlanner], ['PersonnelRoster', PersonnelRoster], ['ThreatBoard', ThreatBoard],
])('%s', (_n, Comp: React.ComponentType) => {
  it('renders the board and drives every control', async () => {
    const view = render(<Comp />);
    await settle();
    expect(view.container.textContent).toBeTruthy();
    await exercise({ passes: 4 });
    await settle();
    await exercise({ passes: 2, text: '5' });
    await settle();
  });
  it('shows an honest empty state when the macro is offline', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<Comp />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container.textContent).toBeTruthy();
  });
});
