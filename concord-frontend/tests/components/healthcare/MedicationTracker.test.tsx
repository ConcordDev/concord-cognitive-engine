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

import { MedicationTracker, type Medication } from '@/components/healthcare/MedicationTracker';

const meds: Medication[] = [
  { id: 'm1', name: 'Metformin', dose: '500mg', schedule: 'twice_daily', prescribedBy: 'Dr. Lee',
    refillRemaining: 30, status: 'active', takenToday: false, dosesScheduledToday: 2, dosesTakenToday: 1 },
  { id: 'm2', name: 'Lisinopril', dose: '10mg', schedule: 'daily', refillRemaining: 5,
    status: 'active', takenToday: false, dosesScheduledToday: 1, dosesTakenToday: 0 },
  { id: 'm3', name: 'Aspirin', dose: '81mg', schedule: 'daily', status: 'paused',
    takenToday: false, dosesScheduledToday: 1, dosesTakenToday: 0 },
];

describe('MedicationTracker', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<MedicationTracker />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('renders the empty state when no medications exist', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { medications: [] } } });
    render(<MedicationTracker />);
    await waitFor(() => expect(screen.getByText(/No medications yet/)).toBeInTheDocument());
  });

  it('renders the medication list, adherence and refill warning banner', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { medications: meds } } });
    render(<MedicationTracker />);
    await waitFor(() => expect(screen.getByText('Metformin')).toBeInTheDocument());
    expect(screen.getByText('Lisinopril')).toBeInTheDocument();
    expect(screen.getByText(/refill needed/)).toBeInTheDocument();
    expect(screen.getByText(/need.*refilling within 7 days/)).toBeInTheDocument();
  });

  it('toggles the add form and does not add when fields are blank', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { medications: [] } } });
    render(<MedicationTracker />);
    await waitFor(() => screen.getByText(/No medications yet/));
    fireEvent.click(screen.getByTitle('Add medication'));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('adds a medication when name and dose are provided', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { medications: [] } } });
    render(<MedicationTracker />);
    await waitFor(() => screen.getByText(/No medications yet/));
    fireEvent.click(screen.getByTitle('Add medication'));
    fireEvent.change(screen.getByPlaceholderText('Medication name'), { target: { value: 'Atorvastatin' } });
    fireEvent.change(screen.getByPlaceholderText(/Dose/), { target: { value: '20mg' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'weekly' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Add to list/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'medications-add')).toBe(true));
  });

  it('logs a dose via the Take button', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { medications: meds } } });
    render(<MedicationTracker />);
    await waitFor(() => screen.getByText('Metformin'));
    lensRun.mockClear();
    fireEvent.click(screen.getAllByRole('button', { name: /Take/ })[0]);
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'medications-log-dose')).toBe(true));
  });

  it('removes a medication optimistically', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { medications: meds } } });
    render(<MedicationTracker />);
    await waitFor(() => screen.getByText('Metformin'));
    lensRun.mockClear();
    lensRun.mockResolvedValue({ data: { ok: true, result: {} } });
    fireEvent.click(screen.getAllByTitle('Remove')[0]);
    await waitFor(() => expect(screen.queryByText('Metformin')).not.toBeInTheDocument());
  });

  it('handles a list-fetch error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<MedicationTracker />);
    await waitFor(() => expect(screen.getByText(/No medications yet/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
