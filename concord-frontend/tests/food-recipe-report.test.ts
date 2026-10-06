import { describe, it, expect } from 'vitest';
import {
  recipeSentence,
  recipeBody,
  recipeDtuCall,
  recipeThreadDraftCall,
  recipeThreadDraftOutcome,
  indexRecipeDrafts,
  type FoodRecipeFacts,
} from '@/components/food/foodRecipeReport';

const facts: FoodRecipeFacts = {
  recipe: {
    id: 'rec_1',
    title: 'Spaghetti Carbonara',
    slot: 'Dinner',
    servings: 4,
    calories: 580,
    protein: 22,
    carbs: 65,
    fat: 24,
    tags: ['pasta', 'italian'],
    ingredients: [
      { item: 'Spaghetti', qty: 400, unit: 'g', aisle: 'Pasta' },
      { item: 'Eggs', qty: 3, unit: 'item', aisle: 'Dairy' },
    ],
    avgRating: 4.5,
    ratingCount: 2,
    cookCount: 3,
    lastCookedAt: '2026-10-01T10:00:00Z',
    photoCount: 1,
  },
};

describe('food recipe report', () => {
  it('states only the figures the backend reported', () => {
    const s = recipeSentence(facts)!;
    expect(s).toContain('Spaghetti Carbonara');
    expect(s).toContain('Dinner');
    expect(s).toContain('4 servings');
    expect(s).toContain('580 kcal/serving');
    expect(s).toContain('22g protein');
    expect(s).toContain('65g carbs');
    expect(s).toContain('24g fat');
    expect(s).toContain('4.5★ (2 ratings)');
    expect(s).toContain('cooked 3×');
  });

  it('refuses to summarise a recipe with no id, title, or servings', () => {
    expect(recipeSentence({ recipe: null })).toBeNull();
    expect(recipeSentence({ recipe: { id: 'rec_1', title: 'X' } })).toBeNull();
    expect(recipeSentence({ recipe: { id: 'rec_1', title: 'X', servings: 0 } })).toBeNull();
    expect(recipeBody({ recipe: null })).toBe('');
    expect(recipeDtuCall({ recipe: null })).toBeNull();
  });

  it('builds a private DTU call with food/recipe tags and food-lens source', () => {
    const call = recipeDtuCall(facts)!;
    expect(call.domain).toBe('dtu');
    expect(call.action).toBe('create');
    const input = call.input as Record<string, unknown>;
    expect(input.source).toBe('food-lens:recipe-report');
    const meta = input.meta as Record<string, unknown>;
    expect(meta.visibility).toBe('private');
    const tags = input.tags as string[];
    expect(tags).toContain('food');
    expect(tags).toContain('recipe');
    expect(tags).toContain('dinner');
    const machine = input.machine as Record<string, unknown>;
    expect(machine.kind).toBe('food_recipe_report');
    expect(machine.servings).toBe(4);
    expect(machine.ingredientCount).toBe(2);
  });

  it('builds a Thread draft call that cites a real DTU id', () => {
    const call = recipeThreadDraftCall(facts, 'dtu_f1', 'x')!;
    expect(call.domain).toBe('thread');
    expect(call.action).toBe('thread-draft');
    const input = call.input as Record<string, unknown>;
    expect(input.citedDtuId).toBe('dtu_f1');
    expect(String(input.title)).toContain('Spaghetti Carbonara');
    expect(String(input.content)).toContain('Spaghetti Carbonara');
  });

  it('refuses to draft without a real DTU id', () => {
    expect(recipeThreadDraftCall(facts, '', 'x')).toBeNull();
    expect(recipeThreadDraftCall(facts, 'has space', 'x')).toBeNull();
    expect(recipeThreadDraftCall({ recipe: null }, 'dtu_f1', 'x')).toBeNull();
  });

  it('accepts a Thread draft that is draft status citing the exact DTU', () => {
    const outcome = recipeThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_f1' } } },
      'dtu_f1',
    );
    expect(outcome).toEqual({ draftId: 'th_1', status: 'draft', citedDtuId: 'dtu_f1' });
  });

  it('rejects a Thread draft that does not cite the exact DTU', () => {
    expect(recipeThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_other' } } },
      'dtu_f1',
    )).toBeNull();
  });

  it('rejects a Thread draft that is not draft status', () => {
    expect(recipeThreadDraftOutcome(
      { ok: true, result: { draft: { id: 'th_1', status: 'posted', citedDtuId: 'dtu_f1' } } },
      'dtu_f1',
    )).toBeNull();
  });

  it('indexes drafts by cited DTU id', () => {
    const idx = indexRecipeDrafts([
      { ok: true, result: { draft: { id: 'th_1', status: 'draft', citedDtuId: 'dtu_f1' } } },
      { ok: true, result: { draft: { id: 'th_2', status: 'draft', citedDtuId: 'dtu_f2' } } },
      { ok: false },
      null,
    ]);
    expect(idx).toEqual({ dtu_f1: 'th_1', dtu_f2: 'th_2' });
  });

  it('includes ingredients in the body when present', () => {
    const body = recipeBody(facts);
    expect(body).toContain('Ingredients (2):');
    expect(body).toContain('Spaghetti (400 g, Pasta)');
    expect(body).toContain('Eggs (3 item, Dairy)');
  });
});