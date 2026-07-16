/**
 * FieldServiceConsole — Inspections tab (Wave 4 gap closure).
 *
 * Closes the "Inspections" item in docs/lens-specs/plumbing-capability-map.md's
 * deferred-items table: workflowStart/workflowUpdate cover the technician's
 * own on-site checklist + photo + signature, but not a real municipal
 * inspection scheduled against a jurisdiction with an inspector-of-record and
 * a pass/fail result. This pins the new Inspections tab against the real
 * inspectionAdd/inspectionList/inspectionUpdate macros in
 * server/domains/plumbing.js — dispatch-job-linked, real municipal/AHJ
 * inspection-type categories, required jurisdiction, pass/fail/pending with
 * required deficiency notes + optional re-inspection date on failure.
 *
 * Hermetic: lensRun + @/components/viz + ClientAutocomplete + TechCertifications
 * are mocked. No network, no server boot. FieldServiceConsole only exports the
 * shell (no per-section exports), so these tests drive it exactly like a user
 * would — render the console, click the Inspections tab, interact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz', () => ({
  TimelineView: () => null,
  ChartKit: () => null,
}));
vi.mock('@/components/plumbing/ClientAutocomplete', () => ({
  ClientAutocomplete: () => null,
}));
vi.mock('@/components/plumbing/TechCertifications', () => ({
  TechCertifications: () => null,
}));

import { FieldServiceConsole } from '@/components/plumbing/FieldServiceConsole';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result, error: null } });
}

const EMPTY_OPS = { jobsToday: 0, openJobs: 0, unassigned: 0, outstandingAR: 0, collected: 0, activePlans: 0, recurringRevenue: 0, lowStockParts: 0 };
const EMPTY_TECHS = { techs: [], count: 0 };
const EMPTY_BOARD = { lanes: [], unassigned: [], totalAssignments: 0, emergencyCount: 0 };
const EMPTY_PRICEBOOK = { items: [], count: 0, avgMarginPct: 0 };
const EMPTY_INVOICES = { invoices: [], count: 0, outstanding: 0, collected: 0 };
const EMPTY_PLANS = { plans: [], count: 0, dueSoon: 0, recurringRevenue: 0 };
const EMPTY_NOTICES = { notices: [], count: 0, byKind: {} };
const EMPTY_PARTS = { parts: [], count: 0, lowStock: [], inventoryValue: 0 };
const EMPTY_CLIENTS = { clients: [], count: 0 };
const EMPTY_INSPECTIONS = { inspections: [], count: 0, passCount: 0, failCount: 0, pendingCount: 0 };

const ASSIGNMENT_A = {
  id: 'disp_a', jobTitle: 'Gas line to new range', client: 'Ortega Household', clientId: null,
  address: '412 Birch St', techId: null, date: '2026-08-01', startHour: 8, durationHours: 2,
  priority: 'normal', status: 'scheduled',
};

const INSPECTION_PASS = {
  id: 'insp_1', number: 'INSP-001', assignmentId: 'disp_a', jobTitle: 'Gas line to new range', jobFound: true,
  address: '412 Birch St', inspectionType: 'gas_line_pressure_test', inspector: 'Marcus Boyle',
  jurisdiction: 'City of Springfield Building Dept', permitNumber: 'PLM-2026-4471', scheduledDate: '2026-08-11',
  result: 'pass', deficiencyNotes: null, reInspectionDate: null, notes: '', completedAt: '2026-08-11T12:00:00.000Z',
};
const INSPECTION_FAIL = {
  id: 'insp_2', number: 'INSP-002', assignmentId: 'disp_a', jobTitle: 'Gas line to new range', jobFound: true,
  address: '412 Birch St', inspectionType: 'top_out_dwv', inspector: 'Bob Alvarez',
  jurisdiction: 'County of Clearwater', permitNumber: '', scheduledDate: '2026-09-02',
  result: 'fail', deficiencyNotes: 'Vent stack undersized for fixture count', reInspectionDate: '2026-09-09',
  notes: '', completedAt: '2026-09-02T12:00:00.000Z',
};
const INSPECTION_PENDING_ORPHAN = {
  id: 'insp_3', number: 'INSP-003', assignmentId: 'disp_gone', jobTitle: null, jobFound: false,
  address: null, inspectionType: 'final_plumbing', inspector: 'Jane Ruiz',
  jurisdiction: 'City of Springfield', permitNumber: '', scheduledDate: '2026-08-12',
  result: 'pending', deficiencyNotes: null, reInspectionDate: null, notes: '', completedAt: null,
};

// Every refreshAll() call fires 10 macros on mount; a per-test override map
// with these defaults keeps the console rendering a stable empty state
// unless the test cares about a specific action's response.
function mockRoute(overrides: Record<string, () => Promise<unknown>> = {}) {
  const defaults: Record<string, () => Promise<unknown>> = {
    opsSummary: () => ok(EMPTY_OPS),
    techList: () => ok(EMPTY_TECHS),
    dispatchBoard: () => ok(EMPTY_BOARD),
    priceBookList: () => ok(EMPTY_PRICEBOOK),
    invoiceList: () => ok(EMPTY_INVOICES),
    planList: () => ok(EMPTY_PLANS),
    notifyLog: () => ok(EMPTY_NOTICES),
    partList: () => ok(EMPTY_PARTS),
    clientList: () => ok(EMPTY_CLIENTS),
    inspectionList: () => ok(EMPTY_INSPECTIONS),
  };
  const behaviors = { ...defaults, ...overrides };
  lensRun.mockImplementation((_domain: string, action: string) => {
    const fn = behaviors[action];
    if (fn) return fn();
    return ok({});
  });
}

async function goToInspections() {
  fireEvent.click(screen.getByRole('button', { name: /^Inspections$/ }));
}

describe('FieldServiceConsole — Inspections tab', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders the empty state and a "schedule a job first" hint when the dispatch board is empty', async () => {
    mockRoute();
    render(<FieldServiceConsole />);
    await goToInspections();
    expect(await screen.findByText(/No inspections scheduled yet/i)).toBeInTheDocument();
    expect(screen.getByText(/Schedule a job on the Dispatch board first/i)).toBeInTheDocument();
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('plumbing', 'inspectionList', {}));
  });

  it('the job picker and inspection-type picker are real selects, not free text', async () => {
    mockRoute({ dispatchBoard: () => ok({ lanes: [], unassigned: [ASSIGNMENT_A], totalAssignments: 1, emergencyCount: 0 }) });
    render(<FieldServiceConsole />);
    await goToInspections();
    const jobSelect = await screen.findByLabelText('Job') as HTMLSelectElement;
    expect(jobSelect.tagName).toBe('SELECT');
    expect(Array.from(jobSelect.options).map((o) => o.textContent)).toContain('Gas line to new range · Ortega Household');
    const typeSelect = screen.getByLabelText('Inspection type') as HTMLSelectElement;
    expect(typeSelect.tagName).toBe('SELECT');
    const values = Array.from(typeSelect.options).map((o) => o.value);
    expect(values).toEqual(['rough_in', 'top_out_dwv', 'water_service_backflow', 'gas_line_pressure_test', 'water_heater_install', 'final_plumbing']);
  });

  it('scheduling an inspection calls inspectionAdd with the picked job, type, inspector, jurisdiction, permit, and date', async () => {
    mockRoute({
      dispatchBoard: () => ok({ lanes: [], unassigned: [ASSIGNMENT_A], totalAssignments: 1, emergencyCount: 0 }),
      inspectionAdd: () => ok({ inspection: INSPECTION_PASS }),
    });
    render(<FieldServiceConsole />);
    await goToInspections();

    fireEvent.change(await screen.findByLabelText('Job'), { target: { value: 'disp_a' } });
    fireEvent.change(screen.getByLabelText('Inspection type'), { target: { value: 'gas_line_pressure_test' } });
    fireEvent.change(screen.getByPlaceholderText('Inspector'), { target: { value: 'Marcus Boyle' } });
    fireEvent.change(screen.getByPlaceholderText('Jurisdiction (AHJ)'), { target: { value: 'City of Springfield Building Dept' } });
    fireEvent.change(screen.getByPlaceholderText('Permit # (optional)'), { target: { value: 'PLM-2026-4471' } });
    fireEvent.change(screen.getByLabelText('Scheduled date'), { target: { value: '2026-08-11' } });

    await waitFor(() => screen.getByText('Schedule Inspection'));
    fireEvent.click(screen.getByText('Schedule Inspection'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('plumbing', 'inspectionAdd', {
      assignmentId: 'disp_a', inspectionType: 'gas_line_pressure_test', inspector: 'Marcus Boyle',
      jurisdiction: 'City of Springfield Building Dept', permitNumber: 'PLM-2026-4471',
      scheduledDate: '2026-08-11', notes: '',
    }));
  });

  it('rejects scheduling without a job, inspector, jurisdiction, or date — no API call, inline error shown', async () => {
    mockRoute({ dispatchBoard: () => ok({ lanes: [], unassigned: [ASSIGNMENT_A], totalAssignments: 1, emergencyCount: 0 }) });
    render(<FieldServiceConsole />);
    await goToInspections();
    await screen.findByLabelText('Job');
    fireEvent.click(screen.getByText('Schedule Inspection'));
    await waitFor(() => expect(screen.getByText(/Select a job to schedule the inspection against/i)).toBeInTheDocument());
    expect(lensRun).not.toHaveBeenCalledWith('plumbing', 'inspectionAdd', expect.anything());
  });

  it('renders pass/fail/pending badges and shows deficiency notes + re-inspection date on a failed inspection', async () => {
    mockRoute({ inspectionList: () => ok({ inspections: [INSPECTION_PASS, INSPECTION_FAIL], count: 2, passCount: 1, failCount: 1, pendingCount: 0 }) });
    render(<FieldServiceConsole />);
    await goToInspections();
    // The badge's `uppercase` class is CSS presentation only — the DOM text
    // content itself is the raw lowercase `result` value.
    expect(await screen.findByText('pass')).toBeInTheDocument();
    expect(screen.getByText('fail')).toBeInTheDocument();
    expect(screen.getByText(/Vent stack undersized for fixture count.*re-inspect 2026-09-09/)).toBeInTheDocument();
  });

  it('an inspection against a since-deleted assignment shows the honest "job no longer on dispatch board" label, not a fabricated title', async () => {
    mockRoute({ inspectionList: () => ok({ inspections: [INSPECTION_PENDING_ORPHAN], count: 1, passCount: 0, failCount: 0, pendingCount: 1 }) });
    render(<FieldServiceConsole />);
    await goToInspections();
    expect(await screen.findByText(/job no longer on dispatch board/i)).toBeInTheDocument();
  });

  it('recording a fail result requires deficiency notes before saving; a valid save calls inspectionUpdate', async () => {
    mockRoute({
      inspectionList: () => ok({ inspections: [INSPECTION_PASS], count: 1, passCount: 1, failCount: 0, pendingCount: 0 }),
      inspectionUpdate: () => ok({ inspection: { ...INSPECTION_PASS, result: 'fail', deficiencyNotes: 'Regulator undersized', reInspectionDate: '2026-08-20' } }),
    });
    render(<FieldServiceConsole />);
    await goToInspections();
    fireEvent.click(await screen.findByText('Record Result'));
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'fail' } });

    // Attempt to save with no deficiency notes — must not call the API.
    fireEvent.click(screen.getByText('Save Result'));
    await waitFor(() => expect(screen.getByText(/Deficiency notes required for a failed inspection/i)).toBeInTheDocument());
    expect(lensRun).not.toHaveBeenCalledWith('plumbing', 'inspectionUpdate', expect.anything());

    fireEvent.change(screen.getByPlaceholderText('Deficiency notes'), { target: { value: 'Regulator undersized' } });
    fireEvent.change(screen.getByLabelText('Re-inspection date'), { target: { value: '2026-08-20' } });
    fireEvent.click(screen.getByText('Save Result'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('plumbing', 'inspectionUpdate', {
      id: 'insp_1', result: 'fail', deficiencyNotes: 'Regulator undersized', reInspectionDate: '2026-08-20',
    }));
  });

  it('recording a pass result does not require deficiency notes and sends them as undefined', async () => {
    mockRoute({
      inspectionList: () => ok({ inspections: [INSPECTION_FAIL], count: 1, passCount: 0, failCount: 1, pendingCount: 0 }),
      inspectionUpdate: () => ok({ inspection: { ...INSPECTION_FAIL, result: 'pass', deficiencyNotes: null, reInspectionDate: null } }),
    });
    render(<FieldServiceConsole />);
    await goToInspections();
    fireEvent.click(await screen.findByText('Record Result'));
    // Default choice for a currently-failed inspection is "fail" — switch to pass.
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'pass' } });
    fireEvent.click(screen.getByText('Save Result'));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('plumbing', 'inspectionUpdate', {
      id: 'insp_2', result: 'pass', deficiencyNotes: undefined, reInspectionDate: undefined,
    }));
  });
});
