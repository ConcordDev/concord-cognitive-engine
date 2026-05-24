'use client';

/**
 * MealPlanner — Cozi-shape weekly meal-planning calendar tied to the grocery
 * list. Real CRUD against household.meal-plan-set / -list / -delete and
 * household.meal-grocery-list (aggregated, deduped ingredient list).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { UtensilsCrossed, Plus, Trash2, ShoppingCart, X, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Meal {
  id: string; date: string; slot: string; recipe: string;
  ingredients: string[]; servings: number; cook: string | null;
}
interface GroceryRow { name: string; count: number; meals: string[] }

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
const SLOT_LABEL: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };

function weekDates(offset: number) {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday); d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

const emptyForm = { id: '', date: '', slot: 'dinner', recipe: '', ingredients: '', servings: 2, cook: '' };

export function MealPlanner() {
  const [meals, setMeals] = useState<Meal[]>([]);
  const [grocery, setGrocery] = useState<GroceryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<typeof emptyForm | null>(null);
  const [busy, setBusy] = useState(false);

  const dates = useMemo(() => weekDates(offset), [offset]);

  const refresh = useCallback(async (range: string[]) => {
    const [ml, gl] = await Promise.all([
      lensRun<{ meals: Meal[] }>('household', 'meal-plan-list', { from: range[0], to: range[6] }),
      lensRun<{ list: GroceryRow[] }>('household', 'meal-grocery-list', { from: range[0], to: range[6] }),
    ]);
    if (ml.data?.ok) setMeals(ml.data.result?.meals || []);
    if (gl.data?.ok) setGrocery(gl.data.result?.list || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(dates); }, [refresh, dates]);

  const byKey = useMemo(() => {
    const m = new Map<string, Meal>();
    for (const meal of meals) m.set(`${meal.date}|${meal.slot}`, meal);
    return m;
  }, [meals]);

  async function save() {
    if (!editing || !editing.date || !editing.recipe.trim()) return;
    setBusy(true);
    await lensRun('household', 'meal-plan-set', {
      date: editing.date, slot: editing.slot, recipe: editing.recipe.trim(),
      ingredients: editing.ingredients.split(',').map(s => s.trim()).filter(Boolean),
      servings: editing.servings, cook: editing.cook || undefined,
    });
    setEditing(null); setBusy(false);
    await refresh(dates);
  }
  async function del(id: string) {
    await lensRun('household', 'meal-plan-delete', { id });
    await refresh(dates);
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <UtensilsCrossed className="w-4 h-4 text-orange-400" />
        <h3 className="text-sm font-bold text-zinc-100">Meal Planner</h3>
        <span className="text-[11px] text-zinc-400">{grocery.length} grocery items</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setOffset(o => o - 1)} className="p-1 rounded text-zinc-400 hover:bg-zinc-800" aria-label="Previous week"><ChevronLeft className="w-4 h-4" /></button>
          <span className="text-xs text-zinc-300">{offset === 0 ? 'This week' : offset > 0 ? `+${offset}w` : `${offset}w`}</span>
          <button onClick={() => setOffset(o => o + 1)} className="p-1 rounded text-zinc-400 hover:bg-zinc-800" aria-label="Next week"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[640px] grid grid-cols-[80px_repeat(7,1fr)] gap-1">
          <div />
          {dates.map(d => (
            <div key={d} className="text-center">
              <p className="text-[10px] text-zinc-400 font-medium">{new Date(d + 'T00:00').toLocaleDateString('default', { weekday: 'short' })}</p>
              <p className="text-[9px] text-zinc-400">{d.slice(5)}</p>
            </div>
          ))}
          {SLOTS.map(slot => (
            <div key={slot} className="contents">
              <div className="flex items-center text-[10px] text-zinc-400">{SLOT_LABEL[slot]}</div>
              {dates.map(d => {
                const meal = byKey.get(`${d}|${slot}`);
                return (
                  <button key={`${d}-${slot}`}
                    onClick={() => setEditing(meal
                      ? { id: meal.id, date: meal.date, slot: meal.slot, recipe: meal.recipe, ingredients: meal.ingredients.join(', '), servings: meal.servings, cook: meal.cook || '' }
                      : { ...emptyForm, date: d, slot })}
                    className={cn('min-h-[48px] rounded-lg border p-1 text-left transition-colors',
                      meal ? 'border-orange-800/50 bg-orange-950/30 hover:border-orange-600' : 'border-zinc-800 bg-zinc-900/40 hover:border-orange-700/40')}>
                    {meal ? (
                      <>
                        <p className="text-[9px] text-orange-300 font-semibold truncate">{meal.recipe}</p>
                        <p className="text-[8px] text-zinc-400">{meal.servings} serv{meal.cook ? ` · ${meal.cook}` : ''}</p>
                      </>
                    ) : <Plus className="w-3 h-3 text-zinc-700 mx-auto mt-1.5" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
        <p className="text-[11px] uppercase tracking-wide text-zinc-400 mb-1.5 inline-flex items-center gap-1">
          <ShoppingCart className="w-3 h-3 text-emerald-400" />Grocery list (from {meals.length} planned meals)
        </p>
        {grocery.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No data yet — add meals with ingredients above.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
            {grocery.map(g => (
              <div key={g.name} className="flex items-center justify-between text-xs px-2 py-1 bg-zinc-950/60 rounded">
                <span className="text-zinc-300 truncate">{g.name}</span>
                {g.count > 1 && <span className="text-emerald-400 font-semibold shrink-0">×{g.count}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setEditing(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-md p-4 space-y-2.5" onClick={e => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-zinc-100">{editing.id ? 'Edit Meal' : 'Plan Meal'}</h4>
              <button onClick={() => setEditing(null)} className="text-zinc-400 hover:text-zinc-200" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={editing.date} onChange={e => setEditing({ ...editing, date: e.target.value })}
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <select value={editing.slot} onChange={e => setEditing({ ...editing, slot: e.target.value })}
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
                {SLOTS.map(s => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}
              </select>
            </div>
            <input value={editing.recipe} onChange={e => setEditing({ ...editing, recipe: e.target.value })} placeholder="Recipe name"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" min={1} value={editing.servings} onChange={e => setEditing({ ...editing, servings: Number(e.target.value) })} placeholder="Servings"
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
              <input value={editing.cook} onChange={e => setEditing({ ...editing, cook: e.target.value })} placeholder="Cook"
                className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            </div>
            <textarea value={editing.ingredients} onChange={e => setEditing({ ...editing, ingredients: e.target.value })}
              placeholder="Ingredients (comma-separated)" rows={2}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            <div className="flex items-center gap-2 pt-1">
              {editing.id && <button onClick={() => { void del(editing.id); setEditing(null); }} className="text-rose-400 inline-flex items-center gap-1 text-xs"><Trash2 className="w-3 h-3" />Remove</button>}
              <button onClick={save} disabled={busy || !editing.date || !editing.recipe.trim()}
                className="ml-auto px-3 py-1.5 text-xs rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
                {busy && <Loader2 className="w-3 h-3 animate-spin" />}Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
