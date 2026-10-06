import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRunMock(...args),
}));

import { RecipeLibrary } from '@/components/food/RecipeLibrary';

const base = {
  slot: 'Dinner', servings: 2, calories: 500, protein: 20, carbs: 50, fat: 10, tags: [],
  avgRating: 0, ratingCount: 0, cookCount: 0, lastCookedAt: null, photoCount: 0,
};
let library: Array<Record<string, unknown>> = [];

beforeEach(() => {
  library = [
    { ...base, id: 'rec_a', title: 'Keep Soup' },
    { ...base, id: 'rec_b', title: 'Drop Stew' },
  ];
  lensRunMock.mockReset();
  lensRunMock.mockImplementation(async (domain: string, action: string, params: { id?: string }) => {
    if (domain === 'food' && action === 'recipe-list') return { data: { ok: true, result: { recipes: library } } };
    if (domain === 'food' && action === 'recipe-delete') {
      library = library.filter((r) => r.id !== params.id);
      return { data: { ok: true, result: { deleted: params.id } } };
    }
    if (domain === 'thread' && action === 'draft-list') return { data: { ok: true, result: { drafts: [] } } };
    return { data: { ok: true, result: {} } };
  });
});

const deleteCalls = () => lensRunMock.mock.calls.filter((c) => c[0] === 'food' && c[1] === 'recipe-delete');

describe('RecipeLibrary delete', () => {
  it('needs a confirm click before deleting, and cancel deletes nothing', async () => {
    render(<RecipeLibrary />);
    fireEvent.click(await screen.findByText('Drop Stew'));
    fireEvent.click(screen.getByTestId('food-recipe-delete'));
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.getByText(/Delete .Drop Stew.\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('food-recipe-delete-cancel'));
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.getByTestId('food-recipe-delete')).toBeInTheDocument();
  });

  it('confirmed delete calls food.recipe-delete with that id and the row disappears', async () => {
    const onChange = vi.fn();
    render(<RecipeLibrary onChange={onChange} />);
    fireEvent.click(await screen.findByText('Drop Stew'));
    fireEvent.click(screen.getByTestId('food-recipe-delete'));
    fireEvent.click(screen.getByTestId('food-recipe-delete-confirm'));
    await waitFor(() => expect(screen.queryByText('Drop Stew')).not.toBeInTheDocument());
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0][2]).toEqual({ id: 'rec_b' });
    expect(screen.getByText('Keep Soup')).toBeInTheDocument();
    expect(screen.getByText('1 recipes')).toBeInTheDocument();
    expect(onChange).toHaveBeenCalled();
  });

  it('keeps the row and shows the server error when delete is refused', async () => {
    lensRunMock.mockImplementation(async (domain: string, action: string) => {
      if (domain === 'food' && action === 'recipe-list') return { data: { ok: true, result: { recipes: library } } };
      if (domain === 'food' && action === 'recipe-delete') return { data: { ok: false, error: 'recipe not found' } };
      return { data: { ok: true, result: {} } };
    });
    render(<RecipeLibrary />);
    fireEvent.click(await screen.findByText('Drop Stew'));
    fireEvent.click(screen.getByTestId('food-recipe-delete'));
    fireEvent.click(screen.getByTestId('food-recipe-delete-confirm'));
    expect(await screen.findByText('recipe not found')).toBeInTheDocument();
    expect(screen.getByText('Drop Stew')).toBeInTheDocument();
  });
});

describe('RecipeLibrary row markup', () => {
  it('does not nest buttons inside the row toggle (read-only stars are not buttons)', async () => {
    const { container } = render(<RecipeLibrary />);
    await screen.findByText('Keep Soup');
    expect(container.querySelectorAll('button button')).toHaveLength(0);
    expect(screen.getAllByRole('img', { name: /of 5 stars/ }).length).toBe(2);
  });
});
