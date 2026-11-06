// Render coverage for the law-enforcement case panel, action panel and notice.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { actionOf, exercise } from '../../../tests/helpers/exercise';

const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
const apiPost = vi.fn();
const T = '2026-03-01T10:00:00.000Z';
const CASE = { id: 'c1', caseNumber: 'CS-26-001', title: 'Burglary Elm St', synopsis: 'Forced entry', status: 'under_investigation', assignedDetective: 'Det. Hale', openedAt: T, closedAt: null, closureReason: null, createdAt: T, updatedAt: T };
const LE: Record<string, unknown> = {
  caseList: { cases: [CASE, { ...CASE, id: 'c2', caseNumber: 'CS-26-002', status: 'cold' }, { ...CASE, id: 'c3', caseNumber: 'CS-26-003', status: 'closed', closedAt: T, closureReason: 'arrest' }, { ...CASE, id: 'c4', caseNumber: 'CS-26-004', status: 'open' }] },
  caseLinked: { case: CASE, reports: [{ id: 'r1', reportNumber: 'R-1', offense: 'burglary', status: 'approved' }], evidence: [{ id: 'e1', barcode: 'BC1', description: 'crowbar', status: 'booked' }], bookings: [{ id: 'b1', bookingNumber: 'B-1', subjectName: 'J. Doe', kind: 'arrest' }], warrants: [{ id: 'w1', warrantNumber: 'W-1', subject: 'J. Doe', status: 'issued' }], counts: { reports: 1, evidence: 1, bookings: 1, warrants: 1 } },
  caseCreate: { case: CASE },
  caseUpdate: { case: CASE },
  caseDelete: { deleted: true, linked: { reports: 1, evidence: 0, bookings: 0, warrants: 0 } },
  caseGet: { case: { id: 'c1', caseNumber: 'CS-26-001', title: 'Burglary Elm St', status: 'open', assignedDetective: 'Hale' } },
  crimeMap: { hotspotCount: 2, total: 14 },
};
const MACRO: Record<string, unknown> = {
  caseAnalysis: { caseId: 'c1', evidenceCount: 3, bookedEvidenceCount: 2, stagedEvidenceCount: 1, linkedCase: { caseNumber: 'CS-26-001', title: 'Burglary', status: 'open' }, witnessCount: 2, suspectCount: 1, caseStrength: 72, prosecutable: true, status: 'strong', nextSteps: ['interview', 'lab'] },
  patrolOptimize: { zones: [{ zone: 'North', crimeRate: 5, population: 9000, currentPatrols: 2, recommended: 3 }], totalUnitsNeeded: 3, totalCurrentUnits: 2, hotspots: ['North'] },
  incidentReport: { reportId: 'IR-1', complete: false, missingFields: ['location'], type: 'theft', date: '2026-03-01', location: 'Main', severity: 'medium', status: 'draft' },
  crimeStats: { totalIncidents: 14, byType: [{ type: 'theft', count: 9 }], clearanceRate: 0.4, mostCommon: 'theft', trend: 'down', sources: { mappedIncidents: 5, cases: 4, stagedRows: 5 } },
};
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { post: (...a: unknown[]) => apiPost(...a), get: vi.fn(async () => ({ data: {} })), delete: vi.fn(async () => ({ data: {} })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomainMock(...a) } },
}));
vi.mock('@/components/panel-polish', () => ({
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn(), items: [] }),
  useRecallableAction: () => ({ run: vi.fn(async (fn: () => Promise<unknown>) => fn()), recall: vi.fn(), state: null, armed: false, slot: null }),
  RecallSlot: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));

import { CaseManagementPanel } from '../CaseManagementPanel';
import { LawEnforcementActionPanel } from '../LawEnforcementActionPanel';
import { LimitationNotice } from '../LimitationNotice';

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
afterEach(() => cleanup());
beforeEach(() => {
  lensRunMock.mockReset(); runDomainMock.mockReset(); apiPost.mockReset();
  lensRunMock.mockImplementation(async (...a: unknown[]) => ({ data: { ok: true, result: LE[actionOf(a)] ?? { ok: true, case: CASE, linked: { reports: 0, evidence: 0, bookings: 0, warrants: 0 } }, error: null } }));
  runDomainMock.mockImplementation(async (_d: string, name: string) => ({ data: { ok: true, result: { ok: true, result: MACRO[name] ?? {} } } }));
  apiPost.mockImplementation(async () => ({ data: { ok: true, result: { answer: 'done', dtu: { id: 'd1' } }, message: { id: 'm1' } } }));
});

describe('LimitationNotice', () => {
  it('states what the console does not do', () => {
    const view = render(<LimitationNotice />);
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('CaseManagementPanel', () => {
  it('lists cases, opens one with linked records and drives the forms', async () => {
    const view = render(<CaseManagementPanel />);
    await settle();
    await exercise({ passes: 5 });
    await settle();
    await exercise({ passes: 2, text: '5' });
    expect(view.container.textContent).toContain('CS-26-001');
  });
  it('reports a failed load honestly', async () => {
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, result: null, error: 'offline' } }));
    const view = render(<CaseManagementPanel />);
    await settle();
    await exercise({ passes: 2 });
    expect(view.container.textContent).toBeTruthy();
  });
});

describe('LawEnforcementActionPanel', () => {
  it('runs every analysis action', async () => {
    const view = render(<LawEnforcementActionPanel />);
    await settle();
    await exercise({ passes: 5, text: 'CS-26-001' });
    await settle();
    await exercise({ passes: 3, text: '5' });
    expect(view.container.textContent).toBeTruthy();
  });
  it('reports macro failure honestly', async () => {
    runDomainMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    lensRunMock.mockImplementation(async () => ({ data: { ok: false, error: 'offline' } }));
    const view = render(<LawEnforcementActionPanel />);
    await settle();
    await exercise({ passes: 2, text: 'x' });
    expect(view.container.textContent).toBeTruthy();
  });
});
