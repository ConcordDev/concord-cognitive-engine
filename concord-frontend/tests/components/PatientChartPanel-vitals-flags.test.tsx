/// <reference types="@testing-library/jest-dom/vitest" />
// R1-2 wave 3 premium pass on the healthcare lens (ref: Epic Hyperspace
// flowsheet). Two real, data-driven additions to the Vitals table:
//
//   1. The server already computes per-vital clinical flags (bp_critical,
//      bp_high, hr_critical, hypoxia, temp_critical, fever —
//      server/domains/healthcare.js `vitals-record`) but the UI only ever
//      rendered them as a separate pill list off to the side; the BP/HR/
//      Temp/SpO2 cells themselves stayed plain white even for a critical
//      reading — exactly the columns a clinician is scanning. Now the cell
//      itself colors by severity (critical -> rose/bold, high -> amber).
//   2. A simple up/down trend arrow vs. the immediately preceding reading
//      (Epic flowsheet idiom), rendered only when a real prior numeric
//      value exists — never a fabricated baseline.
//
// Also removed a dead `v.heartRate !== null ? '' : ''` ternary in the Pain
// column that always evaluated to the empty string either way.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
}));

import { PatientChartPanel } from '@/components/healthcare/PatientChartPanel';

const PATIENT = {
  id: 'pat_1', mrn: 'MRN-00001', firstName: 'Grace', lastName: 'Hopper',
  dob: '1906-12-09', sex: 'F', phone: '555-0100', email: 'grace@example.com',
  insurancePlan: 'Concord Health PPO', insuranceMemberId: 'CHP-1', address: '1 Compiler Way',
  emergencyContact: '', preferredPharmacy: '',
};

function baseChart(vitals: unknown[]) {
  return {
    patient: PATIENT, problems: [], allergies: [], vitals, labs: [],
    immunizations: [], encounters: [], photoNotes: [] as unknown[],
  };
}

function mockChart(chart: ReturnType<typeof baseChart>) {
  return { data: { ok: true, result: chart, error: null } };
}

function defaultImpl(chart: ReturnType<typeof baseChart>) {
  return async (spec: { domain: string; action: string }) => {
    const { action } = spec;
    if (action === 'patients-detail') return mockChart(chart);
    if (action === 'labs-known-tests') return { data: { ok: true, result: { tests: [] }, error: null } };
    return { data: { ok: true, result: {}, error: null } };
  };
}

async function openVitalsTab() {
  render(<PatientChartPanel patientId="pat_1" />);
  await screen.findByText('Hopper, Grace');
  fireEvent.click(screen.getByRole('button', { name: /Vitals/i }));
}

describe('PatientChartPanel — Vitals flowsheet coloring + trend', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('colors a critical vital in place (not just as a side pill) and shows an up/down trend vs. the prior reading', async () => {
    const current = {
      id: 'v_2', recordedAt: '2026-07-20T10:00:00.000Z',
      systolic: 190, diastolic: 100, heartRate: 35, tempF: 104, spo2: 88,
      weightLb: null, heightIn: null, flags: ['bp_critical', 'hr_critical', 'hypoxia', 'temp_critical'],
    };
    const previous = {
      id: 'v_1', recordedAt: '2026-07-19T10:00:00.000Z',
      systolic: 120, diastolic: 80, heartRate: 90, tempF: 98.6, spo2: 98,
      weightLb: null, heightIn: null, flags: [],
    };
    lensRun.mockImplementation(defaultImpl(baseChart([current, previous])));
    await openVitalsTab();

    // BP trended UP (190 > 120) and is flagged critical.
    const bpUp = screen.getByTitle('higher than prior reading');
    const bpCell = bpUp.closest('td')!;
    expect(bpCell.textContent).toContain('190/100');
    expect(bpCell.className).toContain('text-rose-300');

    // Heart rate trended DOWN (35 < 90) and is flagged critical.
    const hrDown = screen.getByTitle('lower than prior reading');
    const hrCell = hrDown.closest('td')!;
    expect(hrCell.textContent).toContain('35');
    expect(hrCell.className).toContain('text-rose-300');

    // Temp + SpO2 have no prior-value comparison rendered here, but are
    // still flagged critical in place.
    expect(screen.getByText('104').closest('td')!.className).toContain('text-rose-300');
    expect(screen.getByText('88%').closest('td')!.className).toContain('text-rose-300');

    // The flag pills are still there too (additive, not a replacement).
    expect(screen.getByText('bp_critical')).toBeInTheDocument();
  });

  it('colors a "high" (non-critical) flag amber, distinct from critical', async () => {
    const row = {
      id: 'v_1', recordedAt: '2026-07-20T10:00:00.000Z',
      systolic: 145, diastolic: 92, heartRate: 72, tempF: 100.9, spo2: 97,
      weightLb: null, heightIn: null, flags: ['bp_high', 'fever'],
    };
    lensRun.mockImplementation(defaultImpl(baseChart([row])));
    await openVitalsTab();

    const bpCell = screen.getByText('145/92').closest('td')!;
    expect(bpCell.className).toContain('text-amber-300');
    expect(bpCell.className).not.toContain('text-rose-300');

    const tempCell = screen.getByText('100.9').closest('td')!;
    expect(tempCell.className).toContain('text-amber-300');
  });

  it('renders no trend arrow when there is no prior reading to compare against (never a fabricated baseline)', async () => {
    const row = {
      id: 'v_1', recordedAt: '2026-07-20T10:00:00.000Z',
      systolic: 120, diastolic: 80, heartRate: 70, tempF: 98.6, spo2: 99,
      weightLb: null, heightIn: null, flags: [],
    };
    lensRun.mockImplementation(defaultImpl(baseChart([row])));
    await openVitalsTab();

    expect(screen.getByText('120/80').closest('td')!.className).toContain('text-white');
    expect(screen.queryByTitle('higher than prior reading')).not.toBeInTheDocument();
    expect(screen.queryByTitle('lower than prior reading')).not.toBeInTheDocument();
  });

  it('renders no trend arrow when a vital is unchanged from the prior reading', async () => {
    const current = { id: 'v_2', recordedAt: '2026-07-20T10:00:00.000Z', systolic: 120, diastolic: 80, heartRate: 70, tempF: 98.6, spo2: 99, weightLb: null, heightIn: null, flags: [] };
    const previous = { id: 'v_1', recordedAt: '2026-07-19T10:00:00.000Z', systolic: 120, diastolic: 80, heartRate: 70, tempF: 98.6, spo2: 99, weightLb: null, heightIn: null, flags: [] };
    lensRun.mockImplementation(defaultImpl(baseChart([current, previous])));
    await openVitalsTab();

    expect(screen.queryByTitle('higher than prior reading')).not.toBeInTheDocument();
    expect(screen.queryByTitle('lower than prior reading')).not.toBeInTheDocument();
  });
});
