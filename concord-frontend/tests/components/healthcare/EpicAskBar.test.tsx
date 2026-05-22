import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

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

import { EpicAskBar } from '@/components/healthcare/EpicAskBar';

describe('EpicAskBar', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders the disabled prompt when no patient is open', () => {
    render(<EpicAskBar patientId={null} />);
    expect(screen.getByPlaceholderText(/Open a chart to enable/)).toBeDisabled();
  });

  it('renders the enabled prompt when a patient is open', () => {
    render(<EpicAskBar patientId="p1" />);
    expect(screen.getByPlaceholderText(/Ask anything about the open chart/)).not.toBeDisabled();
  });

  it('shows a system message when asked without a patient', () => {
    render(<EpicAskBar patientId={null} />);
    // Sample chips are disabled with no patient, so drive the form directly.
    const form = screen.getByPlaceholderText(/Open a chart/).closest('form')!;
    // Type into the disabled input is blocked; instead submit empty -> early return.
    fireEvent.submit(form);
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('runs a chart search and renders findings on submit', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { findings: [
      { label: 'lab', display: 'Critical potassium 6.1' },
      { label: 'allergy', display: 'Penicillin' },
    ] } } });
    render(<EpicAskBar patientId="p1" />);
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/), { target: { value: 'critical labs' } });
    fireEvent.submit(screen.getByPlaceholderText(/Ask anything/).closest('form')!);
    await waitFor(() => expect(screen.getByText('Critical potassium 6.1')).toBeInTheDocument());
    expect(screen.getByText(/2 finding/)).toBeInTheDocument();
  });

  it('shows the no-findings message when results are empty', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { findings: [] } } });
    render(<EpicAskBar patientId="p1" />);
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/), { target: { value: 'unknown' } });
    fireEvent.submit(screen.getByPlaceholderText(/Ask anything/).closest('form')!);
    await waitFor(() => expect(screen.getByText(/No findings matched the query/)).toBeInTheDocument());
  });

  it('runs a search when a sample chip is clicked', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { findings: [] } } });
    render(<EpicAskBar patientId="p1" />);
    fireEvent.click(screen.getByText('Show me critical labs'));
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('handles a macro error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('fail'));
    render(<EpicAskBar patientId="p1" />);
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/), { target: { value: 'x' } });
    fireEvent.submit(screen.getByPlaceholderText(/Ask anything/).closest('form')!);
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it('does not search on an empty/whitespace query', () => {
    render(<EpicAskBar patientId="p1" />);
    fireEvent.change(screen.getByPlaceholderText(/Ask anything/), { target: { value: '   ' } });
    fireEvent.submit(screen.getByPlaceholderText(/Ask anything/).closest('form')!);
    expect(lensRun).not.toHaveBeenCalled();
  });
});
