'use client';

import { useEffect, useState } from 'react';
import { Calendar, Sparkles, Loader2, ShoppingCart } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const MEAL_SLOTS = ['Breakfast', 'Lunch', 'Dinner', 'Snack'] as const;
type Slot = typeof MEAL_SLOTS[number];

export interface PlannedMeal {
  date: string;
  slot: Slot;
  title: string;
  recipeDtuId?: string;
  servings: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export function MealPlanner() {
  const [plan, setPlan] = useState<PlannedMeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exportingList, setExportingList] = useState(false);
  const [groceryList, setGroceryList] = useState<Array<{ aisle: string; items: Array<{ name: string; qty: number; unit: string }> }>>([]);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', { domain: 'food', action: 'meal-plan-list', input: { startDate: weekStart() } });
      setPlan((res.data?.result?.meals || []) as PlannedMeal[]);
    } catch (e) { console.error('[Plan] list failed', e); }
    finally { setLoading(false); }
  }

  async function generate() {
    setGenerating(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'food', action: 'meal-plan-generate',
        input: { startDate: weekStart(), days: 7, mealsPerDay: 3, maxTimeMin: 30 },
      });
      setPlan((res.data?.result?.meals || []) as PlannedMeal[]);
    } catch (e) { console.error('[Plan] gen failed', e); }
    finally { setGenerating(false); }
  }

  async function buildGroceryList() {
    setExportingList(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'food', action: 'grocery-list-build',
        input: { startDate: weekStart(), days: 7 },
      });
      setGroceryList((res.data?.result?.byAisle || []) as Array<{ aisle: string; items: Array<{ name: string; qty: number; unit: string }> }>);
    } catch (e) { console.error('[Grocery] build failed', e); }
    finally { setExportingList(false); }
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart());
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Calendar className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Meal plan · this week</span>
        <button onClick={generate} disabled={generating} className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
          {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          AI generate
        </button>
        <button onClick={buildGroceryList} disabled={exportingList || plan.length === 0} className="inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-50">
          {exportingList ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShoppingCart className="w-3 h-3" />}
          Build list
        </button>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-gray-500 w-20">Slot</th>
                {days.map(d => (
                  <th key={d.toISOString()} className="px-2 py-2 text-center text-[10px] uppercase tracking-wider text-gray-500 min-w-[110px]">
                    <div>{d.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                    <div className="text-gray-400 normal-case">{d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MEAL_SLOTS.map(slot => (
                <tr key={slot} className="border-b border-white/5">
                  <td className="px-3 py-2 text-gray-300 font-medium">{slot}</td>
                  {days.map(d => {
                    const meal = plan.find(m => m.date === d.toISOString().slice(0, 10) && m.slot === slot);
                    return (
                      <td key={d.toISOString()} className="px-2 py-2 align-top">
                        {meal ? (
                          <div className={cn('p-2 rounded bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] cursor-pointer')}>
                            <div className="text-xs text-white truncate">{meal.title}</div>
                            {meal.calories && <div className="text-[9px] text-gray-500 tabular-nums">{Math.round(meal.calories)} kcal</div>}
                          </div>
                        ) : (
                          <div className="h-12 border border-dashed border-white/10 rounded text-center text-[10px] text-gray-600 flex items-center justify-center">
                            +
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {groceryList.length > 0 && (
        <div className="border-t border-white/10 p-4">
          <h3 className="text-xs uppercase tracking-wider text-cyan-300 mb-2">Grocery list (by aisle)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            {groceryList.map(g => (
              <div key={g.aisle}>
                <h4 className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">{g.aisle}</h4>
                <ul className="space-y-1">
                  {g.items.map((it, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <input type="checkbox" className="accent-cyan-500" />
                      <span className="text-white flex-1">{it.name}</span>
                      <span className="text-gray-500 tabular-nums">{it.qty} {it.unit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function weekStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + 1); // Monday
  return d.toISOString().slice(0, 10);
}

export default MealPlanner;
