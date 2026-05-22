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

import { PatientsPanel } from '@/components/healthcare/PatientsPanel';

const patients = [
  { id: 'p1', mrn: 'MRN-1', firstName: 'Jane', lastName: 'Roe', dob: '1980-04-10', sex: 'F',
    phone: '555-1111', email: 'jane@x.com', insurancePlan: 'BlueCross', insuranceMemberId: 'M1' },
  { id: 'p2', mrn: 'MRN-2', firstName: 'John', lastName: 'Doe', dob: '', sex: 'M',
    phone: '', email: '', insurancePlan: '', insuranceMemberId: '' },
];

describe('PatientsPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading then empty state', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { patients: [] } } });
    render(<PatientsPanel onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No patients yet/)).toBeInTheDocument());
  });

  it('renders the patient list with age and insurance', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { patients } } });
    render(<PatientsPanel onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Roe, Jane')).toBeInTheDocument());
    expect(screen.getByText('Doe, John')).toBeInTheDocument();
    expect(screen.getByText(/BlueCross/)).toBeInTheDocument();
  });

  it('selects a patient when a row is clicked', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { patients } } });
    const onSelect = vi.fn();
    render(<PatientsPanel onSelect={onSelect} />);
    await waitFor(() => screen.getByText('Roe, Jane'));
    fireEvent.click(screen.getByText('Roe, Jane'));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('searches as the query input changes', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { patients } } });
    render(<PatientsPanel onSelect={vi.fn()} />);
    await waitFor(() => screen.getByText('Roe, Jane'));
    lensRun.mockClear();
    fireEvent.change(screen.getByPlaceholderText(/Search name or MRN/), { target: { value: 'Roe' } });
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('toggles the create form and does not create when names are blank', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { patients: [] } } });
    render(<PatientsPanel onSelect={vi.fn()} />);
    await waitFor(() => screen.getByText(/No patients yet/));
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Register patient/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('creates a patient and auto-selects the new id', async () => {
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'patients-create') {
        return Promise.resolve({ data: { ok: true, result: { patient: { id: 'p99' } } } });
      }
      return Promise.resolve({ data: { ok: true, result: { patients: [] } } });
    });
    const onSelect = vi.fn();
    render(<PatientsPanel onSelect={onSelect} />);
    await waitFor(() => screen.getByText(/No patients yet/));
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    fireEvent.change(screen.getByPlaceholderText(/First name/), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByPlaceholderText(/Last name/), { target: { value: 'Smith' } });
    fireEvent.click(screen.getByRole('button', { name: /Register patient/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('p99'));
  });

  it('alerts when the create macro returns ok:false', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'patients-create') return Promise.resolve({ data: { ok: false, error: 'duplicate MRN' } });
      return Promise.resolve({ data: { ok: true, result: { patients: [] } } });
    });
    render(<PatientsPanel onSelect={vi.fn()} />);
    await waitFor(() => screen.getByText(/No patients yet/));
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    fireEvent.change(screen.getByPlaceholderText(/First name/), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByPlaceholderText(/Last name/), { target: { value: 'Smith' } });
    fireEvent.click(screen.getByRole('button', { name: /Register patient/ }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('duplicate MRN'));
    alertSpy.mockRestore();
  });

  it('handles a list error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<PatientsPanel onSelect={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No patients yet/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
