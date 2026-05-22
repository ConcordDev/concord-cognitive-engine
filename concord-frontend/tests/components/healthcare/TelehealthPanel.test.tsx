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

import { TelehealthPanel } from '@/components/healthcare/TelehealthPanel';

const patients = [{ id: 'p1', firstName: 'Jane', lastName: 'Roe', mrn: 'MRN-1' }];
const visits = [
  { id: 'v1', patientId: 'p1', appointmentId: 'a1', provider: 'Dr. Lee', scheduledAt: '2026-05-10T10:00:00Z',
    status: 'scheduled', roomProvider: 'daily', roomUrl: null, joinToken: 'tok_abcdef123456789', startedAt: undefined, endedAt: undefined },
  { id: 'v2', patientId: 'p1', appointmentId: 'a2', provider: 'Dr. Kim', scheduledAt: '2026-05-11T10:00:00Z',
    status: 'in_progress', roomProvider: 'daily', roomUrl: 'https://room', joinToken: 'tok_xyz', startedAt: undefined, endedAt: undefined },
];

describe('TelehealthPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading then empty state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { visits: [], patients: [] } } });
    render(<TelehealthPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No telehealth visits yet/)).toBeInTheDocument());
  });

  it('renders visits with status chips, join link and a join token', async () => {
    lensRun.mockImplementation((d: string, a: string) =>
      Promise.resolve({ data: { ok: true, result: a === 'telehealth-list' ? { visits } : { patients } } }),
    );
    render(<TelehealthPanel patientId="p1" />);
    await waitFor(() => expect(screen.getAllByText(/Roe, Jane/).length).toBe(2));
    expect(screen.getByText('Join room')).toBeInTheDocument();
    expect(screen.getByText(/token: tok_abcdef12/)).toBeInTheDocument();
    expect(screen.getByText('scheduled')).toBeInTheDocument();
    expect(screen.getByText('in progress')).toBeInTheDocument();
  });

  it('starts a scheduled visit', async () => {
    lensRun.mockImplementation((d: string, a: string) =>
      Promise.resolve({ data: { ok: true, result: a === 'telehealth-list' ? { visits } : { patients } } }),
    );
    render(<TelehealthPanel patientId="p1" />);
    await waitFor(() => screen.getByText('Start'));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'telehealth-update-status')).toBe(true));
  });

  it('ends an in-progress visit', async () => {
    lensRun.mockImplementation((d: string, a: string) =>
      Promise.resolve({ data: { ok: true, result: a === 'telehealth-list' ? { visits } : { patients } } }),
    );
    render(<TelehealthPanel patientId="p1" />);
    await waitFor(() => screen.getByText('End'));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /End/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'telehealth-update-status')).toBe(true));
  });

  it('marks a scheduled visit as no-show and cancel', async () => {
    lensRun.mockImplementation((d: string, a: string) =>
      Promise.resolve({ data: { ok: true, result: a === 'telehealth-list' ? { visits } : { patients } } }),
    );
    render(<TelehealthPanel patientId="p1" />);
    await waitFor(() => screen.getByText('No-show'));
    fireEvent.click(screen.getByRole('button', { name: /No-show/ }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'telehealth-update-status')).toBe(true));
  });

  it('toggles the schedule form and creates a visit', async () => {
    lensRun.mockImplementation((d: string, a: string) =>
      Promise.resolve({ data: { ok: true, result: a === 'telehealth-list' ? { visits: [] } : { patients } } }),
    );
    render(<TelehealthPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No telehealth visits/));
    fireEvent.click(screen.getByRole('button', { name: /Schedule visit/ }));
    fireEvent.change(screen.getByPlaceholderText('Provider name'), { target: { value: 'Dr. New' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Create room/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'telehealth-create')).toBe(true));
  });

  it('handles a refresh error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<TelehealthPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No telehealth visits/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
