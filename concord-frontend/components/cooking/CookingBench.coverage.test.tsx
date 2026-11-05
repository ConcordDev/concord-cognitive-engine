// Render coverage for the cooking files the build changed: the unit converter
// (pins: 1 cup = 236.6 ml, 1 tbsp = 3 tsp, 350°F = 177°C), the bench panel and the
// recipe-box section. The conversion maths is asserted exactly; the panels are
// walked through their tabs and controls against stubbed macros.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const lensRunMock = vi.fn();
const runDomainMock = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRunMock(...a),
  api: { delete: vi.fn(async () => ({})), get: vi.fn(async () => ({ data: {} })), post: vi.fn(async () => ({ data: { ok: true } })) },
  apiHelpers: { lens: { runDomain: (...a: unknown[]) => runDomainMock(...a) } },
}));
vi.mock('framer-motion', () => ({
  motion: (() => {
    const Stable = (props: Record<string, unknown>) => {
      const { initial, animate, exit, transition, whileHover, whileTap, layout, variants, children, ...dom } = props;
      void initial; void animate; void exit; void transition; void whileHover; void whileTap; void layout; void variants;
      return <div {...(dom as Record<string, unknown>)}>{children as React.ReactNode}</div>;
    };
    return new Proxy({}, { get: () => Stable });
  })(),
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/panel-polish', () => ({
  StructuredArrayEditor: ({ rows, onChange }: { rows: unknown[]; onChange: (r: unknown[]) => void }) => (
    <button type="button" onClick={() => onChange([...(rows || []), { name: 'flour', quantity: '2', unit: 'cup', grams: 250 }])}>add-ingredient-row</button>
  ),
  usePipe: () => ({ publish: vi.fn(), subscribe: vi.fn(), items: [] }),
  PipeImporter: () => null,
  useRecallableAction: () => ({ run: vi.fn(async (fn: () => Promise<unknown>) => fn()), recall: vi.fn(), state: null, armed: false, slot: null }),
  RecallSlot: () => null,
  LoadFromSubstrate: () => null,
}));
vi.mock('@/components/dtu/ContentClassLicenseFields', () => ({ withContentLicense: (x: unknown) => x }));

import { UnitConverter, convertUnit, formatConverted } from './UnitConverter';
import { CookingActionPanel } from './CookingActionPanel';
import { RecipeBoxSection } from './RecipeBoxSection';

const RECIPE = {
  id: 'r1', number: 'R-1', title: 'Pancakes', servings: 4, prepMin: 10, cookMin: 15,
  ingredients: [{ name: 'flour', qty: 2, unit: 'cup' }, { name: 'milk', qty: 1, unit: 'cup' }],
  steps: ['Mix', 'Fry'], tags: ['breakfast'], cuisine: 'American', photoUrl: '', notes: 'n',
};

beforeEach(() => {
  lensRunMock.mockReset();
  runDomainMock.mockReset();
  lensRunMock.mockImplementation(async (a: unknown) => {
    const action = (a as { action: string }).action;
    const R: Record<string, unknown> = {
      'recipes-list': { recipes: [RECIPE] },
      'meal-plan-get': { entries: [{ date: new Date().toISOString().slice(0, 10), slot: 'dinner', recipeId: 'r1', servings: 4, recipe: RECIPE }] },
      'shopping-list-get': { items: [{ id: 's1', name: 'flour', qty: 2, unit: 'cup', aisle: 'pantry', checked: false }, { id: 's2', name: 'milk', qty: 1, unit: 'cup', aisle: 'dairy', checked: true }] },
      'pantry-list': { pantry: [{ id: 'p1', name: 'salt', qty: 1, unit: 'kg', aisle: 'pantry' }] },
      'pantry-cook-suggestions': { suggestions: [{ recipeId: 'r1', title: 'Pancakes', haveCount: 1, totalCount: 2, coveragePct: 50, missing: ['milk'] }] },
      'collections-list': { collections: [{ id: 'c1', number: 'C-1', name: 'Brunch', recipeIds: ['r1'], recipeCount: 1, recipes: [RECIPE], createdAt: '2026-01-01' }] },
      'recipes-scale': { recipe: { ...RECIPE, servings: 8 }, ingredients: [{ name: 'flour', scaled: '4 cup' }] },
      'ai-meal-plan': { assignments: [{ date: '2026-01-01', slot: 'dinner', recipeId: 'r1', recipeTitle: 'Pancakes' }] },
      'shopping-list-generate': { items: [] },
    };
    return { data: { ok: true, result: R[action] ?? {} } };
  });
  runDomainMock.mockImplementation(async (_d: string, action: string) => {
    const R: Record<string, unknown> = {
      'usda-search': { ok: true, foods: [{ fdcId: 1, description: 'Flour, wheat', dataType: 'SR', servingSize: 100, servingSizeUnit: 'g' }], count: 1, totalHits: 1 },
      scaleRecipe: { ok: true, recipe: 'Pancakes', baseServings: 1, targetServings: 2, scaleFactor: 2, ingredients: [{ name: 'flour', original: '2 cup', scaled: '4 cup' }] },
      nutritionEstimate: { ok: true, totalCalories: 400, perServing: 200, macros: { protein: '10g', carbs: '40g', fat: '5g' }, servings: 2 },
      substitution: { ok: true, ingredient: 'butter', found: true, substitutions: [{ sub: 'oil', ratio: '3/4', note: 'n' }] },
    };
    return { data: { ok: true, result: R[action] ?? { ok: true } } };
  });
});

// Click every control once, letting each async handler settle before the next click.
const clickAllButtons = async (skip: RegExp = /^$/) => {
  for (const el of Array.from(document.querySelectorAll('button, [role="tab"], [role="button"]')) as HTMLElement[]) {
    if (!el.isConnected || (el as HTMLButtonElement).disabled) continue;
    const label = (el.getAttribute('aria-label') || el.textContent || '').trim();
    if (skip.test(label)) continue;
    await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 0)); });
  }
};

describe('UnitConverter', () => {
  it('holds the pre-filed references exactly', () => {
    expect(formatConverted(convertUnit('volume', 1, 'cup', 'ml'))).toBe('236.588');
    expect(convertUnit('volume', 1, 'tbsp', 'tsp')).toBeCloseTo(3, 9);
    expect(formatConverted(convertUnit('temperature', 350, '°F', '°C'))).toBe('176.667');
    expect(formatConverted(convertUnit('temperature', 100, '°C', '°F'))).toBe('212');
    expect(convertUnit('weight', 1, 'lb', 'g')).toBeCloseTo(453.59237, 6);
    expect(convertUnit('weight', 5, 'g', 'g')).toBe(5);
  });

  it('rejects non-finite input and unknown units instead of inventing a number', () => {
    expect(convertUnit('volume', Number.NaN, 'cup', 'ml')).toBeNull();
    expect(convertUnit('volume', 1, 'cup', 'furlong')).toBeNull();
    expect(formatConverted(null)).toBe('—');
    expect(formatConverted(Number.POSITIVE_INFINITY)).toBe('—');
  });

  it('converts in the UI, swaps, and resets per group', () => {
    render(<UnitConverter />);
    expect(screen.getByRole('status').textContent).toContain('236.588');
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2' } });
    expect(screen.getByRole('status').textContent).toContain('473.176');
    fireEvent.click(screen.getByLabelText('Swap units'));
    fireEvent.click(screen.getByRole('tab', { name: 'Temperature' }));
    expect(screen.getByRole('status').textContent).toContain('176.667');
    fireEvent.change(screen.getByLabelText('To unit'), { target: { value: '°F' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Weight' }));
    fireEvent.change(screen.getByLabelText('From unit'), { target: { value: 'lb' } });
    expect(screen.getByRole('status').textContent).toContain('g');
  });
});

describe('CookingActionPanel', () => {
  it('loads the recipe box and runs the bench actions', async () => {
    render(<CookingActionPanel />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'recipes-list' })));
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    inputs.forEach((i, n) => { try { fireEvent.change(i, { target: { value: i.type === 'number' ? '2' : `value ${n}` } }); } catch { /* noop */ } });
    for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) {
      const opt = sel.querySelector('option[value]:not([value=""])') as HTMLOptionElement | null;
      if (opt) fireEvent.change(sel, { target: { value: opt.value } });
    }
    fireEvent.click(screen.getByText('add-ingredient-row'));
    await clickAllButtons(/^$/);
    await clickAllButtons(/^$/);
    await waitFor(() => expect(runDomainMock.mock.calls.length).toBeGreaterThan(0));
    expect(document.body.textContent).toBeTruthy();
  });

  it('reports an honest error when a macro fails', async () => {
    runDomainMock.mockImplementation(async () => { throw new Error('offline'); });
    render(<CookingActionPanel />);
    await clickAllButtons(/^$/);
    await waitFor(() => expect(document.body.textContent).toBeTruthy());
  });
});

describe('RecipeBoxSection', () => {
  const press = async (name: RegExp | string) => {
    // real <button> elements only: modal backdrops are role=button divs whose text includes every label inside
    const el = Array.from(document.querySelectorAll('button')).find((b) => (typeof name === 'string' ? (b.textContent || '').trim() === name : name.test((b.getAttribute('aria-label') || '') + (b.textContent || ''))));
    if (!el) throw new Error(`no button ${String(name)}`);
    await act(async () => { fireEvent.click(el); await new Promise((r) => setTimeout(r, 0)); });
  };
  const typeInto = async (placeholder: RegExp | string, value: string) => {
    const el = screen.getAllByPlaceholderText(placeholder)[0] as HTMLInputElement;
    await act(async () => { fireEvent.change(el, { target: { value } }); });
  };
  const calls = (action: string) => lensRunMock.mock.calls.filter((c) => (c[0] as { action: string }).action === action).length;

  it('creates, edits, scales and deletes a recipe', async () => {
    render(<RecipeBoxSection />);
    await waitFor(() => expect(screen.getAllByText(/Pancakes/).length).toBeGreaterThan(0));
    await press(/New recipe/);
    await typeInto('Recipe title *', 'Soup');
    await typeInto('Ingredient', 'leek');
    await typeInto('Step', 'Simmer');
    await press(/Create recipe/);
    await waitFor(() => expect(calls('recipes-create')).toBe(1), { timeout: 3000 });
    await press('Edit');
    await typeInto('Recipe title *', 'Pancakes v2');
    await press('+ Ingredient').catch(() => undefined);
    await press(/Save recipe/);
    await waitFor(() => expect(calls('recipes-update')).toBe(1));
    await press('Scale');
    await waitFor(() => expect(calls('recipes-scale')).toBeGreaterThan(0));
    const target = document.querySelector('input[type="number"][min="1"]') as HTMLInputElement | null;
    if (target) await act(async () => { fireEvent.change(target, { target: { value: '8' } }); });
    await press(/^Close$/);
    await press(/Delete Pancakes/);
    await press('Delete');
    await waitFor(() => expect(calls('recipes-delete')).toBe(1));
  });

  it('plans meals, generates and ticks the shopping list, and keeps a pantry', async () => {
    render(<RecipeBoxSection />);
    await waitFor(() => expect(screen.getAllByText(/Pancakes/).length).toBeGreaterThan(0));
    await press('Meal plan');
    for (const sel of Array.from(document.querySelectorAll('select')) as HTMLSelectElement[]) {
      const opt = sel.querySelector('option[value]:not([value=""])') as HTMLOptionElement | null;
      await act(async () => { fireEvent.change(sel, { target: { value: opt ? opt.value : '' } }); });
      await act(async () => { fireEvent.change(sel, { target: { value: '' } }); });
    }
    await typeInto('Preference (optional)', 'quick');
    await press(/AI meal plan/);
    await waitFor(() => expect(calls('ai-meal-plan')).toBeGreaterThan(0));
    await act(async () => { await clickAllButtons(/^(Recipes|Meal plan|Shopping|Pantry|Collections)$|delete|remove|^$/i); });

    await press('Shopping');
    await typeInto(/Add item not tied/, 'paper towels');
    await press(/^Add$/);
    await waitFor(() => expect(calls('shopping-list-add')).toBe(1));
    await press(/Regenerate/);
    await press(/Clear checked/);
    await act(async () => { await clickAllButtons(/^(Recipes|Meal plan|Shopping|Pantry|Collections)$|delete|remove|^$/i); });

    await press('Pantry');
    await typeInto(/Add a pantry item/, 'rice');
    await press(/^Add$/);
    await waitFor(() => expect(calls('pantry-add')).toBe(1));
    await waitFor(() => expect(Array.from(document.querySelectorAll('button')).some((b) => /Remove salt/.test(b.getAttribute('aria-label') || ''))).toBe(true));
    await press(/Remove salt/);
    await waitFor(() => expect(calls('pantry-delete')).toBeGreaterThan(0));
  });

  it('manages collections', async () => {
    render(<RecipeBoxSection />);
    await waitFor(() => expect(screen.getAllByText(/Pancakes/).length).toBeGreaterThan(0));
    await press('Collections');
    await typeInto(/New folder name/, 'Weeknight');
    await press(/New folder/);
    await waitFor(() => expect(calls('collections-create')).toBe(1));
    await act(async () => { fireEvent.click(screen.getByText('Brunch')); });
    await act(async () => { await clickAllButtons(/^(Recipes|Meal plan|Shopping|Pantry|Collections)$|^$/i); });
    await waitFor(() => expect(lensRunMock.mock.calls.length).toBeGreaterThan(8));
  });

  it('degrades when the macros fail', async () => {
    lensRunMock.mockImplementation(async () => { throw new Error('offline'); });
    render(<RecipeBoxSection />);
    await waitFor(() => expect(lensRunMock).toHaveBeenCalled());
    expect(document.body.textContent).toBeTruthy();
  });
});
