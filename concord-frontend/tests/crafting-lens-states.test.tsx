/**
 * /lenses/crafting — the bench.
 *
 * The page loads GET /api/crafting/recipes and saves with
 * POST /api/crafting/design, then requires that same id on the next GET.
 * It does not call the locker, favorites, character, or balance endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { pieceDesignBody } from '@/components/crafting/bench';

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

const USER = {
  ok: true,
  user: { id: 'u1', username: 'ramaj', email: 'r@example.com', role: 'user' },
};

function authAndRecipes(recipes: Record<string, unknown>[]) {
  apiGet.mockImplementation((url: string) => {
    if (url === '/api/auth/me') return ok(USER);
    if (url === '/api/crafting/recipes') return ok({ ok: true, recipes });
    return ok({});
  });
}

beforeEach(() => {
  apiGet.mockReset();
  apiPost.mockReset();
});

describe('crafting bench', () => {
  it('shows a status while the recipe list is in flight', async () => {
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/auth/me') return ok(USER);
      if (url === '/api/crafting/recipes') return new Promise(() => {});
      return ok({});
    });
    const { getByRole } = render(<CraftingPage />);
    await waitFor(() => expect(getByRole('status').textContent).toMatch(/Opening the bench/));
  });

  it('greets the signed-in person and says the bench is clear', async () => {
    authAndRecipes([]);
    const { getByRole, getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByRole('heading', { name: 'The piece on the bench, Ramaj' })).toBeInTheDocument());
    expect(getByText('The bench is clear.')).toBeInTheDocument();
    expect(apiGet.mock.calls.some((call) => call[0] === '/api/personal-locker/dtus')).toBe(false);
    expect(apiGet.mock.calls.some((call) => String(call[0]).includes('/api/crafting/character/'))).toBe(false);
    expect(apiGet.mock.calls.some((call) => call[0] === '/api/economy/balance')).toBe(false);
  });

  it('shows the server error and retries the recipe list', async () => {
    let fail = true;
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/auth/me') return ok(USER);
      if (url === '/api/crafting/recipes') {
        return fail ? Promise.reject(new Error('feed exploded')) : ok({ ok: true, recipes: [] });
      }
      return ok({});
    });
    const { getByRole, getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByRole('alert').textContent).toMatch(/feed exploded/));

    const before = apiGet.mock.calls.filter((call) => call[0] === '/api/crafting/recipes').length;
    fail = false;
    await act(async () => { fireEvent.click(getByText('Retry')); });
    await waitFor(() =>
      expect(apiGet.mock.calls.filter((call) => call[0] === '/api/crafting/recipes').length).toBeGreaterThan(before));
    await waitFor(() => expect(getByText('The bench is clear.')).toBeInTheDocument());
  });

  it('renders a recipe title returned by the list', async () => {
    authAndRecipes([{ id: 'r1', title: 'Bench hook', type: 'recipe' }]);
    const { getByText, queryByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    expect(queryByText('The bench is clear.')).toBeNull();
  });

  it('skips a row that has no title', async () => {
    authAndRecipes([{ id: 'r1', title: '' }]);
    const { getByText } = render(<CraftingPage />);
    await waitFor(() => expect(getByText('The bench is clear.')).toBeInTheDocument());
  });

  it('does not post until the piece has a name', async () => {
    authAndRecipes([]);
    const { getByRole, getByLabelText } = render(<CraftingPage />);
    const button = await waitFor(() => getByRole('button', { name: '+ Start a piece' }));
    await act(async () => { fireEvent.click(button); });
    expect(getByLabelText('Piece name')).toBeInTheDocument();
    await act(async () => { fireEvent.click(button); });
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('posts the piece and shows it only after the list reads it back', async () => {
    let recipes: Record<string, unknown>[] = [];
    apiGet.mockImplementation((url: string) => {
      if (url === '/api/auth/me') return ok(USER);
      if (url === '/api/crafting/recipes') return ok({ ok: true, recipes });
      return ok({});
    });
    apiPost.mockImplementation((url: string, body: { name: string }) => {
      expect(url).toBe('/api/crafting/design');
      expect(body).toEqual(pieceDesignBody('Bench hook'));
      recipes = [{ id: 'r-new', title: body.name, type: 'recipe' }];
      return ok({ ok: true, recipe: { id: 'r-new', name: body.name } });
    });

    const { getByRole, getByLabelText, getByText, queryByText } = render(<CraftingPage />);
    const button = await waitFor(() => getByRole('button', { name: '+ Start a piece' }));
    await act(async () => { fireEvent.click(button); });
    fireEvent.change(getByLabelText('Piece name'), { target: { value: 'Bench hook' } });
    await act(async () => { fireEvent.click(button); });

    await waitFor(() => expect(getByText('Bench hook')).toBeInTheDocument());
    expect(queryByText('Piece name')).toBeNull();
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('shows the validator error and does not invent a row', async () => {
    authAndRecipes([]);
    apiPost.mockRejectedValue({
      response: { data: { ok: false, error: 'Recipe design is not valid in this world', errors: ['Skill crafting requires level 10'] } },
    });
    const { getByRole, getByLabelText } = render(<CraftingPage />);
    const button = await waitFor(() => getByRole('button', { name: '+ Start a piece' }));
    await act(async () => { fireEvent.click(button); });
    fireEvent.change(getByLabelText('Piece name'), { target: { value: 'Iron Sword' } });
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(getByRole('alert').textContent).toMatch(/Skill crafting requires level 10/));
    expect(getByRole('heading', { name: 'The piece on the bench, Ramaj' })).toBeInTheDocument();
  });

  it('says so when the follow-up list does not contain the new id', async () => {
    authAndRecipes([]);
    apiPost.mockResolvedValue({ data: { ok: true, recipe: { id: 'missing', name: 'Ghost' } } });
    const { getByRole, getByLabelText, queryByText } = render(<CraftingPage />);
    const button = await waitFor(() => getByRole('button', { name: '+ Start a piece' }));
    await act(async () => { fireEvent.click(button); });
    fireEvent.change(getByLabelText('Piece name'), { target: { value: 'Ghost' } });
    await act(async () => { fireEvent.click(button); });
    await waitFor(() => expect(getByRole('alert').textContent).toMatch(/did not read it back/));
    expect(queryByText('Ghost')).toBeNull();
  });
});
