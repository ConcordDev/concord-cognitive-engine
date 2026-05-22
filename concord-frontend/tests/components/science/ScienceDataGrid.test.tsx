import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';


const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ScienceDataGrid } from '@/components/science/ScienceDataGrid';

const DATASET = {
  id: 'd1', name: 'Trial A', columns: ['x', 'y'], rowCount: 2,
  createdAt: 't', rows: [[1, 2], [3, 4]],
};

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockResolvedValue({ data: { ok: true, result: { datasets: [] } } });
});

describe('ScienceDataGrid', () => {
  it('shows empty list state when no datasets', async () => {
    render(<ScienceDataGrid />);
    await waitFor(() => expect(screen.getByText(/No datasets yet/)).toBeInTheDocument());
  });

  it('shows error when dataset-list fails', async () => {
    lensRun.mockResolvedValue({ data: { ok: false, error: 'list down' } });
    render(<ScienceDataGrid />);
    await waitFor(() => expect(screen.getByText('list down')).toBeInTheDocument());
  });

  it('lists datasets and renders col/row counts', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { datasets: [
      { id: 'd1', name: 'Trial A', columns: ['x', 'y'], rowCount: 5, createdAt: 't' },
    ] } } });
    render(<ScienceDataGrid />);
    await waitFor(() => expect(screen.getByText('Trial A')).toBeInTheDocument());
    expect(screen.getByText('2 cols · 5 rows')).toBeInTheDocument();
  });

  it('starts a new dataset grid and edits cells/columns/rows', async () => {
    render(<ScienceDataGrid />);
    await waitFor(() => expect(screen.getByText(/No datasets yet/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /New Dataset/ }));
    // grid now visible with default 2 columns + 1 row
    expect(screen.getByPlaceholderText('Dataset name')).toBeInTheDocument();
    // add a column
    fireEvent.click(screen.getByLabelText('Add column'));
    // add a row
    fireEvent.click(screen.getByText(/Add Row/));
    // rename a column
    const colInputs = screen.getAllByDisplayValue(/Column /);
    fireEvent.change(colInputs[0], { target: { value: 'temp' } });
    expect(screen.getByDisplayValue('temp')).toBeInTheDocument();
    // remove a column
    const removeColBtns = screen.getAllByLabelText('Remove column');
    fireEvent.click(removeColBtns[0]);
    // remove a row
    const removeRowBtns = screen.getAllByLabelText('Remove row');
    fireEvent.click(removeRowBtns[0]);
  });

  it('refuses to save without a name', async () => {
    render(<ScienceDataGrid />);
    await waitFor(() => screen.getByRole('button', { name: /New Dataset/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Dataset/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Dataset name required')).toBeInTheDocument());
  });

  it('refuses to save with an empty column name', async () => {
    render(<ScienceDataGrid />);
    await waitFor(() => screen.getByRole('button', { name: /New Dataset/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Dataset/ }));
    fireEvent.change(screen.getByPlaceholderText('Dataset name'), { target: { value: 'DS' } });
    const colInputs = screen.getAllByDisplayValue(/Column /);
    fireEvent.change(colInputs[0], { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Column names cannot be empty')).toBeInTheDocument());
  });

  it('saves a new dataset (dataset-save) and coerces numeric cells', async () => {
    render(<ScienceDataGrid />);
    await waitFor(() => screen.getByRole('button', { name: /New Dataset/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Dataset/ }));
    fireEvent.change(screen.getByPlaceholderText('Dataset name'), { target: { value: 'DS' } });
    const cellInputs = screen.getAllByRole('textbox').filter((i) =>
      (i as HTMLInputElement).className.includes('font-mono'));
    fireEvent.change(cellInputs[0], { target: { value: '12.5' } });
    fireEvent.change(cellInputs[1], { target: { value: 'hello' } });
    lensRun.mockResolvedValue({ data: { ok: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'dataset-save', expect.objectContaining({
      name: 'DS', columns: ['Column 1', 'Column 2'], rows: [[12.5, 'hello']],
    })));
  });

  it('shows error on a failed save', async () => {
    render(<ScienceDataGrid />);
    await waitFor(() => screen.getByRole('button', { name: /New Dataset/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Dataset/ }));
    fireEvent.change(screen.getByPlaceholderText('Dataset name'), { target: { value: 'DS' } });
    lensRun.mockResolvedValue({ data: { ok: false, error: 'save no' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('save no')).toBeInTheDocument());
  });

  it('opens an existing dataset for editing and updates it', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') {
        return { data: { ok: true, result: { datasets: [
          { id: 'd1', name: 'Trial A', columns: ['x', 'y'], rowCount: 2, createdAt: 't' },
        ] } } };
      }
      if (action === 'dataset-get') return { data: { ok: true, result: { dataset: DATASET } } };
      if (action === 'dataset-update') return { data: { ok: true } };
      return { data: { ok: true, result: {} } };
    });
    render(<ScienceDataGrid />);
    await waitFor(() => expect(screen.getByText('Trial A')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Trial A'));
    await waitFor(() => expect(screen.getByDisplayValue('Trial A')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'dataset-update',
      expect.objectContaining({ id: 'd1' })));
  });

  it('shows error when opening a dataset fails', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') {
        return { data: { ok: true, result: { datasets: [
          { id: 'd1', name: 'Trial A', columns: ['x'], rowCount: 1, createdAt: 't' },
        ] } } };
      }
      return { data: { ok: false, error: 'open fail' } };
    });
    render(<ScienceDataGrid />);
    await waitFor(() => screen.getByText('Trial A'));
    fireEvent.click(screen.getByText('Trial A'));
    await waitFor(() => expect(screen.getByText('open fail')).toBeInTheDocument());
  });

  it('deletes a dataset', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') {
        return { data: { ok: true, result: { datasets: [
          { id: 'd1', name: 'Trial A', columns: ['x'], rowCount: 1, createdAt: 't' },
        ] } } };
      }
      if (action === 'dataset-delete') return { data: { ok: true } };
      return { data: { ok: true, result: { datasets: [] } } };
    });
    render(<ScienceDataGrid />);
    await waitFor(() => screen.getByText('Trial A'));
    fireEvent.click(screen.getByLabelText('Delete dataset'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'dataset-delete', { id: 'd1' }));
  });

  it('shows error on a failed delete', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'dataset-list') {
        return { data: { ok: true, result: { datasets: [
          { id: 'd1', name: 'Trial A', columns: ['x'], rowCount: 1, createdAt: 't' },
        ] } } };
      }
      return { data: { ok: false, error: 'del fail' } };
    });
    render(<ScienceDataGrid />);
    await waitFor(() => screen.getByText('Trial A'));
    fireEvent.click(screen.getByLabelText('Delete dataset'));
    await waitFor(() => expect(screen.getByText('del fail')).toBeInTheDocument());
  });

  it('navigates back from the grid to the list', async () => {
    render(<ScienceDataGrid />);
    await waitFor(() => screen.getByRole('button', { name: /New Dataset/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Dataset/ }));
    expect(screen.getByPlaceholderText('Dataset name')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Back'));
    await waitFor(() => expect(screen.getByText(/No datasets yet/)).toBeInTheDocument());
  });
});
