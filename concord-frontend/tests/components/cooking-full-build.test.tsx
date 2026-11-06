// Behaviour suite for the GB-1088 cooking full-lens build:
// converter exactness (the pre-filed references), cook-mode Finish →
// history log, recipe delete (two-step, always visible, receipt),
// pantry inline form (no native prompt), AI meal-plan preview→apply,
// and the bench's recipe-box loader. Repo-idiom vi.mock of the api
// client (cf. NutritionExplorer.test.tsx).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

type Call = { domain: string; action?: string; name?: string; input?: any };
const calls: Call[] = [];
const lensRunMock = vi.fn(async (a: any, b?: any, c?: any) => {
  const req: Call = typeof a === 'string' ? { domain: a, action: b, input: c } : { domain: a.domain, action: a.action ?? a.name, name: a.name, input: a.input };
  calls.push(req);
  return { data: baseHandler(req) };
});

const MINTED_DTU = {
  id: 'dtu_9a5e0001', title: 'Recipe — Pancakes (minted)',
  meta: { recipe: { name: 'Pancakes (minted)', servings: 2, ingredients: [{ name: 'flour', quantity: '200', unit: 'g', grams: '' }] } },
};

vi.mock('@/lib/api/client', () => ({
  lensRun: (a: any, b?: any, c?: any) => lensRunMock(a, b, c),
  api: {
    post: async () => ({}),
    get: async (url: string) => (url === '/api/dtus' ? { data: { dtus: [MINTED_DTU] } } : {}),
  },
  apiHelpers: { lensRun: (a: any, b?: any, c?: any) => lensRunMock(a, b, c) },
}));

import { UnitConverter, convertUnit, formatConverted } from '@/components/cooking/UnitConverter';
import { CookMode } from '@/components/cooking/CookMode';
import { RecipeBoxSection } from '@/components/cooking/RecipeBoxSection';
import { CookingActionPanel } from '@/components/cooking/CookingActionPanel';
import { useDepthBadge } from '@/hooks/useDepthBadge';
import { renderHook } from '@testing-library/react';

const PANCAKES = {
  id: 'rec_pan', title: 'Pancakes', description: '', servings: 4, totalMinutes: 20,
  ingredients: [{ name: 'flour', qty: 2, unit: 'cups' }], steps: ['Mix', 'Fry'],
  tags: [], ratingSum: 0, ratingCount: 0, timesCooked: 0, favorite: false,
};
const PREVIEW = [
  { date: '2026-11-09', slot: 'dinner', recipeId: 'rec_pan', title: 'Pancakes', servings: 4 },
  { date: '2026-11-10', slot: 'dinner', recipeId: 'rec_pan', title: 'Pancakes', servings: 4 },
];

function baseHandler(req: Call) {
  const a = req.action ?? req.name ?? '';
  switch (a) {
    case 'recipes-list': return { ok: true, result: { recipes: [PANCAKES] } };
    case 'meal-plan-get': return { ok: true, result: { entries: [] } };
    case 'shopping-list-get': return { ok: true, result: { items: [] } };
    case 'pantry-list': return { ok: true, result: { pantry: [] } };
    case 'pantry-cook-suggestions': return { ok: true, result: { suggestions: [] } };
    case 'collections-list': return { ok: true, result: { collections: [] } };
    case 'recipes-delete': return { ok: true, result: { deleted: true } };
    case 'pantry-add': return { ok: true, result: { item: { id: 'pan_1', name: req.input?.name, qty: req.input?.qty ?? null, unit: req.input?.unit ?? '' } } };
    case 'ai-meal-plan':
      if (req.input?.assignments) return { ok: true, result: { applied: true, entries: req.input.assignments.length } };
      return { ok: true, result: { preview: true, applied: false, assigned: PREVIEW, days: 2 } };
    case 'recipe-log-cooked': return { ok: true, result: { timesCooked: 3 } };
    default: return { ok: true, result: {} };
  }
}

beforeEach(() => { calls.length = 0; });

describe('UnitConverter — pre-filed conversion references', () => {
  it('1 cup = 236.6 ml', () => {
    expect(formatConverted(convertUnit('volume', 1, 'cup', 'ml'))).toBe('236.588');
    expect(Math.abs((convertUnit('volume', 1, 'cup', 'ml') ?? 0) - 236.6)).toBeLessThan(0.05);
  });
  it('1 tbsp = 3 tsp exactly', () => {
    expect(convertUnit('volume', 1, 'tbsp', 'tsp')).toBe(3);
  });
  it('350°F = 177°C (rounded)', () => {
    const c = convertUnit('temperature', 350, '°F', '°C') ?? 0;
    expect(Math.round(c)).toBe(177);
    expect(convertUnit('temperature', 100, '°C', '°F')).toBe(212);
  });
  it('renders the conversion live', () => {
    render(<UnitConverter />);
    expect(screen.getByText(/236\.588/)).toBeTruthy();
  });
});

describe('Declaration — the badge scopes the claim (S-CK2-7)', () => {
  it('cooking reads Live with the two-layer caption, not a bare REAL_FREE chip', () => {
    const info = renderHook(() => useDepthBadge('cooking')).result.current;
    expect(info?.label).toBe('Live');
    expect(info?.caption).toMatch(/your own data, saved as you work/);
    expect(info?.caption).toMatch(/USDA FoodData Central, TheMealDB recipe feed/);
    expect(info?.caption).toMatch(/real but static open-access data/);
  });
});

describe('CookMode — Finish completes the cook (S-CK2-5)', () => {
  it('last-step Finish calls recipe-log-cooked and shows the completion state', async () => {
    const onClose = vi.fn();
    render(<CookMode recipe={{ id: 'rec_pan', title: 'Pancakes', servings: 4, ingredients: PANCAKES.ingredients, steps: ['Mix', 'Fry'] }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Done · next/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(calls.some((c) => c.action === 'recipe-log-cooked' && c.input?.id === 'rec_pan')).toBe(true));
    expect(await screen.findByText(/Cooked — logged to your history \(3× cooked\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('RecipeBoxSection — delete, pantry form, AI review step', () => {
  it('delete is a named two-step confirm (no native dialog) with a receipt', async () => {
    render(<RecipeBoxSection />);
    const del = await screen.findByRole('button', { name: 'Delete Pancakes' });
    fireEvent.click(del);
    expect(screen.getByText('Delete “Pancakes”?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.action === 'recipes-delete' && c.input?.id === 'rec_pan')).toBe(true));
    expect(await screen.findByText('Recipe "Pancakes" deleted.')).toBeTruthy();
  });

  it('pantry add is an inline form (name/qty/unit), not a prompt', async () => {
    render(<RecipeBoxSection />);
    fireEvent.click(await screen.findByRole('button', { name: /^Pantry/ }));
    fireEvent.change(screen.getByLabelText('Pantry item name'), { target: { value: 'flour' } });
    fireEvent.change(screen.getByLabelText('Pantry item quantity'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('Pantry item unit'), { target: { value: 'g' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(calls.some((c) => c.action === 'pantry-add' && c.input?.name === 'flour' && c.input?.qty === 500 && c.input?.unit === 'g')).toBe(true));
    expect(await screen.findByText('"flour" added to your pantry.')).toBeTruthy();
  });

  it('AI meal plan previews first; only Apply writes the plan', async () => {
    render(<RecipeBoxSection />);
    fireEvent.click(await screen.findByRole('button', { name: /AI meal plan/ }));
    expect(await screen.findByText(/Proposed week — review before it applies/)).toBeTruthy();
    expect(calls.filter((c) => c.action === 'ai-meal-plan' && c.input?.assignments)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Apply this week' }));
    await waitFor(() => expect(calls.some((c) => c.action === 'ai-meal-plan' && Array.isArray(c.input?.assignments))).toBe(true));
    expect(await screen.findByText(/Meal plan applied/)).toBeTruthy();
  });
});

describe('CookingActionPanel — bench loader: the selected record is the loaded record (S-CK2-6 + F7 remainder)', () => {
  it('one source-labelled control: the box option loads the BOX record, not the same-named DTU', async () => {
    render(<CookingActionPanel />);
    const select = await screen.findByLabelText('Load a recipe into the bench') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Pancakes' })).toBeTruthy());
    // Both stores are offered, each under its own source label.
    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label);
    expect(groups).toEqual(expect.arrayContaining(['Recipe box', 'Recipe DTUs']));
    expect(within(select).getByRole('option', { name: 'Recipe — Pancakes (minted)' })).toBeTruthy();
    // R3's leg: select the account's box recipe → the bench holds THAT
    // record (4 servings box recipe), never the minted DTU (2 servings).
    fireEvent.change(select, { target: { value: 'box:rec_pan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    const nameInput = document.querySelector('input[type="text"]') as HTMLInputElement;
    expect(nameInput.value).toBe('Pancakes');
    expect(await screen.findByText(/Loaded "Pancakes" from your recipe box/)).toBeTruthy();
  });

  it('the DTU option loads the DTU record, receipt naming its store', async () => {
    render(<CookingActionPanel />);
    const select = await screen.findByLabelText('Load a recipe into the bench') as HTMLSelectElement;
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Recipe — Pancakes (minted)' })).toBeTruthy());
    fireEvent.change(select, { target: { value: 'dtu:dtu_9a5e0001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    const nameInput = document.querySelector('input[type="text"]') as HTMLInputElement;
    expect(nameInput.value).toBe('Pancakes (minted)');
    expect(await screen.findByText(/from your recipe DTUs/)).toBeTruthy();
  });
});
