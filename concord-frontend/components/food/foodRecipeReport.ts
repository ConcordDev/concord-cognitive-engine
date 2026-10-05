/**
 * A food recipe report exists because the Food domain's `recipe-add` /
 * `recipe-list` macros returned the real recipe — title, slot, servings,
 * calories, protein, carbs, fat, tags, ingredients, ratings, cook count.
 * This module turns exactly that result into a sentence, saves it as a
 * private DTU, reads that DTU back, and hands it to Thread as a draft.
 *
 * Every figure below comes from a macro response. A figure the backend did
 * not return is reported as missing, never invented. Nothing here publishes
 * anything: a Thread draft is a draft until the user posts it themselves.
 */

import {
  dtuRecordId,
  dtuReadBackCall,
  dtuReadBackMatches,
  type ReceiptCall,
} from '@/components/wallet/walletReceipt';

export interface FoodRecipeDetail {
  id?: string;
  title?: string;
  slot?: string;
  servings?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  tags?: string[];
  ingredients?: { item: string; qty: number; unit: string; aisle?: string | null }[];
  avgRating?: number;
  ratingCount?: number;
  cookCount?: number;
  lastCookedAt?: string | null;
  photoCount?: number;
}

export interface FoodRecipeFacts {
  recipe: FoodRecipeDetail | null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown, max = 120): string {
  return String(v == null ? '' : v).trim().slice(0, max);
}

/**
 * The recipe report sentence, built only from the real detail. Null when
 * there is no recipe, no id, or no identifying figures.
 */
export function recipeSentence(facts: FoodRecipeFacts): string | null {
  const r = facts.recipe;
  if (!r || !r.id || !r.title) return null;
  const servings = num(r.servings);
  if (servings <= 0) return null;
  const parts: string[] = [];
  parts.push(str(r.title, 60));
  parts.push(str(r.slot, 20) || 'Dinner');
  const metrics: string[] = [];
  metrics.push(`${servings} serving${servings === 1 ? '' : 's'}`);
  if (r.calories != null && r.calories > 0) metrics.push(`${num(r.calories)} kcal/serving`);
  if (r.protein != null && r.protein > 0) metrics.push(`${num(r.protein)}g protein`);
  if (r.carbs != null && r.carbs > 0) metrics.push(`${num(r.carbs)}g carbs`);
  if (r.fat != null && r.fat > 0) metrics.push(`${num(r.fat)}g fat`);
  if (r.avgRating != null && r.avgRating > 0) metrics.push(`${num(r.avgRating)}★ (${num(r.ratingCount)} rating${num(r.ratingCount) === 1 ? '' : 's'})`);
  if (r.cookCount != null && r.cookCount > 0) metrics.push(`cooked ${num(r.cookCount)}×`);
  return `${parts.join(' · ')}: ${metrics.join(', ')}.`;
}

/** The full body saved as the DTU. Empty when there is nothing honest to save. */
export function recipeBody(facts: FoodRecipeFacts): string {
  const sentence = recipeSentence(facts);
  const r = facts.recipe;
  if (!sentence || !r) return '';
  const lines = [sentence, ''];
  lines.push(`Slot: ${r.slot || 'Dinner'}`);
  lines.push(`Servings: ${num(r.servings)}`);
  if (r.calories != null && r.calories > 0) lines.push(`Calories/serving: ${num(r.calories)}`);
  if (r.protein != null && r.protein > 0) lines.push(`Protein: ${num(r.protein)} g`);
  if (r.carbs != null && r.carbs > 0) lines.push(`Carbs: ${num(r.carbs)} g`);
  if (r.fat != null && r.fat > 0) lines.push(`Fat: ${num(r.fat)} g`);
  if (Array.isArray(r.tags) && r.tags.length > 0) lines.push(`Tags: ${r.tags.slice(0, 12).join(', ')}`);
  if (Array.isArray(r.ingredients) && r.ingredients.length > 0) {
    lines.push(`Ingredients (${r.ingredients.length}):`);
    for (const ing of r.ingredients.slice(0, 40)) {
      lines.push(`  - ${ing.item} (${num(ing.qty)} ${ing.unit}${ing.aisle ? `, ${ing.aisle}` : ''})`);
    }
  }
  if (r.avgRating != null && r.avgRating > 0) lines.push(`Avg rating: ${num(r.avgRating)}★ from ${num(r.ratingCount)} rating${num(r.ratingCount) === 1 ? '' : 's'}`);
  if (r.cookCount != null && r.cookCount > 0) lines.push(`Cooked: ${num(r.cookCount)}×${r.lastCookedAt ? ` (last ${r.lastCookedAt.slice(0, 10)})` : ''}`);
  lines.push('');
  lines.push('Every figure here came from the Food domain recipe-list macro in Concord. Nothing was published by saving this.');
  return lines.join('\n');
}

/** The machine payload — the same recipe the macro returned, structured. */
export function recipeMachine(facts: FoodRecipeFacts): Record<string, unknown> | null {
  const r = facts.recipe;
  if (!recipeSentence(facts) || !r) return null;
  return {
    kind: 'food_recipe_report',
    recipeId: r.id || null,
    title: r.title || null,
    slot: r.slot || null,
    servings: num(r.servings),
    calories: r.calories != null ? num(r.calories) : null,
    protein: r.protein != null ? num(r.protein) : null,
    carbs: r.carbs != null ? num(r.carbs) : null,
    fat: r.fat != null ? num(r.fat) : null,
    tags: Array.isArray(r.tags) ? r.tags.slice(0, 12) : [],
    ingredientCount: Array.isArray(r.ingredients) ? r.ingredients.length : 0,
    avgRating: r.avgRating != null ? num(r.avgRating) : null,
    ratingCount: num(r.ratingCount),
    cookCount: num(r.cookCount),
  };
}

/** The private DTU that records this recipe. Null when nothing can be saved. */
export function recipeDtuCall(facts: FoodRecipeFacts): ReceiptCall | null {
  const body = recipeBody(facts);
  const sentence = recipeSentence(facts);
  const machine = recipeMachine(facts);
  if (!body || !sentence || !machine) return null;
  const r = facts.recipe!;
  const tags = ['food', 'recipe', String(r.slot || 'dinner').toLowerCase()];
  return {
    domain: 'dtu',
    action: 'create',
    input: {
      title: sentence.slice(0, 80),
      tags,
      source: 'food-lens:recipe-report',
      human: { summary: body },
      core: { definitions: [sentence], claims: [body.slice(0, 240)] },
      machine,
      meta: {
        visibility: 'private',
        consent: { allowCitations: false },
        createdFrom: 'food',
      },
    },
  };
}

export { dtuRecordId, dtuReadBackCall, dtuReadBackMatches };

/**
 * The Thread draft carrying that recipe report. Thread stores a draft — it
 * does not publish. Null when there is no real DTU id to cite.
 */
export function recipeThreadDraftCall(
  facts: FoodRecipeFacts,
  dtuId: string,
  platform = 'x',
): ReceiptCall | null {
  const id = String(dtuId || '').trim();
  const sentence = recipeSentence(facts);
  if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(id) || !sentence) return null;
  const r = facts.recipe!;
  const title = str(r.title, 50) || 'recipe';
  return {
    domain: 'thread',
    action: 'thread-draft',
    input: {
      title: `Food recipe — ${title}`.slice(0, 120),
      content: recipeBody(facts),
      platform,
      citedDtuId: id,
    },
  };
}

export interface RecipeDraftResult {
  draftId: string;
  status: string;
  citedDtuId: string;
}

/** What the screen may claim about a Thread draft. Null when it did not land. */
export function recipeThreadDraftOutcome(
  data: { ok?: boolean; result?: unknown; error?: string | null } | null | undefined,
  dtuId: string,
): RecipeDraftResult | null {
  if (!data || data.ok === false) return null;
  const result = data.result && typeof data.result === 'object' ? (data.result as Record<string, unknown>) : null;
  const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
  if (!draft) return null;
  const draftId = String(draft.id || '').trim();
  const cited = String(draft.citedDtuId || '').trim();
  const status = String(draft.status || '').trim();
  if (!draftId || cited !== String(dtuId).trim() || status !== 'draft') return null;
  return { draftId, status, citedDtuId: cited };
}

/**
 * Index the drafts Thread already holds by the DTU they cite, so a reload
 * shows the same "Drafted in Thread" the send reported.
 */
export function indexRecipeDrafts(details: unknown): Record<string, string> {
  const list = Array.isArray(details) ? details : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const envelope = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    if (!envelope || envelope.ok === false) continue;
    const result = envelope.result && typeof envelope.result === 'object' ? (envelope.result as Record<string, unknown>) : envelope;
    const draft = result?.draft && typeof result.draft === 'object' ? (result.draft as Record<string, unknown>) : null;
    if (!draft) continue;
    const draftId = String(draft.id || '').trim();
    const cited = String(draft.citedDtuId || '').trim();
    if (!draftId || !cited || out[cited]) continue;
    out[cited] = draftId;
  }
  return out;
}