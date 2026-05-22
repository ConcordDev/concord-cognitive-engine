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

import { RefillsPanel } from '@/components/healthcare/RefillsPanel';

const patients = [{ id: 'p1', firstName: 'Jane', lastName: 'Roe', mrn: 'MRN-1' }];
const refills = [
  { id: 'r1', number: 'R-1', patientId: 'p1', medication: 'Metformin', dose: '500mg', pharmacy: 'CVS',
    notes: '', status: 'requested', requestedAt: '2026-05-01T00:00:00Z', respondedAt: null },
  { id: 'r2', number: 'R-2', patientId: 'p1', medication: 'Lisinopril', dose: '', pharmacy: '',
    notes: '', status: 'approved', requestedAt: '2026-05-02T00:00:00Z', respondedAt: '2026-05-02T01:00:00Z' },
];

describe('RefillsPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading then empty state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { refills: [], patients: [] } } });
    render(<RefillsPanel />);
    await waitFor(() => expect(screen.getByText(/No refill requests in this view/)).toBeInTheDocument());
  });

  it('renders refill requests with the approve/deny buttons', async () => {
    lensRun.mockImplementation((arg: { action: string }) =>
      Promise.resolve({ data: { ok: true, result:
        arg.action === 'refills-list' ? { refills } : { patients } } }),
    );
    render(<RefillsPanel />);
    await waitFor(() => expect(screen.getByText('Metformin')).toBeInTheDocument());
    expect(screen.getByText('Lisinopril')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark filled/ })).toBeInTheDocument();
  });

  it('responds to a refill (approve)', async () => {
    lensRun.mockImplementation((arg: { action: string }) =>
      Promise.resolve({ data: { ok: true, result:
        arg.action === 'refills-list' ? { refills } : { patients } } }),
    );
    render(<RefillsPanel />);
    await waitFor(() => screen.getByText('Metformin'));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'refills-respond')).toBe(true));
  });

  it('changes the status filter', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { refills: [], patients } } });
    render(<RefillsPanel />);
    await waitFor(() => screen.getByText(/No refill requests/));
    const select = screen.getAllByRole('combobox')[0];
    lensRun.mockClear();
    fireEvent.change(select, { target: { value: 'all' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('toggles the create form and does not submit when blank', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { refills: [], patients } } });
    render(<RefillsPanel />);
    await waitFor(() => screen.getByText(/No refill requests/));
    fireEvent.click(screen.getByRole('button', { name: /Request refill/ }));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('creates a refill request when patient and medication are provided', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { refills: [], patients } } });
    render(<RefillsPanel />);
    await waitFor(() => screen.getByText(/No refill requests/));
    fireEvent.click(screen.getByRole('button', { name: /Request refill/ }));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'p1' } });
    fireEvent.change(screen.getByPlaceholderText(/Medication \*/), { target: { value: 'Atorvastatin' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'refills-request')).toBe(true));
  });

  it('handles a refresh error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<RefillsPanel />);
    await waitFor(() => expect(screen.getByText(/No refill requests/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
