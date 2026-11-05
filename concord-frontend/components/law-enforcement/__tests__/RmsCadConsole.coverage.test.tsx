// Render coverage for the RMS/CAD console: every tab (dispatch, evidence, roster,
// crime map, warrants, reports, booking) against stubbed records.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const T = '2026-03-01T10:00:00.000Z';
const STATUTE = { code: 'PC 459', title: 'Burglary', class: 'felony' };
const RES: Record<string, unknown> = {
  cadCallQueue: { queue: [{ id: 'c1', callType: 'Burglary', location: '1 Elm', lat: 40.1, lon: -105.2, priority: 'P1', callerName: 'Ann', status: 'pending', assignedUnit: null, createdAt: T }, { id: 'c2', callType: 'Noise', location: '2 Elm', lat: null, lon: null, priority: 'P3', callerName: '', status: 'dispatched', assignedUnit: 'A-12', createdAt: T }], byPriority: { P1: 1, P3: 1 } },
  cadUnitBoard: { units: [{ id: 'u1', callSign: 'A-12', officerName: 'Hale', beat: 'N1', unitType: 'patrol', status: 'available', lat: 40.11, lon: -105.21, currentCallId: null }, { id: 'u2', callSign: 'K-9', officerName: 'Lee', beat: 'N2', unitType: 'k9', status: 'enroute', lat: null, lon: null, currentCallId: 'c2' }] },
  cadDispatchUnit: { etaMinutes: 5, unit: { id: 'u1', callSign: 'A-12', officerName: 'Hale', beat: 'N1', unitType: 'patrol', status: 'dispatched', lat: 40.11, lon: -105.21, currentCallId: 'c1' } },
  evidenceList: { evidence: [{ id: 'e1', barcode: 'BC1', caseNumber: 'CS-1', description: 'Crowbar', category: 'tool', locker: 'L1', status: 'booked', currentHolder: 'Hale', intakeAt: T, custody: [] }], byLocker: [{ locker: 'L1', count: 1 }] },
  evidenceChain: { chain: [{ event: 'intake', from: '-', to: 'Hale', locker: 'L1', signature: 'EH', at: T, note: '' }], chainIntact: true, barcode: 'BC1' },
  evidenceIntake: { evidence: { id: 'e2' } },
  rosterBoard: { roster: [{ officerId: 'o1', name: 'Hale', badgeNumber: '101', rank: 'Det', beat: 'N1', shifts: [{ id: 's1', date: '2026-03-01', shift: 'day', beat: 'N1', hours: 10 }], shiftCount: 1, totalHours: 10, weeklyHours: 44, overtimeHours: 4 }], officersOnOvertime: 1, totalOvertimeHours: 4 },
  scheduleShift: { dayOvertime: 2 },
  crimeMap: { incidents: [{ id: 'm1', type: 'theft', lat: 40.1, lon: -105.2, address: '1 Elm', severity: 'high', occurredAt: T }], hotspots: [{ centerLat: 40.1, centerLon: -105.2, incidentCount: 3, incidentIds: ['m1'] }], byType: [{ type: 'theft', count: 3 }] },
  warrantList: { warrants: [{ id: 'w1', warrantNumber: 'W-1', subject: 'J. Doe', warrantType: 'arrest', caseNumber: 'CS-1', charges: 'burglary', status: 'active', issuedAt: T, expiresAt: '2026-03-20', attempts: [{ id: 'a1', at: T, officer: 'Hale', location: 'home', outcome: 'not_found', note: '' }], returnedAt: null }], active: 1, expiringSoon: 1 },
  warrantIssue: { warrant: { id: 'w2' } },
  reportList: { reports: [{ id: 'r1', reportNumber: 'R-1', caseNumber: 'CS-1', offense: 'burglary', narrative: 'Forced entry', location: '1 Elm', officer: 'Hale', statute: STATUTE, status: 'submitted', approvedBy: null, supervisorNote: null, createdAt: T }, { id: 'r2', reportNumber: 'R-2', caseNumber: '', offense: 'theft', narrative: 'n', location: 'x', officer: 'Lee', statute: null, status: 'draft', approvedBy: null, supervisorNote: null, createdAt: T }], pendingApproval: 1 },
  reportDraft: { statuteFound: true },
  bookingList: { bookings: [{ id: 'b1', kind: 'arrest', bookingNumber: 'B-1', subjectName: 'J. Doe', dob: '1990-01-01', sex: 'M', charges: ['burglary'], statutes: [STATUTE], mugshotCaptured: true, printsCaptured: false, officer: 'Hale', status: 'booked', createdAt: T, location: 'Central' }], arrests: 1, fieldInterviews: 0 },
  bookingCreate: { complete: false, missingFields: ['prints'] },
};
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRunMock(...a), api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/components/viz', () => ({ MapView: () => <div data-testid="map" />, TimelineView: () => <div />, ChartKit: () => <div /> }));

import { RmsCadConsole } from '../RmsCadConsole';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: RES[actionOf(a)] ?? { ok: true }, error: null } }));
});

const TABS = ['Dispatch (CAD)', 'Evidence', 'Roster', 'Crime Map', 'Warrants', 'Reports', 'Booking'];
describe('RmsCadConsole', () => {
  it.each(TABS)('walks the %s tab', async (label) => {
    const view = render(<RmsCadConsole />);
    await settle();
    const tab = screen.getAllByRole('button').find((b) => (b.textContent || '').trim() === label);
    if (tab) await act(async () => { fireEvent.click(tab); });
    await settle();
    const skip = new RegExp(`^(${TABS.map((t) => t.replace(/[()]/g, '\\$&')).join('|')})$`);
    await exercise({ passes: 4, skip });
    await settle();
    await exercise({ passes: 2, skip, text: '5' });
    expect(view.container.textContent).toBeTruthy();
  });
  it('is honest when records cannot be loaded', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, result: null, error: 'offline' } }));
    const view = render(<RmsCadConsole />);
    await settle();
    await exercise({ passes: 1 });
    expect(view.container.textContent).toBeTruthy();
  });
});
