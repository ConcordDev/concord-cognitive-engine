/**
 * Crafting F7 (R4 verdict, crafting.md §9) — split-store persistence:
 * a rename used to update the recipe store and the artifact's title
 * but not the artifact's embedded data.name / data.spec.name, so the
 * exported artifact disagreed with the bench about the piece's name.
 * The rename now converges every name copy, a lagged artifact heals on
 * load, and an empty name on "Save the name" is refused out loud
 * (the leg's UI half — it used to return silently).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { pieceRenameBody, artifactNameLag, type CanonicalArtifactRow } from '@/components/crafting/bench';

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
// The artifact as R4 found it after a rename: title moved, embedded
// name copies still on the pre-rename name.
const DIVERGED = {
  id: 'a1', domain: 'crafting', type: 'recipe', title: 'Bench hook — Edited',
  data: { recipeId: 'r1', name: 'Bench hook', benchPiece: true, spec: SPEC },
  meta: { visibility: 'private' },
};

function benchWith(artifact: Record<string, unknown>, recipe: Record<string, unknown> = RECIPE) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/crafting/recipes') return ok({ ok: true, recipes: [recipe] });
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

describe('F7 helpers', () => {
  it('pieceRenameBody converges title, data.name and data.spec.name', () => {
    expect(pieceRenameBody('New name', SPEC)).toEqual({
      title: 'New name',
      data: { name: 'New name', spec: { name: 'New name', output_type: 'piece', output_subtype: 'piece' } },
    });
    expect(pieceRenameBody('New name')).toEqual({ title: 'New name', data: { name: 'New name' } });
  });

  it('artifactNameLag reads each copy', () => {
    const base: CanonicalArtifactRow = { id: 'a1', recipeId: 'r1', title: 'T', published: false, name: 'T', specName: 'T' };
    expect(artifactNameLag(base, 'T')).toBe(false);
    expect(artifactNameLag({ ...base, title: 'Old' }, 'T')).toBe(true);
    expect(artifactNameLag({ ...base, name: 'Old' }, 'T')).toBe(true);
    expect(artifactNameLag({ ...base, specName: 'Old' }, 'T')).toBe(true);
    expect(artifactNameLag({ id: 'a1', recipeId: 'r1', title: 'T', published: false }, 'T')).toBe(false);
  });
});

describe('F7 rename convergence', () => {
  it('rename sends the converged body to the platform record (R4 re-pass first test, at the wire)', async () => {
    benchWith({
      id: 'a1', domain: 'crafting', type: 'recipe', title: 'Bench hook',
      data: { recipeId: 'r1', name: 'Bench hook', benchPiece: true, spec: SPEC },
      meta: { visibility: 'private' },
    });
    const { getByRole, getByLabelText, getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Edit' })); });
    fireEvent.change(getByLabelText('Piece name'), { target: { value: 'Bench hook II' } });
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Save the name' })); });
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/api/lens/crafting/a1', {
        title: 'Bench hook II',
        data: { name: 'Bench hook II', spec: { name: 'Bench hook II', output_type: 'piece', output_subtype: 'piece' } },
      }),
    );
  });

  it('an artifact lagging only in its embedded copies heals on load', async () => {
    benchWith(DIVERGED, { ...RECIPE, title: 'Bench hook — Edited' });
    const { getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook — Edited')).toBeInTheDocument());
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/api/lens/crafting/a1', {
        title: 'Bench hook — Edited',
        data: {
          name: 'Bench hook — Edited',
          spec: { name: 'Bench hook — Edited', output_type: 'piece', output_subtype: 'piece' },
        },
      }),
    );
  });

  it('an empty name on Save the name is refused out loud, and nothing is written', async () => {
    benchWith({
      id: 'a1', domain: 'crafting', type: 'recipe', title: 'Bench hook',
      data: { recipeId: 'r1', name: 'Bench hook', benchPiece: true, spec: SPEC },
      meta: { visibility: 'private' },
    });
    const { getByRole, getByLabelText, getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Edit' })); });
    fireEvent.change(getByLabelText('Piece name'), { target: { value: '   ' } });
    await act(async () => { fireEvent.click(getByRole('button', { name: 'Save the name' })); });
    await waitFor(() => expect(getByText('A piece needs a name.')).toBeInTheDocument());
    expect(apiPatch).not.toHaveBeenCalled();
    expect(apiPut).not.toHaveBeenCalled();
    // the form is still open on the piece, old name intact on the bench
    expect(getByText('Bench hook')).toBeInTheDocument();
  });
});
