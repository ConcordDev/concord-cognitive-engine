'use client';

/**
 * MealPlanAuto — pantry-aware meal-plan auto-generation from the user's
 * real recipe library (food.meal-plan-auto), plus a store-layout editor
 * (food.store-layout-set/get) and an aisle-grouped, store-ordered
 * shopping list (food.shopping-list-grouped). No sample data — the plan
 * is built from the user's own recipes and pantry.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CalendarDays, Loader2, Sparkles, ShoppingCart, AlertTriangle, Store, Save, Check,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PlannedMeal {
  date: string;
  slot: string;
  title: string;
  recipeId: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  pantryScore: number;
}

interface AutoPlanResult {
  meals: PlannedMeal[];
  days: number;
  mealsPerDay: number;
  recipesConsidered: number;
  pantryItemsUsed: number;
  ingredientsToBuy: string[];
}

interface AisleGroup {
  aisle: string;
  items: { name: string; qty: number; unit: string; aisle: string; haveInPantry: boolean }[];
}

interface GroupedList {
  byAisle: AisleGroup[];
  totalItems: number;
  totalToBuy: number;
  alreadyHave: number;
  storeName: string | null;
  days: number;
}

interface StoreLayout {
  id: string;
  storeName: string;
  aisleOrder: string[];
}

export function MealPlanAuto({ refreshKey = 0 }: { refreshKey?: number }) {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [days, setDays] = useState('7');
  const [mealsPerDay, setMealsPerDay] = useState('3');
  const [dietaryPrefs, setDietaryPrefs] = useState('');
  const [avoidTags, setAvoidTags] = useState('');

  const [generating, setGenerating] = useState(false);
  const [plan, setPlan] = useState<AutoPlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [layouts, setLayouts] = useState<StoreLayout[]>([]);
  const [storeName, setStoreName] = useState('');
  const [aisleOrder, setAisleOrder] = useState('');
  const [layoutSaved, setLayoutSaved] = useState(false);

  const [list, setList] = useState<GroupedList | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const loadLayouts = useCallback(async () => {
    try {
      const r = await lensRun<{ layouts: StoreLayout[] }>('food', 'store-layout-get', {});
      if (r.data?.ok) setLayouts(r.data.result?.layouts || []);
    } catch (e) {
      console.error('[MealPlanAuto] layouts failed', e);
    }
  }, []);

  useEffect(() => { loadLayouts(); }, [loadLayouts, refreshKey]);

  async function generate() {
    setGenerating(true); setError(null); setPlan(null); setList(null);
    try {
      const r = await lensRun<AutoPlanResult>('food', 'meal-plan-auto', {
        startDate,
        days: Number(days) || 7,
        mealsPerDay: Number(mealsPerDay) || 3,
        dietaryPrefs: dietaryPrefs.split(',').map((t) => t.trim()).filter(Boolean),
        avoidTags: avoidTags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      if (r.data?.ok && r.data.result) setPlan(r.data.result);
      else setError(r.data?.error || 'Could not generate plan');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate plan');
    } finally {
      setGenerating(false);
    }
  }

  async function saveLayout() {
    const order = aisleOrder.split(',').map((a) => a.trim()).filter(Boolean);
    if (!storeName.trim() || order.length === 0) { setError('Store name and aisle order required'); return; }
    setError(null);
    try {
      const r = await lensRun('food', 'store-layout-set', { storeName: storeName.trim(), aisleOrder: order });
      if (r.data?.ok) {
        setLayoutSaved(true);
        setTimeout(() => setLayoutSaved(false), 2000);
        await loadLayouts();
      } else {
        setError(r.data?.error || 'Failed to save layout');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save layout');
    }
  }

  async function buildList(useStore?: string) {
    setListLoading(true); setError(null);
    try {
      const r = await lensRun<GroupedList>('food', 'shopping-list-grouped', {
        startDate,
        days: Number(days) || 7,
        ...(useStore ? { storeName: useStore } : {}),
      });
      if (r.data?.ok && r.data.result) { setList(r.data.result); setChecked(new Set()); }
      else setError(r.data?.error || 'Could not build shopping list');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build shopping list');
    } finally {
      setListLoading(false);
    }
  }

  function toggleChecked(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const mealsByDate = plan
    ? plan.meals.reduce<Record<string, PlannedMeal[]>>((acc, m) => {
        (acc[m.date] ||= []).push(m);
        return acc;
      }, {})
    : {};

  return (
    <div className="space-y-4">
      {/* Generation controls */}
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-cyan-400" />
          <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Pantry-Aware Meal Plan</span>
        </header>
        <div className="p-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-gray-400">Start date</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-400">Days</span>
            <input type="number" min={1} max={14} value={days} onChange={(e) => setDays(e.target.value)} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-400">Meals/day</span>
            <input type="number" min={1} max={4} value={mealsPerDay} onChange={(e) => setMealsPerDay(e.target.value)} className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-400">Dietary prefs (tags)</span>
            <input value={dietaryPrefs} onChange={(e) => setDietaryPrefs(e.target.value)} placeholder="vegan, quick" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-gray-400">Avoid (tags)</span>
            <input value={avoidTags} onChange={(e) => setAvoidTags(e.target.value)} placeholder="meat, nuts" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
          </label>
          <button
            onClick={generate}
            disabled={generating}
            className="self-end py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Generate
          </button>
        </div>

        {error && (
          <div className="px-3 pb-3 flex items-start gap-1.5 text-xs text-amber-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
          </div>
        )}

        {plan && (
          <div className="px-3 pb-3 space-y-2">
            <div className="text-[10px] text-gray-500">
              {plan.meals.length} meals · {plan.recipesConsidered} recipes considered · {plan.pantryItemsUsed} pantry items used
            </div>
            {Object.entries(mealsByDate).map(([date, meals]) => (
              <div key={date} className="bg-lattice-deep border border-lattice-border rounded p-2">
                <div className="text-[10px] text-cyan-400 mb-1">{new Date(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                <div className="space-y-0.5">
                  {meals.map((m) => (
                    <div key={`${m.date}-${m.slot}`} className="flex items-center gap-2 text-xs">
                      <span className="text-gray-500 w-16 shrink-0">{m.slot}</span>
                      <span className="text-white flex-1 truncate">{m.title}</span>
                      {m.calories > 0 && <span className="text-orange-400">{m.calories} kcal</span>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <button
              onClick={() => buildList(layouts[0]?.storeName)}
              className="w-full py-1.5 rounded bg-green-500/20 text-green-300 text-xs font-bold hover:bg-green-500/30 flex items-center justify-center gap-1.5"
            >
              <ShoppingCart className="w-3.5 h-3.5" /> Build aisle-grouped shopping list
            </button>
          </div>
        )}
      </div>

      {/* Store layout editor */}
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <Store className="w-4 h-4 text-cyan-400" />
          <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Store Layout</span>
          <span className="ml-auto text-[10px] text-gray-500">{layouts.length} saved</span>
        </header>
        <div className="p-3 space-y-2 text-xs">
          <p className="text-[10px] text-gray-500">
            Save your store&apos;s aisle order so shopping lists sort in walk-through order.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder="Store name" className="px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
            <button onClick={saveLayout} className="py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 flex items-center justify-center gap-1.5">
              {layoutSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              {layoutSaved ? 'Saved' : 'Save layout'}
            </button>
          </div>
          <input
            value={aisleOrder}
            onChange={(e) => setAisleOrder(e.target.value)}
            placeholder="Aisle order, comma separated (e.g. Produce, Dairy, Canned, Frozen)"
            className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white"
          />
          {layouts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {layouts.map((l) => (
                <button
                  key={l.id}
                  onClick={() => { setStoreName(l.storeName); setAisleOrder(l.aisleOrder.join(', ')); }}
                  className="px-2 py-0.5 rounded bg-white/5 text-gray-300 hover:bg-white/10 text-[10px]"
                >
                  {l.storeName} ({l.aisleOrder.length} aisles)
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Aisle-grouped shopping list */}
      {(listLoading || list) && (
        <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
          <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-green-400" />
            <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Shopping List</span>
            {list && (
              <span className="ml-auto text-[10px] text-gray-500">
                {list.totalToBuy} to buy · {list.alreadyHave} in pantry
                {list.storeName ? ` · ${list.storeName} order` : ''}
              </span>
            )}
          </header>
          <div className="p-3">
            {listLoading ? (
              <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Building list…</div>
            ) : list && list.byAisle.length === 0 ? (
              <div className="py-6 text-center text-xs text-gray-500">
                No ingredients to buy — recipes in the plan have no ingredient data yet.
              </div>
            ) : list ? (
              <div className="space-y-2">
                {list.byAisle.map((g) => (
                  <div key={g.aisle}>
                    <div className="text-[10px] uppercase text-cyan-400 mb-1">{g.aisle}</div>
                    <ul className="space-y-0.5">
                      {g.items.map((it) => {
                        const key = `${g.aisle}|${it.name}|${it.unit}`;
                        const isChecked = checked.has(key);
                        return (
                          <li key={key}>
                            <button
                              onClick={() => toggleChecked(key)}
                              className="w-full flex items-center gap-2 text-xs py-0.5 text-left"
                            >
                              <span className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0',
                                isChecked ? 'bg-green-500 border-green-500' : 'border-gray-600')}>
                                {isChecked && <Check className="w-3 h-3 text-black" />}
                              </span>
                              <span className={cn('flex-1', isChecked ? 'line-through text-gray-600' : 'text-white')}>
                                {it.name}
                              </span>
                              <span className="text-gray-500">{it.qty} {it.unit}</span>
                              {it.haveInPantry && <span className="text-[9px] text-green-400">in pantry</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

export default MealPlanAuto;
