/**
 * ContractorSuite — Inspections + Certifications tabs (Wave 4 gap closure).
 *
 * Closes the "Inspections and Certifications" gap named in
 * docs/lens-specs/masonry-capability-map.md's "Investigated and honestly
 * deferred" section: the removed fake generic-CRUD dashboard used to fake
 * these two tabs; this pins the real, job-linked (Inspections) and
 * crew-roster (Certifications) replacements against the real
 * inspection-add/list/update and cert-add/list/remove macros in
 * server/domains/masonry.js.
 *
 * Hermetic: lensRun + next/image + @/components/viz are mocked. No
 * network, no server boot. ContractorSuite only exports the shell (no
 * per-tab exports), so these tests drive it exactly like a user would —
 * render the suite, click the tab button, interact.
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

import { ContractorSuite } from '@/components/masonry/ContractorSuite';

function ok(result: unknown) {
  return Promise.resolve({ data: { ok: true, result } });
}
function fail(error: string) {
  return Promise.resolve({ data: { ok: false, error, result: null } });
}

const EMPTY_INSPECTION_LIST = { inspections: [], passCount: 0, failCount: 0, pendingCount: 0 };
const EMPTY_SCHEDULE_LIST = { jobs: [], crewLoad: {} };
const EMPTY_CERT_LIST = { certifications: [], roster: [], expiredCount: 0, expiringSoonCount: 0 };

const JOB_A = { id: 'sch_a', title: 'Retaining wall — Elm St', startDate: '2026-08-01', durationDays: 3, crew: [], status: 'scheduled', forecastLowF: 55, precipChancePct: 0, weather: { risk: 'clear', advisories: [] } };

const INSPECTION_PASS = {
  id: 'insp_1', number: 'INSP-001', jobId: 'sch_a', jobTitle: 'Retaining wall — Elm St', jobFound: true,
  inspectionType: 'footing_foundation', inspector: 'Jane AHJ', scheduledDate: '2026-08-02',
  result: 'pass', deficiencyNotes: null, reInspectionDate: null, notes: '', completedAt: '2026-08-02T12:00:00.000Z',
};

const INSPECTION_FAIL = {
  id: 'insp_2', number: 'INSP-002', jobId: 'sch_a', jobTitle: 'Retaining wall — Elm St', jobFound: true,
  inspectionType: 'grout_mortar_qa', inspector: 'Bob AHJ', scheduledDate: '2026-08-05',
  result: 'fail', deficiencyNotes: 'Mortar joints undersized on north face', reInspectionDate: '2026-08-12',
  notes: '', completedAt: '2026-08-05T12:00:00.000Z',
};

const CERT_VALID = {
  id: 'cert_1', crewMemberName: 'Mike Alvarez', certType: 'OSHA 10-Hour Construction Safety',
  issuingBody: 'OSHA', licenseNumber: 'OSHA10-4471', issueDate: '2024-01-10', expiryDate: '2099-01-10',
  expiryStatus: 'valid', isExpired: false,
};
const CERT_EXPIRED = {
  id: 'cert_2', crewMemberName: 'Sam Reed', certType: 'Confined Space Entry',
  issuingBody: 'OSHA', licenseNumber: '', issueDate: null, expiryDate: '2000-01-01',
  expiryStatus: 'expired', isExpired: true,
};
const CERT_EXPIRING = {
  id: 'cert_3', crewMemberName: 'Mike Alvarez', certType: 'Forklift Operator Certification',
  issuingBody: 'NCCCO', licenseNumber: '', issueDate: null, expiryDate: '2026-07-20',
  expiryStatus: 'expiring_soon', isExpired: false,
};

// Fallback for any macro call a given test doesn't care about (e.g. the
// on-mount takeoff-list call from the default Takeoff tab).
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

describe('ContractorSuite — Inspections tab', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders the empty state and a disabled job picker when nothing is scheduled', async () => {
    mockRoute({ 'inspection-list': () => ok(EMPTY_INSPECTION_LIST), 'schedule-list': () => ok(EMPTY_SCHEDULE_LIST) });
    render(<ContractorSuite />);
    await goToTab(/^Inspections$/);
    expect(await screen.findByText(/No inspections scheduled yet/i)).toBeInTheDocument();
    expect(screen.getByText(/No jobs on the Schedule tab yet/i)).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('masonry', 'inspection-list', {});
    expect(lensRun).toHaveBeenCalledWith('masonry', 'schedule-list', {});
  });

  it('the job picker is a real select sourced from schedule-list, not free text', async () => {
    mockRoute({ 'inspection-list': () => ok(EMPTY_INSPECTION_LIST), 'schedule-list': () => ok({ jobs: [JOB_A], crewLoad: {} }) });
    render(<ContractorSuite />);
    await goToTab(/^Inspections$/);
    const select = await screen.findByLabelText('Job') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect(Array.from(select.options).map((o) => o.textContent)).toContain('Retaining wall — Elm St');
    const typeSelect = screen.getByLabelText('Inspection type') as HTMLSelectElement;
    expect(typeSelect.tagName).toBe('SELECT');
    expect(Array.from(typeSelect.options).map((o) => o.value)).toContain('grout_mortar_qa');
  });

  it('scheduling an inspection calls inspection-add with the picked job, type, inspector, and date', async () => {
    mockRoute({
      'inspection-list': () => ok(EMPTY_INSPECTION_LIST),
      'schedule-list': () => ok({ jobs: [JOB_A], crewLoad: {} }),
      'inspection-add': () => ok(INSPECTION_PASS),
    });
    render(<ContractorSuite />);
    await goToTab(/^Inspections$/);
    await screen.findByLabelText('Job');

    fireEvent.change(screen.getByLabelText('Job'), { target: { value: 'sch_a' } });
    fireEvent.change(screen.getByLabelText('Inspection type'), { target: { value: 'footing_foundation' } });
    fireEvent.change(screen.getByPlaceholderText('Jane AHJ'), { target: { value: 'Jane AHJ' } });
    fireEvent.change(screen.getByLabelText('Scheduled date'), { target: { value: '2026-08-02' } });

    await waitFor(() => expect(screen.getByText(/Schedule inspection/i).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(/Schedule inspection/i));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('masonry', 'inspection-add', {
      jobId: 'sch_a', inspectionType: 'footing_foundation', inspector: 'Jane AHJ', scheduledDate: '2026-08-02', notes: '',
    }));
  });

  it('a pending inspection shows a Pending badge; a passed one shows Pass', async () => {
    mockRoute({
      'inspection-list': () => ok({ inspections: [{ ...INSPECTION_PASS, id: 'p1', number: 'INSP-003', result: 'pending' }, INSPECTION_PASS], passCount: 1, failCount: 0, pendingCount: 1 }),
      'schedule-list': () => ok({ jobs: [JOB_A], crewLoad: {} }),
    });
    render(<ContractorSuite />);
    await goToTab(/^Inspections$/);
    expect(await screen.findByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Pass')).toBeInTheDocument();
  });

  it('a failed inspection surfaces deficiency notes and the re-inspection date', async () => {
    mockRoute({
      'inspection-list': () => ok({ inspections: [INSPECTION_FAIL], passCount: 0, failCount: 1, pendingCount: 0 }),
      'schedule-list': () => ok({ jobs: [JOB_A], crewLoad: {} }),
    });
    render(<ContractorSuite />);
    await goToTab(/^Inspections$/);
    expect(await screen.findByText('Fail')).toBeInTheDocument();
    expect(screen.getByText(/Mortar joints undersized on north face/)).toBeInTheDocument();
    expect(screen.getByText(/re-inspect 2026-08-12/)).toBeInTheDocument();
  });

  it('recording a Fail result requires deficiency notes before the Save button is enabled, then calls inspection-update', async () => {
    mockRoute({
      'inspection-list': () => ok({ inspections: [{ ...INSPECTION_PASS, result: 'pending', deficiencyNotes: null, reInspectionDate: null }], passCount: 0, failCount: 0, pendingCount: 1 }),
      'schedule-list': () => ok({ jobs: [JOB_A], crewLoad: {} }),
      'inspection-update': () => ok({ ...INSPECTION_FAIL }),
    });
    render(<ContractorSuite />);
    await goToTab(/^Inspections$/);
    fireEvent.click(await screen.findByText(/Record result/i));

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'fail' } });
    const saveBtn = screen.getByText(/Save result/i).closest('button')!;
    expect(saveBtn).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('What failed and why'), { target: { value: 'Bad joints' } });
    expect(saveBtn).not.toBeDisabled();

    fireEvent.change(screen.getByLabelText('Re-inspection date'), { target: { value: '2026-09-01' } });
    fireEvent.click(saveBtn);

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('masonry', 'inspection-update', {
      id: 'insp_1', result: 'fail', deficiencyNotes: 'Bad joints', reInspectionDate: '2026-09-01',
    }));
  });
});

describe('ContractorSuite — Certifications tab', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('renders the empty state when no certifications are on file', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST) });
    render(<ContractorSuite />);
    await goToTab(/^Certifications$/);
    expect(await screen.findByText(/No certifications on file yet/i)).toBeInTheDocument();
    expect(lensRun).toHaveBeenCalledWith('masonry', 'cert-list', {});
  });

  it('offers a real certification-category picker with named masonry-trade categories, not a JSON textarea', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST) });
    render(<ContractorSuite />);
    await goToTab(/^Certifications$/);
    expect(screen.queryByRole('textbox', { name: /json/i })).not.toBeInTheDocument();
    const select = await screen.findByLabelText('Certification type') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toContain('Confined Space Entry');
    expect(values).toContain('Silica Exposure Control Training');
    expect(values).toContain('NCMA Certified Mason');
    expect(values).toContain('Other');
  });

  it('picking "Other" reveals a free-text certification-name field', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST) });
    render(<ContractorSuite />);
    await goToTab(/^Certifications$/);
    const select = await screen.findByLabelText('Certification type');
    expect(screen.queryByPlaceholderText('Certification name')).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'Other' } });
    expect(screen.getByPlaceholderText('Certification name')).toBeInTheDocument();
  });

  it('rejects adding without a crew member name or issuing body (inline error, no API call)', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST) });
    render(<ContractorSuite />);
    await goToTab(/^Certifications$/);
    await screen.findByLabelText('Certification type');
    fireEvent.click(screen.getByText(/Add certification/i));
    expect(await screen.findByText('Crew member name required')).toBeInTheDocument();
    expect(lensRun).not.toHaveBeenCalledWith('masonry', 'cert-add', expect.anything());
  });

  it('adding a certification calls cert-add with the crew member, picked category, and issuing body', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST), 'cert-add': () => ok(CERT_VALID) });
    render(<ContractorSuite />);
    await goToTab(/^Certifications$/);
    await screen.findByLabelText('Certification type');

    fireEvent.change(screen.getByPlaceholderText('Mike Alvarez'), { target: { value: 'Mike Alvarez' } });
    fireEvent.change(screen.getByLabelText('Certification type'), { target: { value: 'Confined Space Entry' } });
    fireEvent.change(screen.getByPlaceholderText('OSHA'), { target: { value: 'OSHA' } });

    fireEvent.click(screen.getByText(/Add certification/i));

    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('masonry', 'cert-add', {
      crewMemberName: 'Mike Alvarez', certType: 'Confined Space Entry', issuingBody: 'OSHA',
      licenseNumber: '', issueDate: undefined, expiryDate: undefined,
    }));
  });

  it('groups certifications by crew member into a roster and shows EXPIRED / EXPIRING SOON badges', async () => {
    mockRoute({
      'cert-list': () => ok({
        certifications: [CERT_VALID, CERT_EXPIRED, CERT_EXPIRING],
        roster: ['Mike Alvarez', 'Sam Reed'],
        expiredCount: 1, expiringSoonCount: 1,
      }),
    });
    render(<ContractorSuite />);
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
      'cert-list': () => ok({ certifications: [CERT_VALID], roster: ['Mike Alvarez'], expiredCount: 0, expiringSoonCount: 0 }),
      'cert-remove': () => ok({ deleted: 'cert_1' }),
    });
    render(<ContractorSuite />);
    await goToTab(/^Certifications$/);
    const removeBtn = await screen.findByLabelText('Remove OSHA 10-Hour Construction Safety certification for Mike Alvarez');
    fireEvent.click(removeBtn);
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('masonry', 'cert-remove', { id: 'cert_1' }));
  });

  it('adding a certification surfaces the server error and does not silently succeed', async () => {
    mockRoute({ 'cert-list': () => ok(EMPTY_CERT_LIST), 'cert-add': () => fail('crewMemberName required') });
    render(<ContractorSuite />);
    await goToTab(/^Certifications$/);
    await screen.findByLabelText('Certification type');
    fireEvent.change(screen.getByPlaceholderText('Mike Alvarez'), { target: { value: 'Anyone' } });
    fireEvent.change(screen.getByPlaceholderText('OSHA'), { target: { value: 'OSHA' } });
    fireEvent.click(screen.getByText(/Add certification/i));
    expect(await screen.findByText('Could not save the certification.')).toBeInTheDocument();
  });
});
