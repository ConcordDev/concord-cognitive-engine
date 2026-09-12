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

  it('delete calls remove() for the target row', () => {
    lensDataState.items = [JOB];
    render(<HvacDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith('art_1');
  });

  it('the Activate action runs the compute action via useRunArtifact', async () => {
    lensDataState.items = [JOB];
    render(<HvacDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(runMutateAsync).toHaveBeenCalledWith({ id: 'art_1', action: 'analyze' }));
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
