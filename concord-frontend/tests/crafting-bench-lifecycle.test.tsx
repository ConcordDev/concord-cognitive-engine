/**
 * /lenses/crafting — D2: bench lifecycle.
 *
 * A piece can be renamed (PATCH the bench row, PUT the platform record)
 * and removed (two-step on the row; DELETE on both stores). Typing a
 * name already on the bench shows a notice, not a wall (F6). The name
 * being typed is a lens draft: it survives the page going away and
 * comes back (F5). A platform record still carrying an old title is
 * converged on load.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { isDuplicateName } from '@/components/crafting/bench';

const apiGet = vi.fn();
const apiPost = vi.fn();
const apiPut = vi.fn();
const apiPatch = vi.fn();
const apiDelete = vi.fn();
const lensRunMock = vi.fn(async (domain: string, action: string) => {
  if (domain === 'drafts' && action === 'load') return { data: { result: { ok: true, draft: null } } };
  if (domain === 'drafts' && action === 'save') return { data: { result: { ok: true, savedAt: 1700000000 } } };
  return { data: { result: { ok: true } } };
});
vi.mock('@/lib/api/client', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    post: (...args: unknown[]) => apiPost(...args),
    put: (...args: unknown[]) => apiPut(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
    delete: (...args: unknown[]) => apiDelete(...args),
  },
  lensRun: (...args: unknown[]) => lensRunMock(...(args as [string, string])),
}));

vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'lens-shell' }, children),
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));

import CraftingPage from '@/app/lenses/crafting/page';

function ok(data: Record<string, unknown>) {
  return Promise.resolve({ data });
}

const SPEC = { name: 'Bench hook', output_type: 'piece', output_subtype: 'piece' };
const RECIPE = { id: 'r1', title: 'Bench hook', type: 'recipe', data: { spec: SPEC } };
const ARTIFACT = {
  id: 'a1', domain: 'crafting', type: 'recipe', title: 'Bench hook',
  data: { recipeId: 'r1' }, meta: { visibility: 'private' },
};

function benchWith(artifact: Record<string, unknown> = ARTIFACT) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/crafting/recipes') return ok({ ok: true, recipes: [RECIPE] });
    if (url === '/api/lens/crafting') return ok({ ok: true, artifacts: [artifact], total: 1 });
    return ok({});
  });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  apiPatch.mockReset();
  apiDelete.mockReset();
  lensRunMock.mockClear();
  window.localStorage.clear();
  apiPost.mockResolvedValue(ok({ ok: true }));
  apiPut.mockResolvedValue(ok({ ok: true }));
  apiPatch.mockResolvedValue(ok({ ok: true, recipe: { id: 'r1', name: 'Bench hook II' } }));
  apiDelete.mockResolvedValue(ok({ ok: true }));
});

describe('bench D2 helpers', () => {
  it('flags a duplicate name trimmed and case-insensitive, excluding the piece itself', () => {
    const pieces = [{ id: 'r1', title: 'Bench hook' }];
    expect(isDuplicateName('  bench HOOK ', pieces)).toBe(true);
    expect(isDuplicateName('Bench hook', pieces, 'r1')).toBe(false);
    expect(isDuplicateName('Other', pieces)).toBe(false);
    expect(isDuplicateName('   ', pieces)).toBe(false);
  });
});

describe('bench D2 lifecycle', () => {
  it('renames a piece on both stores and shows the new name', async () => {
    benchWith();
    const { getByRole, getByLabelText, getByText, queryByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Edit' })); });
    const input = getByLabelText('Piece name') as HTMLInputElement;
    expect(input.value).toBe('Bench hook');
    fireEvent.change(input, { target: { value: 'Bench hook II' } });
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Save the name' })); });
    await waitFor(() => expect(getByText('Bench hook II')).toBeInTheDocument());
    expect(queryByText('Bench hook', { exact: true })).toBeNull();
    expect(apiPatch).toHaveBeenCalledWith('/api/crafting/recipes/r1', { title: 'Bench hook II' });
    expect(apiPut).toHaveBeenCalledWith('/api/lens/crafting/a1', { title: 'Bench hook II' });
  });

  it('deletes a piece from both stores after the confirming click', async () => {
    benchWith();
    const { getByRole, getByText, queryByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Delete' })); });
    expect(apiDelete).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Delete this piece?' })); });
    await waitFor(() => expect(queryByText('Bench hook')).toBeNull());
    expect(apiDelete).toHaveBeenCalledWith('/api/crafting/recipes/r1');
    expect(apiDelete).toHaveBeenCalledWith('/api/lens/crafting/a1');
    await waitFor(() => expect(getByText('The bench is clear.')).toBeInTheDocument());
  });

  it('keeps the piece and says so when the delete fails', async () => {
    benchWith();
    apiDelete.mockRejectedValue(new Error('delete down'));
    const { getByRole, getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Delete' })); });
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Delete this piece?' })); });
    await waitFor(() => expect(getByText(/could not be deleted/)).toBeInTheDocument());
    expect(getByText('Bench hook')).toBeInTheDocument();
  });

  it('converges a stale platform title on load', async () => {
    benchWith({ ...ARTIFACT, title: 'Old name' });
    const { getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/api/lens/crafting/a1', { title: 'Bench hook' }),
    );
  });

  it('shows the duplicate notice while typing an existing name, and not for a new one', async () => {
    benchWith();
    const { getByRole, getByLabelText, queryByText, getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    const start = getByRole('button', { name: '+ Start a piece' });
    await act(async () => { fireEvent.click(start); });
    const input = getByLabelText('Piece name');
    fireEvent.change(input, { target: { value: 'bench hook' } });
    await waitFor(() =>
      expect(getByText('A piece with this name is already on the bench.')).toBeInTheDocument(),
    );
    fireEvent.change(input, { target: { value: 'Something else' } });
    await waitFor(() =>
      expect(queryByText('A piece with this name is already on the bench.')).toBeNull(),
    );
  });

  it('keeps the typed name across leaving and returning (draft safety)', async () => {
    benchWith();
    const first = render(<CraftingPage />);
    await waitFor(() => expect(first.getByText('Bench hook')).toBeInTheDocument());
    await act(async () => { fireEvent.click(first.getByRole('button', { name: '+ Start a piece' })); });
    fireEvent.change(first.getByLabelText('Piece name'), { target: { value: 'Unfinished piece' } });
    await waitFor(
      () => expect(window.localStorage.getItem('concord:draft:crafting:benchPieceName') ?? '').toContain('Unfinished piece'),
      { timeout: 5000 },
    );
    first.unmount();
    const second = render(<CraftingPage />);
    await waitFor(() => expect(second.getByText('Bench hook')).toBeInTheDocument());
    await act(async () => { fireEvent.click(second.getByRole('button', { name: '+ Start a piece' })); });
    const input = second.getByLabelText('Piece name') as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe('Unfinished piece'));
  }, 20000);
});
