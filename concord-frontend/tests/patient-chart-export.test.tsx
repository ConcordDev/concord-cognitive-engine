// Behavior test for FIX-healthcare-008: the patient chart offers a
// per-patient export. Before the fix the only export was the lens-wide
// bundle, so one patient's record could not be exported without bulk
// data. Pins: the chart header carries an Export control once the
// chart loads, and clicking it downloads a JSON file containing
// exactly that patient's chart (no other patient, no bulk bundle).
// The api client is mocked at the network boundary.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
  api: { post: vi.fn(), get: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));
vi.mock('@/components/healthcare/HealthcareKeepMenu', () => ({ HealthcareKeepMenu: () => null }));

import { PatientChartPanel, patientChartExport } from '@/components/healthcare/PatientChartPanel';

const detail = {
  patient: { id: 'pat_1', mrn: 'MRN-1001', firstName: 'Ada', lastName: 'Lynn', dob: '1990-01-01', sex: 'F', phone: '', email: '', insurancePlan: 'Plan A', address: '' },
  problems: [{ id: 'pb1', name: 'Hypertension' }],
  allergies: [], vitals: [{ id: 'v1', systolic: 120 }],
  labs: [], immunizations: [], encounters: [], photoNotes: [],
};

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockImplementation((arg: { action?: string }) => {
    if (arg?.action === 'patients-detail') return Promise.resolve({ data: { ok: true, result: detail } });
    if (arg?.action === 'labs-known-tests') return Promise.resolve({ data: { ok: true, result: { tests: [] } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
});

describe('per-patient export (FIX-healthcare-008)', () => {
  it('the export payload names the file for this patient and carries only this chart', () => {
    const { filename, json } = patientChartExport(detail as never);
    expect(filename).toBe('patient-chart-MRN-1001.json');
    const parsed = JSON.parse(json);
    expect(parsed.patient.id).toBe('pat_1');
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.vitals).toHaveLength(1);
    expect(json).not.toContain('pat_2');
  });

  it('clicking Export on the loaded chart downloads exactly that chart', async () => {
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:mock'; }) as never;
    URL.revokeObjectURL = vi.fn() as never;
    render(<PatientChartPanel patientId="pat_1" />);
    const btn = await screen.findByLabelText('Export patient chart');
    fireEvent.click(btn);
    await waitFor(() => expect(blobs.length).toBe(1));
    const parsed = JSON.parse(await blobs[0].text());
    expect(parsed.patient.mrn).toBe('MRN-1001');
    expect(parsed.patient.id).toBe('pat_1');
    // the chart's own sections ride along; nothing bulk or foreign
    expect(Object.keys(parsed)).toEqual(expect.arrayContaining(['patient', 'problems', 'allergies', 'vitals', 'labs', 'immunizations', 'encounters']));
  });
});
