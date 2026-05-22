import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

import { PatientChart, type PatientRecord } from '@/components/healthcare/PatientChart';

const record: PatientRecord = {
  vitals: [
    { channel: 'heart_rate', value: 110, unit: 'bpm', recordedAt: '2026-05-01T10:00:00Z' },
    { channel: 'heart_rate', value: 72, unit: 'bpm', recordedAt: '2026-05-02T10:00:00Z' },
    { channel: 'bp_systolic', value: 118, unit: 'mmHg', recordedAt: '2026-05-02T10:00:00Z' },
  ],
  allergies: [
    { substance: 'Penicillin', reaction: 'Anaphylaxis', severity: 'life_threatening' },
    { substance: 'Pollen', reaction: 'Sneezing', severity: 'mild' },
  ],
  immunizations: [
    { vaccine: 'COVID-19', administeredAt: '2026-01-15', doseNumber: 2, totalDoses: 2 },
  ],
  conditions: [
    { name: 'Hypertension', diagnosedAt: '2024-03-01', status: 'active' },
    { name: 'Bronchitis', diagnosedAt: '2025-12-01', status: 'resolved' },
  ],
};

describe('PatientChart', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<PatientChart />);
    expect(screen.getByText(/Loading chart…/)).toBeInTheDocument();
  });

  it('shows the no-record state when result is null', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: null } });
    render(<PatientChart />);
    await waitFor(() => expect(screen.getByText(/No patient record found/)).toBeInTheDocument());
  });

  it('renders vitals, severe allergy alert, immunizations and conditions', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: record } });
    render(<PatientChart />);
    await waitFor(() => expect(screen.getByText('SEVERE ALLERGY ALERT')).toBeInTheDocument());
    // latest heart rate (72) wins over the earlier 110
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('COVID-19')).toBeInTheDocument();
    expect(screen.getByText('Hypertension')).toBeInTheDocument();
    expect(screen.getByText('Bronchitis')).toBeInTheDocument();
  });

  it('renders NKDA and no-immunization empty states', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {
      vitals: [], allergies: [], immunizations: [], conditions: [],
    } } });
    render(<PatientChart />);
    await waitFor(() => expect(screen.getByText(/No known drug allergies/)).toBeInTheDocument());
    expect(screen.getByText(/No immunizations on record/)).toBeInTheDocument();
  });

  it('does not render the severe-allergy banner when no dangerous allergies exist', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {
      ...record, allergies: [{ substance: 'Pollen', reaction: 'Sneezing', severity: 'mild' }],
    } } });
    render(<PatientChart />);
    await waitFor(() => expect(screen.getByText('Pollen')).toBeInTheDocument());
    expect(screen.queryByText('SEVERE ALLERGY ALERT')).not.toBeInTheDocument();
  });

  it('handles a record-fetch error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<PatientChart />);
    await waitFor(() => expect(screen.getByText(/No patient record found/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
