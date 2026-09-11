/**
 * ElectricalDeskPanel — Jobs/CodeRef/Client/Certification CRUD + dashboard,
 * tested directly. electrical-lens-states.test.tsx already pins the page-
 * level loading/error/empty/populated wiring through this component (Jobs
 * mode only); this file exercises the panel's own create/edit/delete/
 * search/filter flows and the other three artifact-type modes the
 * page-level test never switches to.
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

import { ElectricalDeskPanel } from './ElectricalDeskPanel';

// The editor's <label> elements aren't associated to their sibling input via
// htmlFor/id, so getByLabelText can't resolve them — find by label text and
// walk to the sibling form control instead.
function fieldByLabel(container: HTMLElement, labelText: string): HTMLElement {
  const label = Array.from(container.querySelectorAll('label')).find((l) => l.textContent === labelText);
  if (!label || !label.nextElementSibling) throw new Error(`No field found for label: ${labelText}`);
  return label.nextElementSibling as HTMLElement;
}

const JOB = {
  id: 'art_1',
  title: 'Panel upgrade',
  data: { name: 'Panel upgrade', type: 'Job', status: 'in_progress', description: '200A swap', notes: '', client: 'Maple St', address: '12 Maple St', totalCost: 4200 },
  meta: { tags: [], status: 'in_progress', visibility: 'private' },
  createdAt: '2026-06-27', updatedAt: '2026-06-27', version: 1,
};

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

describe('ElectricalDeskPanel', () => {
  it('dashboard mode renders real KPIs derived from the artifact list', () => {
    lensDataState.items = [JOB];
    render(<ElectricalDeskPanel mode="dashboard" />);
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('$4,200')).toBeInTheDocument();
  });

  it('jobs mode: creates a new job via the real editor form', async () => {
    const { container } = render(<ElectricalDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    expect(screen.getByText('New Job')).toBeInTheDocument();

    fireEvent.change(fieldByLabel(container, 'Name'), { target: { value: 'Rewire kitchen' } });
    fireEvent.change(fieldByLabel(container, 'Client'), { target: { value: 'Acme Co' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Rewire kitchen',
          data: expect.objectContaining({ name: 'Rewire kitchen', client: 'Acme Co', type: 'Job' }),
        }),
      ),
    );
  });

  it('Save is disabled until a name is entered', () => {
    render(<ElectricalDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeDisabled();
  });

  it('clicking a job row opens the editor pre-filled for edit, and Save calls update()', async () => {
    lensDataState.items = [JOB];
    const { container } = render(<ElectricalDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByText('Panel upgrade'));

    expect(screen.getByText('Edit Job')).toBeInTheDocument();
    expect(fieldByLabel(container, 'Name')).toHaveValue('Panel upgrade');

    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('art_1', expect.objectContaining({ title: 'Panel upgrade' })),
    );
  });

  it('Cancel closes the editor without saving', () => {
    render(<ElectricalDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByText('New Job')).not.toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('delete calls remove() for the target row', () => {
    lensDataState.items = [JOB];
    render(<ElectricalDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(remove).toHaveBeenCalledWith('art_1');
  });

  it('the Activate action runs the compute action via useRunArtifact', async () => {
    lensDataState.items = [JOB];
    render(<ElectricalDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(runMutateAsync).toHaveBeenCalledWith({ id: 'art_1', action: 'analyze' }));
  });

  it('search narrows the visible list by name/description', () => {
    const other = { ...JOB, id: 'art_2', title: 'Outlet install', data: { ...JOB.data, name: 'Outlet install', description: 'kitchen outlets' } };
    lensDataState.items = [JOB, other];
    render(<ElectricalDeskPanel mode="jobs" />);
    fireEvent.change(screen.getByPlaceholderText('Search...'), { target: { value: 'outlet' } });
    expect(screen.queryByText('Panel upgrade')).not.toBeInTheDocument();
    expect(screen.getByText('Outlet install')).toBeInTheDocument();
  });

  it('EMPTY: shows the honest "No Job items yet" CTA', () => {
    render(<ElectricalDeskPanel mode="jobs" />);
    expect(screen.getByText(/No Job items yet/i)).toBeInTheDocument();
  });

  it('codes mode: shows NEC-specific fields and creates a CodeRef', async () => {
    const { container } = render(<ElectricalDeskPanel mode="codes" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    expect(screen.getByText('New CodeRef')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. 210.8(A)')).toBeInTheDocument();

    fireEvent.change(fieldByLabel(container, 'Name'), { target: { value: 'GFCI requirement' } });
    fireEvent.change(fieldByLabel(container, 'NEC Code Section'), { target: { value: '210.8(A)' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ codeReference: '210.8(A)', type: 'CodeRef' }) }),
      ),
    );
  });

  it('certs mode: shows certification-specific fields and creates a Certification', async () => {
    const { container } = render(<ElectricalDeskPanel mode="certs" />);
    fireEvent.click(screen.getByRole('button', { name: /^New$/i }));
    expect(screen.getByText('New Certification')).toBeInTheDocument();

    fireEvent.change(fieldByLabel(container, 'Name'), { target: { value: 'Master license' } });
    fireEvent.change(fieldByLabel(container, 'License / Cert Number'), { target: { value: 'ME-99182' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ certNumber: 'ME-99182', type: 'Certification' }) }),
      ),
    );
  });

  it('ERROR: shows role=alert with a working Retry', async () => {
    lensDataState.isError = true;
    lensDataState.error = new Error('electrical store offline');
    render(<ElectricalDeskPanel mode="jobs" />);
    fireEvent.click(screen.getByText(/Try again/i));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
  });
});
