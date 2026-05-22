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

import { CareManagementPanel } from '@/components/healthcare/CareManagementPanel';

describe('CareManagementPanel', () => {
  beforeEach(() => { lensRun.mockReset(); });

  it('shows the loading state initially', () => {
    lensRun.mockReturnValue(new Promise(() => {}));
    render(<CareManagementPanel patientId="p1" />);
    expect(screen.getByText(/Loading…/)).toBeInTheDocument();
  });

  it('renders care gaps and a care team when populated', async () => {
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'care-gaps') {
        return Promise.resolve({ data: { ok: true, result: { allClear: false, gaps: [
          { item: 'Mammogram', status: 'overdue', reason: 'Due since 2024', lastDone: '2023-01-15T00:00:00Z' },
          { item: 'Flu shot', status: 'due', reason: 'Annual', lastDone: null },
        ] } } });
      }
      return Promise.resolve({ data: { ok: true, result: { careTeam: [
        { id: 't1', providerName: 'John Smith', role: 'pcp', specialty: 'Family Med' },
      ] } } });
    });
    render(<CareManagementPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText('Mammogram')).toBeInTheDocument());
    expect(screen.getByText('Flu shot')).toBeInTheDocument();
    expect(screen.getByText('overdue')).toBeInTheDocument();
    expect(screen.getByText(/Last done: 2023-01-15/)).toBeInTheDocument();
    expect(screen.getByText('John Smith')).toBeInTheDocument();
  });

  it('shows the all-clear banner when allClear is true', async () => {
    lensRun.mockImplementation((arg: { action: string }) =>
      Promise.resolve({ data: { ok: true, result: arg.action === 'care-gaps' ? { allClear: true, gaps: [] } : { careTeam: [] } } }),
    );
    render(<CareManagementPanel patientId="p1" />);
    await waitFor(() => expect(screen.getByText(/All preventive care is up to date/)).toBeInTheDocument());
    expect(screen.getByText(/No care team members assigned/)).toBeInTheDocument();
  });

  it('handles a refresh error gracefully', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    lensRun.mockRejectedValue(new Error('boom'));
    render(<CareManagementPanel patientId="p1" />);
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
    errSpy.mockRestore();
  });

  it('does not assign a team member when the provider name is blank', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { gaps: [], careTeam: [] } } });
    render(<CareManagementPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No care team members assigned/));
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Assign/ }));
    expect(lensRun).not.toHaveBeenCalled();
  });

  it('assigns a care team member and refreshes', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { gaps: [], careTeam: [] } } });
    render(<CareManagementPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No care team members assigned/));
    fireEvent.change(screen.getByPlaceholderText('Provider name'), { target: { value: 'Dr. Lee' } });
    fireEvent.change(screen.getByPlaceholderText('Specialty (optional)'), { target: { value: 'Cardio' } });
    lensRun.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Assign/ }));
    await waitFor(() => expect(
      lensRun.mock.calls.some((c) => c[0]?.action === 'care-team-assign'),
    ).toBe(true));
  });

  it('removes a care team member', async () => {
    let team = [{ id: 't9', providerName: 'Remove Me', role: 'nurse', specialty: '' }];
    lensRun.mockImplementation((arg: { action: string }) => {
      if (arg.action === 'care-team-remove') { team = []; return Promise.resolve({ data: { ok: true, result: {} } }); }
      return Promise.resolve({ data: { ok: true, result: { gaps: [], careTeam: team } } });
    });
    render(<CareManagementPanel patientId="p1" />);
    await waitFor(() => screen.getByText('Remove Me'));
    fireEvent.click(screen.getByTestId('icon-Trash2').closest('button')!);
    await waitFor(() => expect(screen.queryByText('Remove Me')).not.toBeInTheDocument());
  });

  it('changes the role select before assigning', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { gaps: [], careTeam: [] } } });
    render(<CareManagementPanel patientId="p1" />);
    await waitFor(() => screen.getByText(/No care team members assigned/));
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'specialist' } });
    expect((select as HTMLSelectElement).value).toBe('specialist');
  });
});
