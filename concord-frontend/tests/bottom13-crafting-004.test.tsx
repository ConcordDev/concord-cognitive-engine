/**
 * FIX-crafting-004 — pieces were name-only: the edit form was a single
 * "Piece name" field, and clicking a piece's card opened nothing. A
 * piece is now a project record (materials, steps, status, photo,
 * notes — Ravelry's project shape) stored in data.project on the
 * recipe row via the widened PATCH; clicking the title opens the
 * piece, and the materials-cost / step-progress estimators are
 * computed from the record on the row and in the editor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import {
  emptyProject,
  projectEstimates,
  projectFromUnknown,
  projectsFromRecipesList,
} from '@/components/crafting/bench';

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

const PROJECT = {
  status: 'in_progress',
  photoUrl: '',
  notes: 'For the hall.',
  materials: [{ name: 'Oak board', quantity: 2, unitCost: 12.5 }],
  steps: [
    { label: 'Cut to length', done: true },
    { label: 'Sand and oil', done: false },
  ],
};
const SPEC = { name: 'Bench hook', output_type: 'piece', output_subtype: 'piece' };
const RECIPE = { id: 'r1', title: 'Bench hook', type: 'recipe', data: { spec: SPEC, project: PROJECT } };
const ARTIFACT = {
  id: 'a1', domain: 'crafting', type: 'recipe', title: 'Bench hook',
  data: { recipeId: 'r1' }, meta: { visibility: 'private' },
};

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
  apiPut.mockReset();
  apiPatch.mockReset();
  apiDelete.mockReset();
  lensRunMock.mockClear();
  window.localStorage.clear();
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/crafting/recipes') return ok({ ok: true, recipes: [RECIPE] });
    if (url === '/api/lens/crafting') return ok({ ok: true, artifacts: [ARTIFACT], total: 1 });
    return ok({});
  });
  apiPost.mockResolvedValue(ok({ ok: true }));
  apiPut.mockResolvedValue(ok({ ok: true }));
  apiPatch.mockResolvedValue(ok({ ok: true, recipe: { id: 'r1', name: 'Bench hook', project: PROJECT } }));
  apiDelete.mockResolvedValue(ok({ ok: true }));
});

describe('project record helpers (FIX-crafting-004)', () => {
  it('reads a stored project defensively and computes the estimators from it', () => {
    const map = projectsFromRecipesList({ recipes: [RECIPE] });
    const project = map.get('r1');
    expect(project?.status).toBe('in_progress');
    expect(projectEstimates(project!)).toEqual({ materialsCost: 25, stepsDone: 1, stepsTotal: 2 });
  });

  it('a malformed record degrades to the empty project, never a crash', () => {
    expect(projectFromUnknown(null)).toEqual(emptyProject());
    expect(projectFromUnknown({ status: 'bogus', materials: [{ name: 'X', quantity: -4, unitCost: Number.NaN }, 'junk'], steps: [{ label: 7 }] }))
      .toEqual({ status: 'planning', photoUrl: '', notes: '', materials: [{ name: 'X', quantity: 0, unitCost: 0 }], steps: [] });
  });
});

describe('the bench project editor (FIX-crafting-004)', () => {
  it('the row prices the record, clicking the title opens the piece, and Save sends name + project', async () => {
    render(<CraftingPage />);
    expect(await screen.findByText('$25.00 in materials · 1/2 steps done')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Bench hook' }));
    expect(await screen.findByLabelText('Project status')).toBeInTheDocument();
    expect((screen.getByLabelText('Project status') as HTMLSelectElement).value).toBe('in_progress');
    expect(screen.getByText('Materials est. $25.00 · Steps 1/2 done (50%)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Material 1 quantity'), { target: { value: '3' } });
    expect(screen.getByText('Materials est. $37.50 · Steps 1/2 done (50%)')).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save piece' })); });
    await waitFor(() => expect(apiPatch).toHaveBeenCalled());
    const [url, body] = apiPatch.mock.calls[0] as [string, { title: string; project: typeof PROJECT }];
    expect(url).toBe('/api/crafting/recipes/r1');
    expect(body.title).toBe('Bench hook');
    expect(body.project.materials).toEqual([{ name: 'Oak board', quantity: 3, unitCost: 12.5 }]);
    expect(body.project.steps).toEqual(PROJECT.steps);
    expect(body.project.status).toBe('in_progress');
  });
});
