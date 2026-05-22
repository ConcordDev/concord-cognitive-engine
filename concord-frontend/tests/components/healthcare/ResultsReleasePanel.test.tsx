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

import { ResultsReleasePanel } from '@/components/healthcare/ResultsReleasePanel';

const labs = [
  { id: 'l1', number: 'L-1', patientId: 'p1', test: 'Glucose', value: 180, unit: 'mg/dL',
    refLow: 70, refHigh: 140, flag: 'high', collectedAt: '2026-05-01T00:00:00Z', released: false },
  { id: 'l2', number: 'L-2', patientId: 'p1', test: 'Sodium', value: 140, unit: 'mmol/L',
    refLow: 135, refHigh: 145, flag: 'normal', collectedAt: '2026-05-02T00:00:00Z', released: true,
    releasedAt: '2026-05-03T00:00:00Z', providerCommentary: 'All good' },
];

describe('ResultsReleasePanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading then empty state in the clinician view', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { labs: [], abnormalCount: 0 } } });
    render(<ResultsReleasePanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No lab results recorded/)).toBeInTheDocument());
  });

  it('renders labs in the clinician view with release controls', async () => {
    lensRun.mockImplementation((d: string, a: string) =>
      Promise.resolve({ data: { ok: true, result: a === 'labs-list' ? { labs } : { labs: [labs[1]], abnormalCount: 0 } } }),
    );
    render(<ResultsReleasePanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText('Glucose')).toBeInTheDocument());
    expect(screen.getByText('All good')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Release/ })).toBeInTheDocument();
  });

  it('shows the abnormal-count badge when portal view has abnormal results', async () => {
    lensRun.mockImplementation((d: string, a: string) =>
      Promise.resolve({ data: { ok: true, result: a === 'labs-list' ? { labs } : { labs, abnormalCount: 1 } } }),
    );
    render(<ResultsReleasePanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/1 abnormal released/)).toBeInTheDocument());
  });

  it('switches to the patient portal view', async () => {
    lensRun.mockImplementation((d: string, a: string) =>
      Promise.resolve({ data: { ok: true, result: a === 'labs-list' ? { labs } : { labs: [], abnormalCount: 0 } } }),
    );
    render(<ResultsReleasePanel patientId="p1" />);
    await waitFor(() => screen.getByText('Glucose'));
    fireEvent.click(screen.getByRole('button', { name: /Patient portal/ }));
    await waitFor(() => expect(screen.getByText(/No results released to the patient/)).toBeInTheDocument());
  });

  it('releases a lab with commentary', async () => {
    lensRun.mockImplementation((d: string, a: string) =>
      Promise.resolve({ data: { ok: true, result: a === 'labs-list' ? { labs } : { labs: [], abnormalCount: 0 } } }),
    );
    render(<ResultsReleasePanel patientId="p1" />);
    await waitFor(() => screen.getByText('Glucose'));
    fireEvent.change(screen.getByPlaceholderText(/Plain-language commentary/), { target: { value: 'Slightly elevated' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Release/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[1] === 'labs-release')).toBe(true));
  });

  it('handles a refresh error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<ResultsReleasePanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No lab results recorded/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
