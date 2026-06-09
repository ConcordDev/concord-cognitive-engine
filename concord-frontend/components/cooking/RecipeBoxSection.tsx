'use client';

/**
 * RecipeBoxSection — Paprika + Samsung Food + Plan to Eat 2026 parity.
 * Recipe box, recipe scaling, week meal-plan calendar,
 * auto grocery list (consolidated + aisle-grouped), pantry + cook
 * suggestions, AI meal planner. Wired to the cooking.* macros.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChefHat, Loader2, Plus, Trash2, X, CalendarDays, ShoppingCart, Package,
  Sparkles, BookOpen, Check, Scaling,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Tab = 'recipes' | 'plan' | 'shopping' | 'pantry';

interface Ingredient { name: string; qty: number | null; unit: string }
interface Recipe {
  id: string; number: string; title: string; servings: number;
  prepMin: number; cookMin: number; ingredients: Ingredient[];
  steps: string[]; tags: string[]; cuisine: string; photoUrl: string; notes: string;
}
interface PlanEntry { date: string; slot: string; recipeId: string; servings: number; recipe: Recipe | null }
interface ShopItem { id: string; name: string; qty: number | null; unit: string; aisle: string; checked: boolean }
interface PantryItem { id: string; name: string; qty: number | null; unit: string; aisle: string }
interface CookSuggestion { recipeId: string; title: string; haveCount: number; totalCount: number; coveragePct: number; missing: string[] }

const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
const AISLE_ORDER = ['produce', 'meat', 'seafood', 'dairy', 'bakery', 'frozen', 'pantry', 'beverages', 'other'];

function weekDates(start: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export function RecipeBoxSection() {
  const [tab, setTab] = useState<Tab>('recipes');
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [planEntries, setPlanEntries] = useState<PlanEntry[]>([]);
  const [shopping, setShopping] = useState<ShopItem[]>([]);
  const [pantry, setPantry] = useState<PantryItem[]>([]);
  const [suggestions, setSuggestions] = useState<CookSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [weekStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d; });
  const [editRecipe, setEditRecipe] = useState<Partial<Recipe> & { _new?: boolean } | null>(null);
  const [scaleFor, setScaleFor] = useState<{ recipe: Recipe; target: number; scaled: Ingredient[] } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const dates = useMemo(() => weekDates(weekStart), [weekStart]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [r, p, sh, pa, sg] = await Promise.all([
        lensRun({ domain: 'cooking', action: 'recipes-list', input: {} }),
        lensRun({ domain: 'cooking', action: 'meal-plan-get', input: { start: dates[0], end: dates[6] } }),
        lensRun({ domain: 'cooking', action: 'shopping-list-get', input: {} }),
        lensRun({ domain: 'cooking', action: 'pantry-list', input: {} }),
        lensRun({ domain: 'cooking', action: 'pantry-cook-suggestions', input: {} }),
      ]);
      setRecipes((r.data?.result?.recipes || []) as Recipe[]);
      setPlanEntries((p.data?.result?.entries || []) as PlanEntry[]);
      setShopping((sh.data?.result?.items || []) as ShopItem[]);
      setPantry((pa.data?.result?.pantry || []) as PantryItem[]);
      setSuggestions((sg.data?.result?.suggestions || []) as CookSuggestion[]);
    } catch (e) { console.error('[RecipeBox] refresh', e); }
    finally { setLoading(false); }
  }, [dates]);

  useEffect(() => { refresh(); }, [refresh]);

  // ── Recipes ──
  function openNewRecipe() {
    setEditRecipe({ _new: true, title: '', servings: 4, prepMin: 0, cookMin: 0, ingredients: [{ name: '', qty: null, unit: '' }], steps: [''], tags: [], cuisine: '', notes: '' });
  }
  async function saveRecipe() {
    if (!editRecipe?.title?.trim()) return;
    const input = {
      title: editRecipe.title, servings: editRecipe.servings, prepMin: editRecipe.prepMin, cookMin: editRecipe.cookMin,
      ingredients: (editRecipe.ingredients || []).filter(i => i.name.trim()),
      steps: (editRecipe.steps || []).filter(s => s.trim()),
      cuisine: editRecipe.cuisine, notes: editRecipe.notes,
    };
    try {
      if (editRecipe._new) await lensRun({ domain: 'cooking', action: 'recipes-create', input });
      else await lensRun({ domain: 'cooking', action: 'recipes-update', input: { id: editRecipe.id, ...input } });
      setEditRecipe(null);
      await refresh();
    } catch (e) { console.error('[RecipeBox] saveRecipe', e); }
  }
  async function deleteRecipe(id: string) {
    if (!confirm('Delete this recipe?')) return;
    try { await lensRun({ domain: 'cooking', action: 'recipes-delete', input: { id } }); await refresh(); }
    catch (e) { console.error('[RecipeBox] deleteRecipe', e); }
  }
  async function openScale(recipe: Recipe) {
    try {
      const r = await lensRun({ domain: 'cooking', action: 'recipes-scale', input: { id: recipe.id, targetServings: recipe.servings } });
      setScaleFor({ recipe, target: recipe.servings, scaled: r.data?.result?.ingredients || [] });
    } catch (e) { console.error('[RecipeBox] scale', e); }
  }
  async function rescale(target: number) {
    if (!scaleFor) return;
    try {
      const r = await lensRun({ domain: 'cooking', action: 'recipes-scale', input: { id: scaleFor.recipe.id, targetServings: target } });
      setScaleFor({ ...scaleFor, target, scaled: r.data?.result?.ingredients || [] });
    } catch (e) { console.error('[RecipeBox] rescale', e); }
  }

  // ── Meal plan ──
  async function assignMeal(date: string, slot: string, recipeId: string) {
    if (!recipeId) { await lensRun({ domain: 'cooking', action: 'meal-plan-clear', input: { date, slot } }); }
    else { await lensRun({ domain: 'cooking', action: 'meal-plan-set', input: { date, slot, recipeId } }); }
    await refresh();
  }
  async function aiMealPlan() {
    setAiBusy(true);
    try {
      const pref = prompt('Diet preference (optional — e.g. vegan, quick, italian)?') || '';
      await lensRun({ domain: 'cooking', action: 'ai-meal-plan', input: { days: 7, slots: ['dinner'], start: dates[0], preference: pref } });
      await refresh();
      setTab('plan');
    } catch (e) { console.error('[RecipeBox] aiMealPlan', e); }
    finally { setAiBusy(false); }
  }

  // ── Shopping ──
  async function generateShopping() {
    try {
      await lensRun({ domain: 'cooking', action: 'shopping-list-generate', input: { start: dates[0], end: dates[6], subtractPantry: true } });
      await refresh();
      setTab('shopping');
    } catch (e) { console.error('[RecipeBox] genShopping', e); }
  }
  async function toggleShopItem(id: string) {
    try { await lensRun({ domain: 'cooking', action: 'shopping-list-toggle', input: { id } }); await refresh(); }
    catch (e) { console.error('[RecipeBox] toggleShop', e); }
  }
  async function clearChecked() {
    try { await lensRun({ domain: 'cooking', action: 'shopping-list-clear', input: { checkedOnly: true } }); await refresh(); }
    catch (e) { console.error('[RecipeBox] clearChecked', e); }
  }

  // ── Pantry ──
  async function addPantry() {
    const name = prompt('Pantry item?'); if (!name?.trim()) return;
    try { await lensRun({ domain: 'cooking', action: 'pantry-add', input: { name: name.trim() } }); await refresh(); }
    catch (e) { console.error('[RecipeBox] addPantry', e); }
  }
  async function delPantry(id: string) {
    try { await lensRun({ domain: 'cooking', action: 'pantry-delete', input: { id } }); await refresh(); }
    catch (e) { console.error('[RecipeBox] delPantry', e); }
  }

  const planByKey = useMemo(() => {
    const m = new Map<string, PlanEntry>();
    for (const e of planEntries) m.set(`${e.date}|${e.slot}`, e);
    return m;
  }, [planEntries]);

  const shopByAisle = useMemo(() => {
    const m: Record<string, ShopItem[]> = {};
    for (const it of shopping) (m[it.aisle] = m[it.aisle] || []).push(it);
    return m;
  }, [shopping]);

  return (
    <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <ChefHat className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-semibold text-gray-200">Recipe box</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
        <nav className="ml-3 flex items-center gap-1">
          {([['recipes','Recipes',BookOpen],['plan','Meal plan',CalendarDays],['shopping','Shopping',ShoppingCart],['pantry','Pantry',Package]] as const).map(([id,label,Icon]) => (
            <button key={id} onClick={() => setTab(id)} className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded', tab === id ? 'bg-orange-500/15 text-orange-300 border border-orange-500/30' : 'text-gray-400 hover:text-white border border-transparent')}>
              <Icon className="w-3 h-3" />{label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={aiMealPlan} disabled={aiBusy} className="px-2.5 py-1 text-xs rounded border border-orange-500/30 text-orange-300 hover:bg-orange-500/10 disabled:opacity-40 inline-flex items-center gap-1">
            {aiBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}AI meal plan
          </button>
        </div>
      </header>

      <div className="p-4">
        {/* RECIPES */}
        {tab === 'recipes' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{recipes.length} recipe(s)</span>
              <button onClick={openNewRecipe} className="ml-auto px-2.5 py-1 text-xs rounded bg-orange-500 text-black font-semibold hover:bg-orange-400 inline-flex items-center gap-1">
                <Plus className="w-3 h-3" />New recipe
              </button>
            </div>
            {recipes.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-400"><ChefHat className="w-6 h-6 mx-auto mb-2 opacity-30" />No recipes yet.</div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {recipes.map(r => (
                  <div key={r.id} className="rounded border border-white/10 bg-black/30 overflow-hidden group">
                    <div className="aspect-video bg-black/40">
                      {r.photoUrl
                        // eslint-disable-next-line @next/next/no-img-element -- recipe photos come from arbitrary external cooking sites
                        ? <img src={r.photoUrl} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center"><ChefHat className="w-8 h-8 text-gray-700" /></div>}
                    </div>
                    <div className="p-2.5">
                      <div className="text-sm text-white font-medium truncate">{r.title}</div>
                      <div className="text-[10px] text-gray-400">{r.servings} servings · {r.prepMin + r.cookMin} min · {r.ingredients.length} ingredients</div>
                      {r.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{r.tags.slice(0, 3).map(t => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300">{t}</span>)}</div>}
                      <div className="mt-2 flex items-center gap-1">
                        <button onClick={() => openScale(r)} className="px-1.5 py-0.5 text-[10px] rounded border border-white/10 text-gray-300 hover:bg-white/[0.05] inline-flex items-center gap-1"><Scaling className="w-3 h-3" />Scale</button>
                        <button onClick={() => setEditRecipe({ ...r })} className="px-1.5 py-0.5 text-[10px] rounded border border-white/10 text-gray-300 hover:bg-white/[0.05]">Edit</button>
                        <button aria-label="Delete" onClick={() => deleteRecipe(r.id)} className="ml-auto opacity-0 group-hover:opacity-100 p-1 text-rose-300 hover:bg-rose-500/20 rounded"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* MEAL PLAN */}
        {tab === 'plan' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Week of {dates[0]}</span>
              <button onClick={generateShopping} className="ml-auto px-2.5 py-1 text-xs rounded bg-orange-500 text-black font-semibold hover:bg-orange-400 inline-flex items-center gap-1">
                <ShoppingCart className="w-3 h-3" />Generate shopping list
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr>
                    <th className="text-left p-1.5 text-[10px] uppercase text-gray-400"></th>
                    {dates.map(d => <th key={d} className="text-left p-1.5 text-[10px] uppercase text-gray-400">{new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {SLOTS.map(slot => (
                    <tr key={slot} className="border-t border-white/5">
                      <td className="p-1.5 text-[10px] uppercase text-gray-400 font-semibold">{slot}</td>
                      {dates.map(d => {
                        const entry = planByKey.get(`${d}|${slot}`);
                        return (
                          <td key={d} className="p-1 align-top">
                            <select
                              value={entry?.recipeId || ''}
                              onChange={e => assignMeal(d, slot, e.target.value)}
                              className={cn('w-full px-1 py-1 text-[10px] rounded border bg-lattice-deep text-white', entry ? 'border-orange-500/30' : 'border-lattice-border')}
                            >
                              <option value="">—</option>
                              {recipes.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* SHOPPING */}
        {tab === 'shopping' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">{shopping.length} items · {shopping.filter(i => i.checked).length} checked</span>
              <button onClick={generateShopping} className="ml-auto px-2 py-1 text-[11px] rounded border border-white/10 text-gray-300 hover:bg-white/[0.05]">Regenerate</button>
              <button onClick={clearChecked} className="px-2 py-1 text-[11px] rounded border border-white/10 text-gray-300 hover:bg-white/[0.05]">Clear checked</button>
            </div>
            {shopping.length === 0 ? (
              <div className="py-10 text-center text-xs text-gray-400"><ShoppingCart className="w-6 h-6 mx-auto mb-2 opacity-30" />Empty. Plan meals then "Generate shopping list".</div>
            ) : (
              <div className="space-y-3">
                {AISLE_ORDER.filter(a => shopByAisle[a]).map(aisle => (
                  <div key={aisle}>
                    <div className="text-[10px] uppercase tracking-wider text-orange-300 font-semibold mb-1">{aisle}</div>
                    <ul className="space-y-0.5">
                      {shopByAisle[aisle].map(it => (
                        <li key={it.id} className="flex items-center gap-2 text-xs">
                          <button onClick={() => toggleShopItem(it.id)} className={cn('w-4 h-4 rounded border flex items-center justify-center', it.checked ? 'bg-orange-500 border-orange-500' : 'border-white/20')}>
                            {it.checked && <Check className="w-3 h-3 text-black" />}
                          </button>
                          <span className={cn('flex-1', it.checked ? 'text-gray-400 line-through' : 'text-white')}>{it.name}</span>
                          {it.qty !== null && <span className="text-[10px] text-gray-400 font-mono">{it.qty} {it.unit}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PANTRY */}
        {tab === 'pantry' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Pantry · {pantry.length}</span>
                <button onClick={addPantry} className="ml-auto px-2 py-0.5 text-[11px] rounded bg-orange-500 text-black font-bold hover:bg-orange-400 inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add</button>
              </div>
              {pantry.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">Empty pantry.</div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {pantry.map(p => (
                    <li key={p.id} className="py-1.5 flex items-center gap-2 text-xs group">
                      <Package className="w-3 h-3 text-gray-400" />
                      <span className="flex-1 text-white">{p.name}</span>
                      <span className="text-[10px] text-gray-400">{p.aisle}</span>
                      <button aria-label="Delete" onClick={() => delPantry(p.id)} className="opacity-0 group-hover:opacity-100 text-rose-300"><Trash2 className="w-3 h-3" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">What can I cook?</div>
              {suggestions.length === 0 ? (
                <div className="py-6 text-center text-xs text-gray-400">Add pantry items to see cookable recipes.</div>
              ) : (
                <ul className="space-y-1.5">
                  {suggestions.map(sg => (
                    <li key={sg.recipeId} className="rounded border border-white/10 bg-black/30 p-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-white flex-1 truncate">{sg.title}</span>
                        <span className={cn('text-[10px] font-mono', sg.coveragePct >= 80 ? 'text-emerald-300' : sg.coveragePct >= 50 ? 'text-amber-300' : 'text-gray-400')}>{sg.coveragePct}%</span>
                      </div>
                      <div className="mt-0.5 h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-orange-400" style={{ width: `${sg.coveragePct}%` }} />
                      </div>
                      {sg.missing.length > 0 && <div className="text-[10px] text-gray-400 mt-0.5">missing: {sg.missing.slice(0, 4).join(', ')}{sg.missing.length > 4 ? '…' : ''}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Recipe editor modal */}
      {editRecipe && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setEditRecipe(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div onClick={e => e.stopPropagation()} className="bg-[#0d1117] border border-orange-500/30 rounded-lg w-full max-w-lg max-h-[85vh] overflow-y-auto" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <header className="px-4 py-3 border-b border-white/10 flex items-center gap-2 sticky top-0 bg-[#0d1117]">
              <ChefHat className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold text-gray-200 flex-1">{editRecipe._new ? 'New recipe' : 'Edit recipe'}</span>
              <button aria-label="Close" onClick={() => setEditRecipe(null)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </header>
            <div className="p-4 space-y-2">
              <input value={editRecipe.title || ''} onChange={e => setEditRecipe({ ...editRecipe, title: e.target.value })} placeholder="Recipe title *" className="w-full px-2 py-1.5 text-sm bg-lattice-deep border border-lattice-border rounded text-white" />
              <div className="grid grid-cols-3 gap-2">
                <label className="text-[10px] text-gray-400">Servings<input type="number" min={1} value={editRecipe.servings || 4} onChange={e => setEditRecipe({ ...editRecipe, servings: Number(e.target.value) })} className="w-full mt-0.5 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" /></label>
                <label className="text-[10px] text-gray-400">Prep min<input type="number" min={0} value={editRecipe.prepMin || 0} onChange={e => setEditRecipe({ ...editRecipe, prepMin: Number(e.target.value) })} className="w-full mt-0.5 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" /></label>
                <label className="text-[10px] text-gray-400">Cook min<input type="number" min={0} value={editRecipe.cookMin || 0} onChange={e => setEditRecipe({ ...editRecipe, cookMin: Number(e.target.value) })} className="w-full mt-0.5 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" /></label>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Ingredients</div>
                {(editRecipe.ingredients || []).map((ing, i) => (
                  <div key={i} className="flex items-center gap-1 mb-1">
                    <input value={ing.qty ?? ''} onChange={e => { const ings = [...(editRecipe.ingredients || [])]; ings[i] = { ...ing, qty: e.target.value === '' ? null : Number(e.target.value) }; setEditRecipe({ ...editRecipe, ingredients: ings }); }} placeholder="Qty" className="w-14 px-1.5 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                    <input value={ing.unit} onChange={e => { const ings = [...(editRecipe.ingredients || [])]; ings[i] = { ...ing, unit: e.target.value }; setEditRecipe({ ...editRecipe, ingredients: ings }); }} placeholder="Unit" className="w-16 px-1.5 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                    <input value={ing.name} onChange={e => { const ings = [...(editRecipe.ingredients || [])]; ings[i] = { ...ing, name: e.target.value }; setEditRecipe({ ...editRecipe, ingredients: ings }); }} placeholder="Ingredient" className="flex-1 px-1.5 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                    <button onClick={() => { const ings = (editRecipe.ingredients || []).filter((_, j) => j !== i); setEditRecipe({ ...editRecipe, ingredients: ings }); }} className="text-rose-300"><X className="w-3 h-3" /></button>
                  </div>
                ))}
                <button onClick={() => setEditRecipe({ ...editRecipe, ingredients: [...(editRecipe.ingredients || []), { name: '', qty: null, unit: '' }] })} className="text-[11px] text-orange-300 hover:text-orange-200">+ Add ingredient</button>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Steps</div>
                {(editRecipe.steps || []).map((step, i) => (
                  <div key={i} className="flex items-center gap-1 mb-1">
                    <span className="text-[10px] text-gray-400 font-mono w-4">{i + 1}.</span>
                    <input value={step} onChange={e => { const steps = [...(editRecipe.steps || [])]; steps[i] = e.target.value; setEditRecipe({ ...editRecipe, steps }); }} placeholder="Step" className="flex-1 px-1.5 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
                    <button onClick={() => { const steps = (editRecipe.steps || []).filter((_, j) => j !== i); setEditRecipe({ ...editRecipe, steps }); }} className="text-rose-300"><X className="w-3 h-3" /></button>
                  </div>
                ))}
                <button onClick={() => setEditRecipe({ ...editRecipe, steps: [...(editRecipe.steps || []), ''] })} className="text-[11px] text-orange-300 hover:text-orange-200">+ Add step</button>
              </div>
              <button onClick={saveRecipe} className="w-full px-3 py-1.5 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400">{editRecipe._new ? 'Create recipe' : 'Save recipe'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Scale modal */}
      {scaleFor && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={() => setScaleFor(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div onClick={e => e.stopPropagation()} className="bg-[#0d1117] border border-orange-500/30 rounded-lg w-full max-w-sm" role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <header className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
              <Scaling className="w-4 h-4 text-orange-400" />
              <span className="text-sm font-semibold text-gray-200 flex-1">Scale: {scaleFor.recipe.title}</span>
              <button aria-label="Close" onClick={() => setScaleFor(null)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </header>
            <div className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">Servings:</span>
                <input type="number" min={1} value={scaleFor.target} onChange={e => rescale(Math.max(1, Number(e.target.value)))} className="w-20 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                <span className="text-[10px] text-gray-400">(base {scaleFor.recipe.servings})</span>
              </div>
              <ul className="text-xs space-y-0.5">
                {scaleFor.scaled.map((ing, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="font-mono text-orange-300 w-20 text-right">{ing.qty ?? '—'} {ing.unit}</span>
                    <span className="text-white">{ing.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RecipeBoxSection;
