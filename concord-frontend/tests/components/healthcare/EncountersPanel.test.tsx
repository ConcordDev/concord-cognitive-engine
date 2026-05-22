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

import { EncountersPanel } from '@/components/healthcare/EncountersPanel';

const patient = { id: 'p1', firstName: 'Jane', lastName: 'Roe', mrn: 'MRN-1' };
const openEnc = {
  id: 'e1', number: 'ENC-1', patientId: 'p1', patientName: 'Roe, Jane', encounterType: 'office_visit',
  encounteredAt: '2026-05-01T10:00:00Z', chiefComplaint: 'Cough', subjective: 'S', objective: 'O',
  assessment: 'A', plan: 'P', diagnosisCodes: [], cptCodes: [], provider: 'Dr. Lee', status: 'open', signedAt: null,
};
const signedEnc = { ...openEnc, id: 'e2', number: 'ENC-2', status: 'signed', signedAt: '2026-05-02T00:00:00Z' };

function mockAll(encs: unknown[], sp: unknown[] = []) {
  lensRun.mockImplementation((arg: { action: string }) => {
    if (arg.action === 'encounters-list') return Promise.resolve({ data: { ok: true, result: { encounters: encs } } });
    if (arg.action === 'patients-detail') return Promise.resolve({ data: { ok: true, result: { patient } } });
    if (arg.action === 'smartphrases-list') return Promise.resolve({ data: { ok: true, result: { smartPhrases: sp } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('EncountersPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading then empty state and the no-selection editor placeholder', async () => {
    mockAll([]);
    render(<EncountersPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No encounters yet/)).toBeInTheDocument());
    expect(screen.getByText(/Pick an encounter or start a new one/)).toBeInTheDocument();
  });

  it('renders the encounter list and auto-selects the first one', async () => {
    mockAll([openEnc, signedEnc]);
    render(<EncountersPanel patientId="p1" />);
    // "Cough" appears in both list rows and the editor chief-complaint input.
    await waitFor(() => expect(screen.getAllByText('Cough').length).toBeGreaterThan(0));
    // SOAP editor shows the active encounter
    expect(screen.getByDisplayValue('S')).toBeInTheDocument();
  });

  it('toggles the create form and starts an encounter', async () => {
    mockAll([]);
    render(<EncountersPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No encounters yet/));
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    fireEvent.change(screen.getByPlaceholderText('Chief complaint'), { target: { value: 'Fever' } });
    lensRun.mockClear();
    mockAll([openEnc]);
    fireEvent.click(screen.getByRole('button', { name: /Start encounter/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'encounters-create')).toBe(true));
  });

  it('alerts when the create macro returns ok:false', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    mockAll([]);
    render(<EncountersPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No encounters yet/));
    fireEvent.click(screen.getByRole('button', { name: /New/ }));
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'encounters-create') return Promise.resolve({ data: { ok: false, error: 'bad' } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    fireEvent.click(screen.getByRole('button', { name: /Start encounter/ }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('bad'));
    alertSpy.mockRestore();
  });

  it('saves the active encounter SOAP note', async () => {
    mockAll([openEnc]);
    render(<EncountersPanel patientId="p1" />);
    await waitFor(() => screen.getByDisplayValue('S'));
    lensRun.mockClear();
    mockAll([openEnc]);
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'encounters-save-soap')).toBe(true));
  });

  it('signs the active encounter', async () => {
    mockAll([openEnc]);
    render(<EncountersPanel patientId="p1" />);
    await waitFor(() => screen.getByDisplayValue('S'));
    lensRun.mockClear();
    mockAll([signedEnc]);
    fireEvent.click(screen.getByRole('button', { name: /Sign note/ }));
    await waitFor(() => expect(lensRun.mock.calls.some((c) => c[0]?.action === 'encounters-sign')).toBe(true));
  });

  it('shows signed UI with after-visit summary and renders the AVS modal', async () => {
    mockAll([signedEnc]);
    render(<EncountersPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /After-visit summary/ })).toBeInTheDocument());
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'visit-summary') return Promise.resolve({ data: { ok: true, result: { text: 'AVS body text' } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    fireEvent.click(screen.getByRole('button', { name: /After-visit summary/ }));
    await waitFor(() => expect(screen.getByText('AVS body text')).toBeInTheDocument());
  });

  it('expands a dotphrase field', async () => {
    mockAll([openEnc]);
    render(<EncountersPanel patientId="p1" />);
    await waitFor(() => screen.getByDisplayValue('S'));
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'smartphrases-expand') return Promise.resolve({ data: { ok: true, result: { expanded: 'EXPANDED' } } });
      return Promise.resolve({ data: { ok: true, result: {} } });
    });
    fireEvent.click(screen.getAllByText(/Expand .dotphrases/)[0]);
    await waitFor(() => expect(screen.getByDisplayValue('EXPANDED')).toBeInTheDocument());
  });

  it('renders the SmartPhrases helper strip when smart phrases exist and edits the chief complaint', async () => {
    mockAll([openEnc], [{ id: 's1', name: '.ros', text: 'ROS text' }]);
    render(<EncountersPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText('.ros')).toBeInTheDocument());
    const cc = screen.getByDisplayValue('Cough');
    fireEvent.change(cc, { target: { value: 'Sore throat' } });
    expect((cc as HTMLInputElement).value).toBe('Sore throat');
  });

  it('handles a refresh error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('x'));
    render(<EncountersPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/No encounters yet/)).toBeInTheDocument());
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
