/**
 * /lenses/crafting — D1: bench pieces are canonical lens artifacts.
 *
 * Load joins GET /api/crafting/recipes with GET /api/lens/crafting on
 * data.recipeId; a piece with no artifact is registered (backfill), a
 * piece with one is left alone, and a failed artifact list means
 * "unknown" — never a reason to mint a duplicate. A failed registration
 * on save leaves the piece on the bench with an honest notice.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import {
  artifactsFromList,
  joinPieces,
  pieceArtifactBody,
  specsFromRecipesList,
} from '@/components/crafting/bench';

const apiGet = vi.fn();
const apiPost = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => apiGet(...args), post: (...args: unknown[]) => apiPost(...args) },
  lensRun: vi.fn(),
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

function benchWith(
  recipes: Record<string, unknown>[],
  artifacts: Record<string, unknown>[] | 'fail',
) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/crafting/recipes') return ok({ ok: true, recipes });
    if (url === '/api/lens/crafting') {
      if (artifacts === 'fail') return Promise.reject(new Error('lens list down'));
      return ok({ ok: true, artifacts, total: artifacts.length });
    }
    return ok({});
  });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

describe('bench D1 helpers', () => {
  it('joins pieces to artifacts by recipeId and leaves the rest unjoined', () => {
    const joined = joinPieces(
      [{ id: 'r1', title: 'One' }, { id: 'r2', title: 'Two' }],
      [{ id: 'a1', recipeId: 'r2', published: true }],
    );
    expect(joined[0].artifactId).toBeUndefined();
    expect(joined[1].artifactId).toBe('a1');
    expect(joined[1].published).toBe(true);
  });

  it('reads only well-formed artifact rows, with published state', () => {
    const rows = artifactsFromList({
      artifacts: [
        { id: 'a1', data: { recipeId: 'r1' }, meta: { visibility: 'published' } },
        { id: 'a2', data: {} },
        { data: { recipeId: 'r3' } },
        null,
      ],
    });
    expect(rows).toEqual([{ id: 'a1', recipeId: 'r1', published: true }]);
  });

  it('builds the canonical body with the join key and the spec', () => {
    const body = pieceArtifactBody({ id: 'r1', title: 'Bench hook', spec: SPEC });
    expect(body.type).toBe('recipe');
    expect(body.title).toBe('Bench hook');
    expect(body.data.recipeId).toBe('r1');
    expect(body.data.spec).toEqual(SPEC);
    expect(body.meta.tags).toContain('bench');
  });

  it('extracts specs from the recipes payload by id', () => {
    const specs = specsFromRecipesList({
      recipes: [
        { id: 'r1', data: { spec: SPEC } },
        { id: 'r2', data: {} },
        { id: 'r3' },
      ],
    });
    expect(specs.get('r1')).toEqual(SPEC);
    expect(specs.has('r2')).toBe(false);
    expect(specs.has('r3')).toBe(false);
  });
});

describe('bench D1 load and save', () => {
  it('backfills a legacy piece that has no artifact, carrying its spec', async () => {
    benchWith([{ id: 'r1', title: 'Bench hook', type: 'recipe', data: { spec: SPEC } }], []);
    const bodies: Record<string, unknown>[] = [];
    apiPost.mockImplementation((url: string, body: Record<string, unknown>) => {
      expect(url).toBe('/api/lens/crafting');
      bodies.push(body);
      return ok({ ok: true, artifact: { id: 'a1' } });
    });
    const { getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    await waitFor(() => expect(bodies.length).toBe(1));
    expect((bodies[0].data as { recipeId?: string }).recipeId).toBe('r1');
    expect((bodies[0].data as { spec?: unknown }).spec).toEqual(SPEC);
  });

  it('does not register a piece that already has an artifact', async () => {
    benchWith(
      [{ id: 'r1', title: 'Bench hook', type: 'recipe', data: { spec: SPEC } }],
      [{ id: 'a1', domain: 'crafting', type: 'recipe', title: 'Bench hook', data: { recipeId: 'r1' } }],
    );
    apiPost.mockResolvedValue(ok({ ok: true }));
    const { getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    await act(async () => { await Promise.resolve(); });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('never backfills against a failed artifact list (no duplicates)', async () => {
    benchWith([{ id: 'r1', title: 'Bench hook', type: 'recipe', data: { spec: SPEC } }], 'fail');
    apiPost.mockResolvedValue(ok({ ok: true }));
    const { getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    await act(async () => { await Promise.resolve(); });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('publishes a joined piece through its artifact and shows the state', async () => {
    benchWith(
      [{ id: 'r1', title: 'Bench hook', type: 'recipe', data: { spec: SPEC } }],
      [{ id: 'a1', domain: 'crafting', type: 'recipe', title: 'Bench hook', data: { recipeId: 'r1' }, meta: { visibility: 'private' } }],
    );
    const calls: string[] = [];
    apiPost.mockImplementation((url: string) => {
      calls.push(url);
      return ok({ ok: true, artifact: { id: 'a1' } });
    });
    const { getByText, getByRole, queryByRole } = render(<CraftingPage />);
    const button = await waitFor(() => getByRole('button', { name: 'Publish' }));
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(getByText('Published')).toBeInTheDocument());
    expect(calls).toEqual(['/api/lens/crafting/a1/publish']);
    expect(queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('shows Published with no button for an already-published piece', async () => {
    benchWith(
      [{ id: 'r1', title: 'Bench hook', type: 'recipe', data: { spec: SPEC } }],
      [{ id: 'a1', domain: 'crafting', type: 'recipe', title: 'Bench hook', data: { recipeId: 'r1' }, meta: { visibility: 'published' } }],
    );
    apiPost.mockResolvedValue(ok({ ok: true }));
    const { getByText, queryByRole } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Published')).toBeInTheDocument());
    expect(queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('offers no Publish act for a piece with no artifact yet', async () => {
    benchWith([{ id: 'r1', title: 'Bench hook', type: 'recipe', data: { spec: SPEC } }], 'fail');
    apiPost.mockResolvedValue(ok({ ok: true }));
    const { getByText, queryByRole } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    expect(queryByRole('button', { name: 'Publish' })).toBeNull();
  });

  it('says so when the save lands but registration fails, and keeps the piece', async () => {
    let recipes: Record<string, unknown>[] = [];
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/crafting/recipes') return ok({ ok: true, recipes });
      if (url === '/api/lens/crafting') return ok({ ok: true, artifacts: [], total: 0 });
      return ok({});
    });
    apiPost.mockImplementation((url: string, body: { name: string }) => {
      if (url === '/api/lens/crafting') return Promise.reject(new Error('lens create down'));
      recipes = [{ id: 'r-new', title: body.name, type: 'recipe' }];
      return ok({ ok: true, recipe: { id: 'r-new', name: body.name } });
    });
    const { getByRole, getByLabelText, getByText } = render(<CraftingPage />);
    const button = await waitFor(() => getByRole('button', { name: '+ Start a piece' }));
    await act(async () => { fireEvent.click(button); });
    fireEvent.change(getByLabelText('Piece name'), { target: { value: 'Bench hook' } });
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    await waitFor(() => expect(getByText(/platform record could not be created yet/)).toBeInTheDocument());
  });
});
