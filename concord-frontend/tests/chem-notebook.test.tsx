/**
 * chem-notebook.test.tsx — the Lab Notebook lifecycle (Chem S4/F6).
 *
 * At the walk: create was silent (the entry counter moving was the only
 * signal), delete vanished a record on one click with no confirmation or
 * receipt, and edit did not exist. These tests pin the built lifecycle:
 * a named two-step delete, an edit that saves through notebook-update,
 * and a receipt for the create.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.hoisted(() => vi.fn());
const calls = vi.hoisted(() => [] as { action: string; input: Record<string, unknown> }[]);

vi.mock('@/lib/api/client', () => ({
  lensRun,
  api: { post: vi.fn(), get: vi.fn() },
  apiHelpers: { lens: { runDomain: vi.fn() } },
}));

import ChemStructureLab from '@/components/chem/ChemStructureLab';

const ENTRY = {
  id: 'lab_fixture1', title: 'PR2CHEM fixture entry', equation: 'H2 + O2 -> H2O',
  procedure: null, observations: 'original observation', yieldPercent: 83,
  tags: ['probe'], createdAt: '2026-10-31T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  lensRun.mockImplementation(async (_domain: string, action: string, input: Record<string, unknown> = {}) => {
    calls.push({ action, input });
    if (action === 'notebook-list') return { data: { ok: true, result: { entries: [ENTRY], count: 1 } } };
    if (action === 'notebook-add') return { data: { ok: true, result: { ...ENTRY, id: 'lab_new', title: String(input.title || '') } } };
    if (action === 'notebook-update') return { data: { ok: true, result: { ...ENTRY, ...input } } };
    if (action === 'notebook-delete') return { data: { ok: true, result: { deleted: input.id } } };
    if (action === 'resolve-structure') return { data: { ok: false, error: 'offline in test' } };
    return { data: { ok: true, result: {} } };
  });
});

async function openNotebook() {
  render(<ChemStructureLab />);
  fireEvent.click(screen.getByRole('button', { name: /Lab Notebook/ }));
  await screen.findByText('PR2CHEM fixture entry');
}

describe('Lab Notebook lifecycle (S4)', () => {
  it('delete asks first, naming the entry, and only then deletes — with a receipt', async () => {
    await openNotebook();
    fireEvent.click(screen.getByRole('button', { name: 'Delete entry PR2CHEM fixture entry' }));
    // First click arms the confirmation; nothing has been deleted.
    expect(calls.filter((c) => c.action === 'notebook-delete')).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: /Confirm delete entry PR2CHEM fixture entry/ }));
    await waitFor(() => expect(calls.filter((c) => c.action === 'notebook-delete')).toHaveLength(1));
    expect(calls.find((c) => c.action === 'notebook-delete')?.input).toEqual({ id: 'lab_fixture1' });
    expect(await screen.findByText(/Entry deleted — "PR2CHEM fixture entry"/)).toBeTruthy();
  });

  it('edit saves through notebook-update and receipts', async () => {
    await openNotebook();
    fireEvent.click(screen.getByRole('button', { name: 'Edit entry PR2CHEM fixture entry' }));
    const obs = await screen.findByDisplayValue('original observation');
    fireEvent.change(obs, { target: { value: 'corrected observation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.filter((c) => c.action === 'notebook-update')).toHaveLength(1));
    const upd = calls.find((c) => c.action === 'notebook-update');
    expect(upd?.input.id).toBe('lab_fixture1');
    expect(upd?.input.observations).toBe('corrected observation');
    expect(await screen.findByText(/Entry updated/)).toBeTruthy();
  });

  it('create receipts by name instead of silence', async () => {
    await openNotebook();
    fireEvent.change(screen.getByPlaceholderText('Reaction title *'), { target: { value: 'Fresh run' } });
    fireEvent.click(screen.getByRole('button', { name: /Add entry/ }));
    expect(await screen.findByText(/Entry saved — "Fresh run"/)).toBeTruthy();
  });
});
