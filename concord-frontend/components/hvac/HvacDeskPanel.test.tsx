/**
 * HvacDeskPanel — Job/Estimate/Material/Invoice/Certification CRUD +
 * dashboard, tested directly. hvac-lens-states.test.tsx already pins the
 * page-level loading/error/empty/populated wiring through this component
 * (Jobs mode only); this file exercises the panel's own create/edit/delete/
 * search flows and the other artifact-type modes the page-level test never
 * switches to. Same shape as electrical/ElectricalDeskPanel.test.tsx.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const lensDataState: {
  items: unknown[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} = { items: [], isLoading: false, isError: false, error: null };
const refetch = vi.fn();
const create = vi.fn(() => Promise.resolve({}));
const update = vi.fn(() => Promise.resolve({}));
const remove = vi.fn(() => Promise.resolve({}));
const runMutateAsync = vi.fn(() => Promise.resolve({ ok: true, result: {} }));

vi.mock('@/lib/hooks/use-lens-data', () => ({
  useLensData: () => ({
    items: lensDataState.items,
    isLoading: lensDataState.isLoading,
    isError: lensDataState.isError,
    error: lensDataState.error,
    refetch,
    create,
    update,
    remove,
  }),
}));
vi.mock('@/lib/hooks/use-lens-artifacts', () => ({
  useRunArtifact: () => ({ mutateAsync: runMutateAsync, isPending: false }),
}));
vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(() => Promise.resolve({ data: { ok: true, result: { entries: [], count: 0, total: 0, items: [], priceNote: '' } } })),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => (props: Record<string, unknown>) => React.createElement('div', props, props.children as React.ReactNode) }),
}));

import { HvacDeskPanel } from './HvacDeskPanel';

const JOB = {
  id: 'art_1',
  title: 'AC replacement',
  data: { name: 'AC replacement', type: 'Job', status: 'in_progress', description: '3-ton swap', notes: '', client: 'Acme', totalCost: 4200 },
  meta: { tags: [], status: 'in_progress', visibility: 'private' },
  createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};

function fieldByLabel(container: HTMLElement, labelText: string): HTMLElement {
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent === labelText);
  if (!label || !label.nextElementSibling) throw new Error(`No field found for label: ${labelText}`);
  return label.nextElementSibling as HTMLElement;
}

beforeEach(() => {
  lensDataState.items = [];
  lensDataState.isLoading = false;
  lensDataState.isError = false;
  lensDataState.error = null;
  refetch.mockReset();
  create.mockReset().mockResolvedValue({});
  update.mockReset().mockResolvedValue({});
  remove.mockReset().mockResolvedValue({});
  runMutateAsync.mockReset().mockResolvedValue({ ok: true, result: {} });
});

describe('HvacDeskPanel', () => {
  it('dashboard mode renders real KPIs derived from the artifact list', () => {
    lensDataState.items = [JOB];
    render(<HvacDeskPanel mode="dashboard" />);
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('$4,200')).toBeInTheDocument();
  });

  it('jobs mode: creates a new job via the real editor form', async () => {
    const { container } = render(<HvacDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    fireEvent.change(fieldByLabel(container, 'Name'), { target: { value: 'Furnace tune-up' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Furnace tune-up', data: expect.objectContaining({ name: 'Furnace tune-up', type: 'Job' }) }),
      ),
    );
  });

  it('Save is disabled until a name is entered', () => {
    render(<HvacDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeDisabled();
  });

  it('clicking a job row opens the editor pre-filled for edit, and Save calls update()', async () => {
    lensDataState.items = [JOB];
    const { container } = render(<HvacDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByText('AC replacement'));

    expect(fieldByLabel(container, 'Name')).toHaveValue('AC replacement');
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('art_1', expect.objectContaining({ title: 'AC replacement' })),
    );
  });

  it('Cancel closes the editor without saving', () => {
    render(<HvacDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(create).not.toHaveBeenCalled();
  });

  it('delete is a two-step confirm (F4): the first click arms, the second removes', () => {
    lensDataState.items = [JOB];
    render(<HvacDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(remove).toHaveBeenCalledWith('art_1');
  });

  it('the confirm stays up past 4s so it can be clicked (FIX-hvac-013)', () => {
    vi.useFakeTimers();
    lensDataState.items = [JOB];
    render(<HvacDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    vi.advanceTimersByTime(5000);
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(remove).toHaveBeenCalledWith('art_1');
    vi.useRealTimers();
  });

  it('S1: typing spaces inside the editor never closes it or loses the draft', () => {
    // The filed defect: the editor's backdrop/panel carried keydown-to-click
    // activation, so a Space typed in any field bubbled up, synthetically
    // clicked the backdrop, and closed the dialog mid-fill (five live
    // reproductions; multi-word fills died, single-token fills survived).
    const { container } = render(<HvacDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    const name = fieldByLabel(container, 'Name');
    const desc = fieldByLabel(container, 'Description');
    fireEvent.change(name, { target: { value: 'Furnace tune up' } });
    fireEvent.keyDown(name, { key: ' ' });
    fireEvent.change(desc, { target: { value: 'Replace the blower motor and test' } });
    fireEvent.keyDown(desc, { key: ' ' });
    fireEvent.keyDown(desc, { key: 'Enter' });
    // The editor is still open and both drafts are intact.
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
    expect(name).toHaveValue('Furnace tune up');
    expect(desc).toHaveValue('Replace the blower motor and test');
  });

  it('S2: a client record offers client statuses — a client is not "Scheduled"', () => {
    const { container } = render(<HvacDeskPanel mode="clients" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    const status = fieldByLabel(container, 'Status') as HTMLSelectElement;
    const labels = Array.from(status.options).map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Lead', 'Active', 'Inactive']));
    expect(labels).not.toContain('Scheduled');
  });

  it('has no dead "Activate" button and labels the stats as record counts', () => {
    // The Zap "Activate" button ran a generic analyze whose result was thrown
    // away, and the stats said "Systems" / "Efficiency Avg" for plain record
    // counts. Both were misleading and are gone.
    lensDataState.items = [JOB];
    render(<HvacDeskPanel mode="jobs" />);
    expect(screen.queryByRole('button', { name: 'Activate' })).toBeNull();
    expect(screen.queryByText('Efficiency Avg')).toBeNull();
    expect(screen.queryByText('Systems')).toBeNull();
    expect(screen.getByText('Completed or paid')).toBeInTheDocument();
    expect(runMutateAsync).not.toHaveBeenCalled();
  });

  it('search narrows the visible list by name', () => {
    const other = { ...JOB, id: 'art_2', title: 'Duct cleaning', data: { ...JOB.data, name: 'Duct cleaning' } };
    lensDataState.items = [JOB, other];
    render(<HvacDeskPanel mode="jobs" />);
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'duct' } });
    expect(screen.queryByText('AC replacement')).not.toBeInTheDocument();
    expect(screen.getByText('Duct cleaning')).toBeInTheDocument();
  });

  it('EMPTY: shows the honest "No Job items yet" CTA', () => {
    render(<HvacDeskPanel mode="jobs" />);
    expect(screen.getByText(/No Job items yet/i)).toBeInTheDocument();
  });

  it('materials mode: shows material-specific fields and creates a Material', async () => {
    const { container } = render(<HvacDeskPanel mode="materials" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    fireEvent.change(fieldByLabel(container, 'Name'), { target: { value: 'Copper line set' } });
    fireEvent.change(fieldByLabel(container, 'Quantity'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'Material' }) }),
      ),
    );
  });

  it('invoices mode: shows the Amount field and creates an Invoice', async () => {
    const { container } = render(<HvacDeskPanel mode="invoices" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    fireEvent.change(fieldByLabel(container, 'Name'), { target: { value: 'Invoice #402' } });
    fireEvent.change(fieldByLabel(container, 'Amount'), { target: { value: '850' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ type: 'Invoice' }) }),
      ),
    );
  });

  it('ERROR: shows role=alert with a working Retry', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('hvac store offline');
    render(<HvacDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByText(/Try again/i));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});
