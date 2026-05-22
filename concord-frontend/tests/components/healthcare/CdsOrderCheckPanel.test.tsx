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

import { CdsOrderCheckPanel } from '@/components/healthcare/CdsOrderCheckPanel';

describe('CdsOrderCheckPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('renders the empty prompt initially', () => {
    render(<CdsOrderCheckPanel patientId="p1" />);
    expect(screen.getByText(/Enter a proposed order to screen it/)).toBeInTheDocument();
  });

  it('does not run a check when the order name is blank', () => {
    render(<CdsOrderCheckPanel patientId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: /Run check/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('shows a clean result when no advisories are returned', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {
      orderName: 'Aspirin 81mg', orderKind: 'medication', alerts: [], alertCount: 0, hasMajor: false, clean: true,
    } } });
    render(<CdsOrderCheckPanel patientId="p1" />);
    fireEvent.change(screen.getByPlaceholderText(/Order name/), { target: { value: 'Aspirin 81mg' } });
    fireEvent.click(screen.getByRole('button', { name: /Run check/ }));
    await waitFor(() => expect(screen.getByText(/clear to place/)).toBeInTheDocument());
  });

  it('shows major and moderate advisories when not clean', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: {
      orderName: 'Lorazepam', orderKind: 'medication', clean: false, hasMajor: true, alertCount: 2,
      alerts: [
        { severity: 'major', code: 'BEERS', message: 'Beers criteria violation' },
        { severity: 'moderate', code: 'DUP', message: 'Possible duplicate order' },
      ],
    } } });
    render(<CdsOrderCheckPanel patientId="p1" />);
    fireEvent.change(screen.getByPlaceholderText(/Order name/), { target: { value: 'Lorazepam' } });
    fireEvent.click(screen.getByRole('button', { name: /Run check/ }));
    await waitFor(() => expect(screen.getByText('Beers criteria violation')).toBeInTheDocument());
    expect(screen.getByText('Possible duplicate order')).toBeInTheDocument();
    expect(screen.getByText('BEERS')).toBeInTheDocument();
  });

  it('runs the check via the Enter key', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { orderName: 'X', orderKind: 'lab', alerts: [], clean: true } } });
    render(<CdsOrderCheckPanel patientId="p1" />);
    const input = screen.getByPlaceholderText(/Order name/);
    fireEvent.change(input, { target: { value: 'CBC' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
  });

  it('does not run on a non-Enter keypress', () => {
    render(<CdsOrderCheckPanel patientId="p1" />);
    const input = screen.getByPlaceholderText(/Order name/);
    fireEvent.change(input, { target: { value: 'CBC' } });
    fireEvent.keyDown(input, { key: 'a' });
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('shows the error from a macro ok:false response', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'cds offline' } });
    render(<CdsOrderCheckPanel patientId="p1" />);
    fireEvent.change(screen.getByPlaceholderText(/Order name/), { target: { value: 'CT' } });
    fireEvent.click(screen.getByRole('button', { name: /Run check/ }));
    await waitFor(() => expect(screen.getByText('cds offline')).toBeInTheDocument());
  });

  it('shows a fallback error message when ok:false has no error string', async () => {
    lensRun.mockResolvedValue({ data: { ok: false } });
    render(<CdsOrderCheckPanel patientId="p1" />);
    fireEvent.change(screen.getByPlaceholderText(/Order name/), { target: { value: 'CT' } });
    fireEvent.click(screen.getByRole('button', { name: /Run check/ }));
    await waitFor(() => expect(screen.getByText('Check failed')).toBeInTheDocument());
  });

  it('shows the thrown error message when the macro rejects', async () => {
    lensRun.mockRejectedValue(new Error('timeout'));
    render(<CdsOrderCheckPanel patientId="p1" />);
    fireEvent.change(screen.getByPlaceholderText(/Order name/), { target: { value: 'CT' } });
    fireEvent.click(screen.getByRole('button', { name: /Run check/ }));
    await waitFor(() => expect(screen.getByText('timeout')).toBeInTheDocument());
  });

  it('changes the order kind select', () => {
    render(<CdsOrderCheckPanel patientId="p1" />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'imaging' } });
    expect((select as HTMLSelectElement).value).toBe('imaging');
  });
});
