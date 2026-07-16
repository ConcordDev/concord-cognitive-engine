/**
 * GardenStudio — Inspections + Certifications tabs (Wave 4 gap closure).
 *
 * Closes the "Inspections and Certs" gap named in
 * docs/lens-specs/landscaping-capability-map.md's "Investigated and
 * honestly deferred" section: no macro/table modeled a walkthrough/
 * inspection record, and TRADE_CERTS was a static UI dropdown with zero
 * backing storage. This pins the real, job-linked (Inspections) and
 * crew-roster (Certifications) tabs against the real
 * inspection-add/inspection-list/inspection-update and
 * cert-add/cert-list/cert-remove macros in server/domains/landscaping.js —
 * modeled on masonry's precedent (ContractorSuiteInspectionsCerts.test.tsx)
 * and adapted to this lens's job-list job store + landscaping-trade
 * inspection/cert categories.
 *
 * Hermetic: lensRun + next/image + @/components/viz are mocked. No
 * network, no server boot. GardenStudio only exports the shell (no
 * per-tab exports), so these tests drive it exactly like a user would —
 * render the studio, click the tab button, interact.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/components/viz', () => ({
  TimelineView: () => null,
  ChartKit: () => null,
}));
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => React.createElement('img', props),
}));

import { GardenStudio } from '@/components/landscaping/GardenStudio';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function fail(error: string) {
  return Promise.resolve({ data: { ok: false, error, result: null } });
}

const EMPTY_INSPECTION_LIST = { inspections: [], count: 0, passCount: 0, failCount: 0, pendingCount: 0 };
const EMPTY_JOB_LIST = { jobs: [], count: 0, lanes: [], unassigned: [], scheduledCount: 0, inProgressCount: 0, completedCount: 0, cancelledCount: 0 };
const EMPTY_CERT_LIST = { certifications: [], count: 0, roster: [], expiredCount: 0, expiringSoonCount: 0 };

const JOB_A = { id: 'job_a', title: 'Backyard reno', client: '', clientId: null, address: '', proposalId: null, bedId: null, crew: '', date: '2026-08-01', startHour: 8, durationHours: 4, notes: '', status: 'scheduled', createdAt: '2026-07-01T00:00:00.000Z' };

const INSPECTION_PASS = {
  id: 'insp_1', number: 'INSP-001', jobId: 'job_a', jobTitle: 'Backyard reno', jobFound: true,
  inspectionType: 'final_walkthrough', inspector: 'Jane Alvarez', scheduledDate: '2026-08-02',
  result: 'pass', deficiencyNotes: null, reInspectionDate: null, notes: '', completedAt: '2026-08-02T12:00:00.000Z',
};

const INSPECTION_FAIL = {
  id: 'insp_2', number: 'INSP-002', jobId: 'job_a', jobTitle: 'Backyard reno', jobFound: true,
  inspectionType: 'irrigation_system_check', inspector: 'Pat Osei', scheduledDate: '2026-08-05',
  result: 'fail', deficiencyNotes: 'Zone 3 valve leaking at the manifold', reInspectionDate: '2026-08-12',
  notes: '', completedAt: '2026-08-05T12:00:00.000Z',
};

const CERT_VALID = {
  id: 'cert_1', crewMemberName: 'Mike Alvarez', certType: 'OSHA 10-Hour Construction Safety',
  issuingBody: 'OSHA', licenseNumber: 'OSHA10-4471', issueDate: '2024-01-10', expiryDate: '2099-01-10',
  expiryStatus: 'valid', isExpired: false,
};
const CERT_EXPIRED = {
  id: 'cert_2', crewMemberName: 'Sam Reed', certType: 'ISA Certified Arborist',
  issuingBody: 'International Society of Arboriculture', licenseNumber: '', issueDate: null, expiryDate: '2000-01-01',
  expiryStatus: 'expired', isExpired: true,
};
const CERT_EXPIRING = {
  id: 'cert_3', crewMemberName: 'Mike Alvarez', certType: 'State Pesticide / Herbicide Applicator License',
  issuingBody: 'State Dept. of Agriculture', licenseNumber: '', issueDate: null, expiryDate: '2026-07-20',
  expiryStatus: 'expiring_soon', isExpired: false,
};

// Fallback for any macro call a given test doesn't care about (e.g. the
// on-mount layout-list / bed-list calls from other GardenStudio tabs).
function mockRoute(behaviors: Record<string, () => Promise<unknown>>) {
  lensRun.mockImplementation((_domain: string, action: string) => {
    const fn = behaviors[action];
    if (fn) return fn();
    return ok({});
  });
}

async function goToTab(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('GardenStudio — Inspections tab', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders the empty state and a hint when nothing is scheduled', async () => {
    mockRoute({ 'inspection-list': () => ok(EMPTY_INSPECTION_LIST), 'job-list': () => ok(EMPTY_JOB_LIST) });
    render(<GardenStudio />);
    await goToTab(/^Inspections$/);
    expect(await screen.findByText(/No inspections scheduled yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No jobs on the Jobs tab yet/i)).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('landscaping', 'inspection-list', {});
    expect(lensRun).toHaveBeenCalledWith('landscaping', 'job-list', {});
  });

  it('the job picker is a real select sourced from job-list, not free text', async () => {
    mockRoute({ 'inspection-list': () => ok(EMPTY_INSPECTION_LIST), 'job-list': () => ok({ ...EMPTY_JOB_LIST, jobs: [JOB_A] }) });
    render(<GardenStudio />);
    await goToTab(/^Inspections$/);
    const select = (await screen.findByLabelText('Job')) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.textContent)).toContain('Backyard reno');
    const typeSelect = screen.getByLabelText('Inspection type') as HTMLSelectElement;
    expect(typeSelect.tagName).toBe('SELECT');
    expect(Array.from(typeSelect.options).map((o) => o.value)).toContain('irrigation_system_check');
    expect(Array.from(typeSelect.options).map((o) => o.value)).toContain('plant_health_establishment');
  });

  it('scheduling an inspection calls inspection-add with the picked job, type, inspector, and date', async () => {
    mockRoute({
      'inspection-list': () => ok(EMPTY_INSPECTION_LIST),
      'job-list': () => ok({ ...EMPTY_JOB_LIST, jobs: [JOB_A] }),
      'inspection-add': () => ok({ inspection: INSPECTION_PASS }),
    });
    render(<GardenStudio />);
    await goToTab(/^Inspections$/);
    await screen.findByLabelText('Job');

    fireEvent.change(screen.getByLabelText('Job'), { target: { value: 'job_a' } });
    fireEvent.change(screen.getByLabelText('Inspection type'), { target: { value: 'final_walkthrough' } });
    fireEvent.change(screen.getByPlaceholderText('Jane Alvarez'), { target: { value: 'Jane Alvarez' } });
    fireEvent.change(screen.getByLabelText('Scheduled date'), { target: { value: '2026-08-02' } });

    await waitFor(() => expect(screen.getByText(/Schedule inspection/i).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(/Schedule inspection/i));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('landscaping', 'inspection-add', {
        jobId: 'job_a', inspectionType: 'final_walkthrough', inspector: 'Jane Alvarez', scheduledDate: '2026-08-02', notes: '',
      }),
    );
  });

  it('a pending inspection shows a Pending badge; a passed one shows Pass', async () => {
    mockRoute({
      'inspection-list': () =>
        ok({
          inspections: [{ ...INSPECTION_PASS, id: 'p1', number: 'INSP-003', result: 'pending' }, INSPECTION_PASS],
          count: 2, passCount: 1, failCount: 0, pendingCount: 1,
        }),
      'job-list': () => ok({ ...EMPTY_JOB_LIST, jobs: [JOB_A] }),
    });
    render(<GardenStudio />);
    await goToTab(/^Inspections$/);
    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Pass')).toBeInTheDocument();
  });

  it('a failed inspection surfaces deficiency notes and the re-inspection date', async () => {
    mockRoute({
      'inspection-list': () => ok({ inspections: [INSPECTION_FAIL], count: 1, passCount: 0, failCount: 1, pendingCount: 0 }),
      'job-list': () => ok({ ...EMPTY_JOB_LIST, jobs: [JOB_A] }),
    });
    render(<GardenStudio />);
    await goToTab(/^Inspections$/);
    expect(await screen.findByText('Fail')).toBeInTheDocument();
    expect(screen.getByText(/Zone 3 valve leaking at the manifold/)).toBeInTheDocument();
    expect(screen.getByText(/re-inspect 2026-08-12/)).toBeInTheDocument();
  });

  it('a job that no longer exists is shown honestly instead of a stale title', async () => {
    mockRoute({
      'inspection-list': () => ok({ inspections: [{ ...INSPECTION_PASS, jobFound: false, jobTitle: null }], count: 1, passCount: 1, failCount: 0, pendingCount: 0 }),
      'job-list': () => ok(EMPTY_JOB_LIST),
    });
    render(<GardenStudio />);
    await goToTab(/^Inspections$/);
    expect(await screen.findByText(/job no longer on schedule/i)).toBeInTheDocument();
  });

  it('recording a Fail result requires deficiency notes before the Save button is enabled, then calls inspection-update', async () => {
    mockRoute({
      'inspection-list': () =>
        ok({ inspections: [{ ...INSPECTION_PASS, result: 'pending', deficiencyNotes: null, reInspectionDate: null }], count: 1, passCount: 0, failCount: 0, pendingCount: 1 }),
      'job-list': () => ok({ ...EMPTY_JOB_LIST, jobs: [JOB_A] }),
      'inspection-update': () => ok({ inspection: { ...INSPECTION_FAIL } }),
    });
    render(<GardenStudio />);
    await goToTab(/^Inspections$/);
    fireEvent.click(await screen.findByText(/Record result/i));

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'fail' } });
    const saveBtn = screen.getByText(/Save result/i).closest('button')!;
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('What failed and why'), { target: { value: 'Bad valve' } });
    expect(saveBtn).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText('Re-inspection date'), { target: { value: '2026-09-01' } });
    fireEvent.click(saveBtn);

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('landscaping', 'inspection-update', {
        id: 'insp_1', result: 'fail', deficiencyNotes: 'Bad valve', reInspectionDate: '2026-09-01',
      }),
    );
  });

  it('recording a Pass result calls inspection-update with only the result', async () => {
    mockRoute({
      'inspection-list': () =>
        ok({ inspections: [{ ...INSPECTION_PASS, result: 'pending', deficiencyNotes: null, reInspectionDate: null }], count: 1, passCount: 0, failCount: 0, pendingCount: 1 }),
      'job-list': () => ok({ ...EMPTY_JOB_LIST, jobs: [JOB_A] }),
      'inspection-update': () => ok({ inspection: { ...INSPECTION_PASS } }),
    });
    render(<GardenStudio />);
    await goToTab(/^Inspections$/);
    fireEvent.click(await screen.findByText(/Record result/i));
    fireEvent.click(screen.getByText(/Save result/i));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('landscaping', 'inspection-update', {
        id: 'insp_1', result: 'pass', deficiencyNotes: undefined, reInspectionDate: undefined,
      }),
    );
  });

  it('scheduling an inspection surfaces the server error and does not silently succeed', async () => {
    mockRoute({
      'inspection-list': () => ok(EMPTY_INSPECTION_LIST),
      'job-list': () => ok({ ...EMPTY_JOB_LIST, jobs: [JOB_A] }),
      'inspection-add': () => fail('jobId required — inspections must be scheduled against a job'),
    });
    render(<GardenStudio />);
    await goToTab(/^Inspections$/);
    fireEvent.change(await screen.findByLabelText('Job'), { target: { value: 'job_a' } });
    fireEvent.change(screen.getByPlaceholderText('Jane Alvarez'), { target: { value: 'Jane Alvarez' } });
    fireEvent.change(screen.getByLabelText('Scheduled date'), { target: { value: '2026-08-02' } });
    fireEvent.click(screen.getByText(/Schedule inspection/i));
    expect(await screen.findByText(/jobId required/i)).toBeInTheDocument();
  });
});

describe('GardenStudio — Certifications tab', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders the empty state when no certifications are on file', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST) });
    render(<GardenStudio />);
    await goToTab(/^Certifications$/);
    expect(await screen.findByText(/No certifications on file yet/i)).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('landscaping', 'cert-list', {});
  });

  it('offers a real certification-category picker with named landscaping-trade categories, not a JSON textarea', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST) });
    render(<GardenStudio />);
    await goToTab(/^Certifications$/);
    expect(screen.queryByRole('textbox', { name: /json/i })).not.toBeInTheDocument();
    const select = (await screen.findByLabelText('Certification type')) as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('ISA Certified Arborist');
    expect(values).toContain('State Pesticide / Herbicide Applicator License');
    expect(values).toContain('Irrigation Association Certified Irrigation Technician (CIT)');
    expect(values).toContain('Other');
  });

  it('picking "Other" reveals a free-text certification-name field', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST) });
    render(<GardenStudio />);
    await goToTab(/^Certifications$/);
    const select = await screen.findByLabelText('Certification type');
    expect(screen.queryByPlaceholderText('Certification name')).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'Other' } });
    expect(screen.getByPlaceholderText('Certification name')).toBeInTheDocument();
  });

  it('rejects adding without a crew member name or issuing body (inline error, no API call)', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST) });
    render(<GardenStudio />);
    await goToTab(/^Certifications$/);
    await screen.findByLabelText('Certification type');
    fireEvent.click(screen.getByText(/Add certification/i));
    expect(await screen.findByText('Crew member name required')).toBeInTheDocument();
    expect(lensRun).not.toHaveBeenCalledWith('landscaping', 'cert-add', expect.anything());
  });

  it('adding a certification calls cert-add with the crew member, picked category, and issuing body', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST), 'cert-add': () => ok({ certification: CERT_VALID }) });
    render(<GardenStudio />);
    await goToTab(/^Certifications$/);
    await screen.findByLabelText('Certification type');

    fireEvent.change(screen.getByPlaceholderText('Mike Alvarez'), { target: { value: 'Mike Alvarez' } });
    fireEvent.change(screen.getByLabelText('Certification type'), { target: { value: 'ISA Certified Arborist' } });
    fireEvent.change(screen.getByPlaceholderText('ISA'), { target: { value: 'International Society of Arboriculture' } });

    fireEvent.click(screen.getByText(/Add certification/i));

    await waitFor(() =>
      expect(lensRun).toHaveBeenCalledWith('landscaping', 'cert-add', {
        crewMemberName: 'Mike Alvarez', certType: 'ISA Certified Arborist', issuingBody: 'International Society of Arboriculture',
        licenseNumber: '', issueDate: undefined, expiryDate: undefined,
      }),
    );
  });

  it('groups certifications by crew member into a roster and shows EXPIRED / EXPIRING SOON badges', async () => {
    mockRoute({
      'cert-list': () =>
        ok({
          certifications: [CERT_VALID, CERT_EXPIRED, CERT_EXPIRING], count: 3,
          roster: ['Mike Alvarez', 'Sam Reed'], expiredCount: 1, expiringSoonCount: 1,
        }),
    });
    render(<GardenStudio />);
    await goToTab(/^Certifications$/);
    expect(await screen.findByText('Mike Alvarez')).toBeInTheDocument();
    expect(screen.getByText('Sam Reed')).toBeInTheDocument();
    expect(screen.getByText('EXPIRED')).toBeInTheDocument();
    expect(screen.getByText('EXPIRING SOON')).toBeInTheDocument();
    // Mike Alvarez has 2 certs (valid + expiring); Sam Reed has 1 (expired).
    const mikeCard = screen.getByText('Mike Alvarez').closest('div')!.parentElement!;
    expect(within(mikeCard).getByText('(2)')).toBeInTheDocument();
  });

  it('removing a certification calls cert-remove with the id, then reloads', async () => {
    mockRoute({
      'cert-list': () => ok({ certifications: [CERT_VALID], count: 1, roster: ['Mike Alvarez'], expiredCount: 0, expiringSoonCount: 0 }),
      'cert-remove': () => ok({ deleted: 'cert_1' }),
    });
    render(<GardenStudio />);
    await goToTab(/^Certifications$/);
    const removeBtn = await screen.findByLabelText('Remove OSHA 10-Hour Construction Safety certification for Mike Alvarez');
    fireEvent.click(removeBtn);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('landscaping', 'cert-remove', { id: 'cert_1' }));
  });

  it('adding a certification surfaces the real backend error and does not silently succeed', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST), 'cert-add': () => fail('handler_error') });
    render(<GardenStudio />);
    await goToTab(/^Certifications$/);
    await screen.findByLabelText('Certification type');
    fireEvent.change(screen.getByPlaceholderText('Mike Alvarez'), { target: { value: 'Anyone' } });
    fireEvent.change(screen.getByPlaceholderText('ISA'), { target: { value: 'OSHA' } });
    fireEvent.click(screen.getByText(/Add certification/i));
    expect(await screen.findByText('handler_error')).toBeInTheDocument();
  });
});
