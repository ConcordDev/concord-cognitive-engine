import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';


const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({ lensRun: (...a: unknown[]) => lensRun(...a) }));

import { ScienceNotebook } from '@/components/science/ScienceNotebook';

const ENTRY = {
  id: 'e1', experimentId: 'exp-1', title: 'Day 1', body: 'observed growth',
  attachments: [{ kind: 'link', ref: 'http://x', label: 'paper' }],
  tags: ['bio', 'pcr'], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockResolvedValue({ data: { ok: true, result: { entries: [] } } });
});

describe('ScienceNotebook', () => {
  it('shows the empty state when no entries', async () => {
    render(<ScienceNotebook />);
    await waitFor(() => expect(screen.getByText(/No notebook entries yet/)).toBeInTheDocument());
  });

  it('lists entries with tags and attachment count', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { entries: [ENTRY] } } });
    render(<ScienceNotebook />);
    await waitFor(() => expect(screen.getByText('Day 1')).toBeInTheDocument());
    expect(screen.getByText('bio')).toBeInTheDocument();
    expect(screen.getByText('pcr')).toBeInTheDocument();
  });

  it('opens the new-entry editor and validates the title', async () => {
    render(<ScienceNotebook />);
    await waitFor(() => screen.getByRole('button', { name: /New Entry/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Entry/ }));
    expect(screen.getByText('New Entry')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save Entry/ }));
    await waitFor(() => expect(screen.getByText('Title required')).toBeInTheDocument());
  });

  it('creates an entry with tags + experiment id (notebook-add)', async () => {
    render(<ScienceNotebook />);
    await waitFor(() => screen.getByRole('button', { name: /New Entry/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Entry/ }));
    fireEvent.change(screen.getByPlaceholderText('Entry title'), { target: { value: 'My Note' } });
    fireEvent.change(screen.getByPlaceholderText(/Observations/), { target: { value: 'text' } });
    fireEvent.change(screen.getByPlaceholderText('Tags, comma separated'), { target: { value: 'a, b' } });
    fireEvent.change(screen.getByPlaceholderText(/Linked experiment/), { target: { value: 'exp-9' } });
    lensRun.mockResolvedValue({ data: { ok: true, result: { entries: [] } } });
    fireEvent.click(screen.getByRole('button', { name: /Save Entry/ }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'notebook-add', expect.objectContaining({
      title: 'My Note', tags: ['a', 'b'], experimentId: 'exp-9',
    })));
  });

  it('shows error when save fails', async () => {
    render(<ScienceNotebook />);
    await waitFor(() => screen.getByRole('button', { name: /New Entry/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Entry/ }));
    fireEvent.change(screen.getByPlaceholderText('Entry title'), { target: { value: 'X' } });
    lensRun.mockResolvedValue({ data: { ok: false, error: 'add fail' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Entry/ }));
    await waitFor(() => expect(screen.getByText('add fail')).toBeInTheDocument());
  });

  it('adds, edits and removes attachments', async () => {
    render(<ScienceNotebook />);
    await waitFor(() => screen.getByRole('button', { name: /New Entry/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Entry/ }));
    fireEvent.click(screen.getByText(/Add attachment/));
    const kindSelect = screen.getByRole('combobox');
    fireEvent.change(kindSelect, { target: { value: 'dataset' } });
    fireEvent.change(screen.getByPlaceholderText('label'), { target: { value: 'ds1' } });
    fireEvent.change(screen.getByPlaceholderText(/reference/), { target: { value: 'ref-1' } });
    expect(screen.getByDisplayValue('ds1')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove attachment'));
    expect(screen.queryByPlaceholderText('label')).not.toBeInTheDocument();
  });

  it('opens an existing entry for editing (notebook-update)', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'notebook-list') return { data: { ok: true, result: { entries: [ENTRY] } } };
      if (action === 'notebook-update') return { data: { ok: true } };
      return { data: { ok: true, result: { entries: [] } } };
    });
    render(<ScienceNotebook />);
    await waitFor(() => screen.getByText('Day 1'));
    fireEvent.click(screen.getByText('Day 1'));
    await waitFor(() => expect(screen.getByText('Edit Entry')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Day 1')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Save Entry/ }));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'notebook-update',
      expect.objectContaining({ id: 'e1' })));
  });

  it('closes the editor with the back button', async () => {
    render(<ScienceNotebook />);
    await waitFor(() => screen.getByRole('button', { name: /New Entry/ }));
    fireEvent.click(screen.getByRole('button', { name: /New Entry/ }));
    fireEvent.click(screen.getByLabelText('Back'));
    await waitFor(() => expect(screen.getByText(/No notebook entries yet/)).toBeInTheDocument());
  });

  it('deletes an entry', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'notebook-list') return { data: { ok: true, result: { entries: [ENTRY] } } };
      if (action === 'notebook-delete') return { data: { ok: true } };
      return { data: { ok: true, result: { entries: [] } } };
    });
    render(<ScienceNotebook />);
    await waitFor(() => screen.getByText('Day 1'));
    fireEvent.click(screen.getByLabelText('Delete entry'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'notebook-delete', { id: 'e1' }));
  });

  it('keeps the entry listed when delete fails', async () => {
    lensRun.mockImplementation(async (_d: string, action: string) => {
      if (action === 'notebook-list') return { data: { ok: true, result: { entries: [ENTRY] } } };
      return { data: { ok: false, error: 'del fail' } };
    });
    render(<ScienceNotebook />);
    await waitFor(() => screen.getByText('Day 1'));
    fireEvent.click(screen.getByLabelText('Delete entry'));
    await waitFor(() => expect(lensRun).toHaveBeenCalledWith('science', 'notebook-delete',
      expect.objectContaining({ id: 'e1' })));
    expect(screen.getByText('Day 1')).toBeInTheDocument();
  });
});
