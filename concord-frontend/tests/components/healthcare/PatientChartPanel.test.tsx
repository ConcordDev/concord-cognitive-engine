import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));
vi.mock('@/lib/utils', () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(' ') }));

vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const make = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props }),
    );
    Icon.displayName = name;
    return Icon;
  };
  const o: Record<string, unknown> = {};
  for (const k of Object.keys(actual)) {
    if (k[0] >= 'A' && k[0] <= 'Z' && k !== 'createLucideIcon' && k !== 'default') o[k] = make(k);
  }
  return { ...actual, ...o };
});

import { PatientChartPanel } from '@/components/healthcare/PatientChartPanel';

const detail = {
  patient: { id: 'p1', mrn: 'MRN-1', firstName: 'Jane', lastName: 'Roe', dob: '1980-01-01', sex: 'F',
    phone: '555-1111', email: 'jane@x.com', insurancePlan: 'BlueCross', address: '1 Main' },
  problems: [
    { id: 'pr1', name: 'Hypertension', icd10: 'I10', status: 'active', onsetDate: '2024-01-01', resolvedDate: null },
    { id: 'pr2', name: 'Old Issue', icd10: '', status: 'resolved', onsetDate: '2020-01-01', resolvedDate: '2021-01-01' },
  ],
  allergies: [
    { id: 'a1', allergen: 'Penicillin', kind: 'drug', severity: 'life_threatening', reaction: 'Anaphylaxis' },
    { id: 'a2', allergen: 'Pollen', kind: 'environmental', severity: 'mild', reaction: '' },
  ],
  vitals: [
    { id: 'v1', recordedAt: '2026-05-01T10:00:00Z', systolic: 130, diastolic: 85, heartRate: 72,
      tempF: 98.6, spo2: 98, weightLb: 150, heightIn: 65, bmi: 25, flags: ['high_bp'] },
  ],
  labs: [
    { id: 'l1', test: 'glucose', value: 180, unit: 'mg/dL', refLow: 70, refHigh: 140,
      flag: 'critical_high', collectedAt: '2026-05-01T00:00:00Z' },
  ],
  immunizations: [
    { id: 'i1', vaccine: 'COVID-19', manufacturer: 'Pfizer', lotNumber: 'L1', administeredAt: '2026-01-15' },
  ],
  encounters: [
    { id: 'e1', number: 'ENC-1', encounterType: 'office_visit', encounteredAt: '2026-05-01T00:00:00Z',
      chiefComplaint: 'Cough', status: 'signed', signedAt: '2026-05-01' },
  ],
};

function mockDetail(d: unknown) {
  lensRun.mockImplementation((arg: { action: string }) => {
    if (arg.action === 'patients-detail') return Promise.resolve({ data: { ok: true, result: d } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('PatientChartPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<PatientChartPanel patientId="p1" />);
    expect(screen.getByText(/Loading chart…/)).toBeInTheDocument();
  });

  it('shows the not-found state when result is null', async () => {
    mockDetail(null);
    render(<PatientChartPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/Patient not found/)).toBeInTheDocument());
  });

  it('renders the patient banner with critical alerts', async () => {
    mockDetail(detail);
    render(<PatientChartPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText('Roe, Jane')).toBeInTheDocument());
    expect(screen.getByText(/LIFE-THREAT · Penicillin/)).toBeInTheDocument();
    expect(screen.getByText(/critical high · glucose/)).toBeInTheDocument();
  });

  it('defaults to the Problems tab and switches to Allergies, Vitals, Labs, Immunizations, Encounters', async () => {
    mockDetail(detail);
    render(<PatientChartPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText('Hypertension')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Allergies/ }));
    await waitFor(() => expect(screen.getByText('Pollen')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Vitals/ }));
    await waitFor(() => expect(screen.getByText('130/85')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Labs/ }));
    await waitFor(() => expect(screen.getByText(/180 mg\/dL/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Immunizations/ }));
    await waitFor(() => expect(screen.getByText('COVID-19')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Encounters/ }));
    await waitFor(() => expect(screen.getByText(/office visit: Cough/)).toBeInTheDocument());
  });

  it('opens the add-problem form, searches ICD-10 and saves a problem', async () => {
    mockDetail(detail);
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'patients-detail') return Promise.resolve({ data: { ok: true, result: detail } });
      if (arg.action === 'icd10-search') return Promise.resolve({ data: { ok: true, result: { matches: [
        { code: 'E11.9', description: 'Type 2 diabetes' },
      ] } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    render(<PatientChartPanel patientId="p1" />);
    await waitFor(() => screen.getByText('Hypertension'));
    fireEvent.click(screen.getByRole('button', { name: /Add problem/ }));
    fireEvent.change(screen.getByPlaceholderText(/Problem/), { target: { value: 'Diabetes' } });
    fireEvent.change(screen.getByPlaceholderText(/Search ICD-10/), { target: { value: 'dia' } });
    await waitFor(() => expect(screen.getByText('Type 2 diabetes')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Type 2 diabetes'));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Save problem/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'problems-add')).toBe(true));
  });

  it('resolves an active problem', async () => {
    mockDetail(detail);
    render(<PatientChartPanel patientId="p1" />);
    await waitFor(() => screen.getByText('Hypertension'));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Resolve/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'problems-update')).toBe(true));
  });

  it('adds an allergy from the Allergies tab', async () => {
    mockDetail(detail);
    render(<PatientChartPanel patientId="p1" />);
    await waitFor(() => screen.getByText('Hypertension'));
    fireEvent.click(screen.getByRole('button', { name: /Allergies/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add allergy/ }));
    fireEvent.change(screen.getByPlaceholderText(/Allergen/), { target: { value: 'Sulfa' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'allergies-add')).toBe(true));
  });

  it('deletes an allergy after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockDetail(detail);
    render(<PatientChartPanel patientId="p1" />);
    await waitFor(() => screen.getByText('Hypertension'));
    fireEvent.click(screen.getByRole('button', { name: /Allergies/ }));
    lensRun.mockClear();
    fireEvent.click(screen.getAllByText('remove')[0]);
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'allergies-delete')).toBe(true));
    confirmSpy.mockRestore();
  });

  it('records vitals from the Vitals tab', async () => {
    mockDetail(detail);
    render(<PatientChartPanel patientId="p1" />);
    await waitFor(() => screen.getByText('Hypertension'));
    fireEvent.click(screen.getByRole('button', { name: /Vitals/ }));
    fireEvent.click(screen.getByRole('button', { name: /Record vitals/ }));
    const numInputs = document.querySelectorAll('input[type="number"]');
    fireEvent.change(numInputs[0], { target: { value: '120' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Record$/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'vitals-record')).toBe(true));
  });

  it('records a lab from the Labs tab', async () => {
    mockDetail(detail);
    render(<PatientChartPanel patientId="p1" />);
    await waitFor(() => screen.getByText('Hypertension'));
    fireEvent.click(screen.getByRole('button', { name: /Labs/ }));
    fireEvent.click(screen.getByRole('button', { name: /Record lab/ }));
    fireEvent.change(screen.getByPlaceholderText('Value *'), { target: { value: '99' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'labs-record')).toBe(true));
  });

  it('renders empty-state messages when chart collections are empty', async () => {
    mockDetail({ ...detail, problems: [], allergies: [], vitals: [], labs: [], immunizations: [], encounters: [] });
    render(<PatientChartPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No problems documented/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Allergies/ }));
    expect(screen.getByText(/No known allergies/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Immunizations/ }));
    expect(screen.getByText(/No immunizations on file/)).toBeInTheDocument();
  });

  it('handles a detail-fetch error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<PatientChartPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/Patient not found/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
