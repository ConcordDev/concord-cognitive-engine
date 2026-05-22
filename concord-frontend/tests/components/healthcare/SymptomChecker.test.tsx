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

import { SymptomChecker, type TriageResult } from '@/components/healthcare/SymptomChecker';

const erResult: TriageResult = {
  severity: 'er',
  reasoning: 'Chest pain warrants emergency evaluation.',
  candidates: [
    { condition: 'Acute coronary syndrome', confidence: 0.72, citations: ['ACC/AHA 2025'] },
    { condition: 'Pulmonary embolism', confidence: 0.21, citations: [] },
  ],
};

describe('SymptomChecker', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders the placeholder result panel initially', () => {
    render(<SymptomChecker />);
    expect(screen.getByText(/Triage result will appear here/)).toBeInTheDocument();
  });

  it('shows an error when neither a region nor description is given', () => {
    render(<SymptomChecker />);
    fireEvent.click(screen.getByRole('button', { name: /Get triage guidance/ }));
    expect(screen.getByText(/Tap a body region or describe/)).toBeInTheDocument();
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('toggles a body region on and off', () => {
    const { container } = render(<SymptomChecker />);
    const circle = container.querySelector('circle[cursor], circle.cursor-pointer') as Element;
    expect(circle).toBeTruthy();
    fireEvent.click(circle);
    expect(screen.getByText(/Selected:/)).toBeInTheDocument();
    fireEvent.click(circle);
    expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument();
  });

  it('runs triage from a free-text description and renders an ER result', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: erResult } });
    render(<SymptomChecker />);
    fireEvent.change(screen.getByPlaceholderText(/Describe what's happening/), { target: { value: 'sharp chest pain' } });
    fireEvent.click(screen.getByRole('button', { name: /Get triage guidance/ }));
    await waitFor(() => expect(screen.getByText(/Seek emergency care now/)).toBeInTheDocument());
    expect(screen.getByText('Acute coronary syndrome')).toBeInTheDocument();
    expect(screen.getByText('ACC/AHA 2025')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
  });

  it('renders the see_doctor severity branch', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ...erResult, severity: 'see_doctor' } } });
    render(<SymptomChecker />);
    fireEvent.change(screen.getByPlaceholderText(/Describe what's happening/), { target: { value: 'mild headache' } });
    fireEvent.click(screen.getByRole('button', { name: /Get triage guidance/ }));
    await waitFor(() => expect(screen.getByText(/See a doctor soon/)).toBeInTheDocument());
  });

  it('renders the self_care severity branch', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ...erResult, severity: 'self_care' } } });
    render(<SymptomChecker />);
    fireEvent.change(screen.getByPlaceholderText(/Describe what's happening/), { target: { value: 'minor cough' } });
    fireEvent.click(screen.getByRole('button', { name: /Get triage guidance/ }));
    await waitFor(() => expect(screen.getByText(/Self-care appropriate/)).toBeInTheDocument());
  });

  it('shows the thrown error message when the macro rejects', async () => {
    lensRun.mockRejectedValue(new Error('triage offline'));
    render(<SymptomChecker />);
    fireEvent.change(screen.getByPlaceholderText(/Describe what's happening/), { target: { value: 'cough' } });
    fireEvent.click(screen.getByRole('button', { name: /Get triage guidance/ }));
    await waitFor(() => expect(screen.getByText('triage offline')).toBeInTheDocument());
  });

  it('updates age and sex inputs', () => {
    render(<SymptomChecker />);
    const age = screen.getByLabelText(/Age/) as HTMLInputElement;
    fireEvent.change(age, { target: { value: '60' } });
    expect(age.value).toBe('60');
    const sex = screen.getByLabelText(/Sex assigned at birth/) as HTMLSelectElement;
    fireEvent.change(sex, { target: { value: 'M' } });
    expect(sex.value).toBe('M');
  });

  it('coerces a non-numeric age entry to zero', () => {
    render(<SymptomChecker />);
    const age = screen.getByLabelText(/Age/) as HTMLInputElement;
    fireEvent.change(age, { target: { value: '' } });
    expect(age.value).toBe('0');
  });
});
