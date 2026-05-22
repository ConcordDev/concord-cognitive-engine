'use client';

/**
 * RecipeKitchen — Paprika 3 + Samsung Food gap-closing surface.
 * Wires the backlog macros into one real workbench:
 *   - import-from-url / import-from-photo (via RecipeImportBar)
 *   - cook-mode full-screen step view (via CookMode)
 *   - recipe-rate / recipe-log-cooked / recipe-history
 *   - recipe-nutrition-compute (USDA-linked, charted)
 *   - shopping-list-by-store (multi-store + unit normalization)
 *   - recipe-export-card (printable card / HTML)
 * All data is real — recipes from the user's box, nutrition from USDA.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChefHat, Loader2, Play, Star, History, Calculator, Printer, Store,
  CheckCircle2, ClipboardCheck, X, Download, Flame,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz/ChartKit';
import { RecipeImportBar } from './RecipeImportBar';
import { CookMode, type CookModeRecipe } from './CookMode';

interface Ingredient { name: string; qty: number | null; unit: string }
interface RatingEntry { id: string; stars: number; note: string; at: string }
interface MadeEntry { id: string; date: string; note: string; at: string }
interface NutritionLine { ingredient: string; grams: number; resolved: boolean }
interface RecipeNutrition {
  total: { caloriesKcal: number; proteinG: number; fatG: number; carbsG: number; fiberG: number; sugarG: number; sodiumMg: number };
  perServing: { caloriesKcal: number; proteinG: number; fatG: number; carbsG: number };
  lines: NutritionLine[];
  resolvedCount: number;
  ingredientCount: number;
  computedAt: string;
}
interface Recipe {
  id: string; number: string; title: string; servings: number;
  prepMin: number; cookMin: number; ingredients: Ingredient[];
  steps: string[]; tags: string[]; cuisine: string; notes: string;
  ratings: RatingEntry[]; madeLog: MadeEntry[]; nutrition: RecipeNutrition | null;
}
interface HistoryResult {
  ratings: RatingEntry[]; madeLog: MadeEntry[];
  avgRating: number; ratingCount: number; timesCooked: number; lastCooked: string | null;
}
interface StoreItem { name: string; qty: number | null; unit: string; aisle: string; checked: boolean; normalized: boolean }
interface StoreAisle { aisle: string; items: StoreItem[] }
interface StoreGroup { store: string; aisles: StoreAisle[]; itemCount: number }
interface ByStoreResult { stores: StoreGroup[]; storeCount: number; consolidatedFrom: number; totalItems: number }
interface ExportResult { title: string; card: string; html: string }

function avgStars(ratings: RatingEntry[]): number {
  if (!ratings.length) return 0;
  return Math.round((ratings.reduce((a, r) => a + r.stars, 0) / ratings.length) * 10) / 10;
}

export function RecipeKitchen() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cookRecipe, setCookRecipe] = useState<CookModeRecipe | null>(null);

  // panel state
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [nutrition, setNutrition] = useState<RecipeNutrition | null>(null);
  const [exported, setExported] = useState<ExportResult | null>(null);
  const [byStore, setByStore] = useState<ByStoreResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // rating + made-it form
  const [ratingStars, setRatingStars] = useState(5);
  const [ratingNote, setRatingNote] = useState('');
  const [madeDate, setMadeDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [madeNote, setMadeNote] = useState('');

  const refreshRecipes = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<{ recipes: Recipe[] }>('cooking', 'recipes-list', {});
      setRecipes(r.data.result?.recipes || []);
    } catch {
      setRecipes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refreshRecipes(); }, [refreshRecipes]);

  const selected = useMemo(
    () => recipes.find((r) => r.id === selectedId) || null,
    [recipes, selectedId],
  );

  const loadHistory = useCallback(async (id: string) => {
    setBusy('history');
    try {
      const r = await lensRun<HistoryResult>('cooking', 'recipe-history', { id });
      if (r.data.ok) setHistory(r.data.result);
    } finally {
      setBusy(null);
    }
  }, []);

  const selectRecipe = useCallback((r: Recipe) => {
    setSelectedId(r.id);
    setHistory(null);
    setNutrition(r.nutrition);
    setExported(null);
    loadHistory(r.id);
  }, [loadHistory]);

  const startCookMode = useCallback(async (id: string) => {
    const r = await lensRun<{ recipe: Recipe }>('cooking', 'recipes-get', { id });
    if (r.data.ok && r.data.result) {
      const rec = r.data.result.recipe;
      setCookRecipe({
        id: rec.id, title: rec.title, servings: rec.servings,
        ingredients: rec.ingredients, steps: rec.steps,
      });
    }
  }, []);

  const submitRating = useCallback(async () => {
    if (!selected) return;
    setBusy('rate');
    try {
      const r = await lensRun('cooking', 'recipe-rate', { id: selected.id, stars: ratingStars, note: ratingNote.trim() });
      if (r.data.ok) {
        setRatingNote('');
        await loadHistory(selected.id);
        await refreshRecipes();
      }
    } finally {
      setBusy(null);
    }
  }, [selected, ratingStars, ratingNote, loadHistory, refreshRecipes]);

  const submitMadeIt = useCallback(async () => {
    if (!selected) return;
    setBusy('made');
    try {
      const r = await lensRun('cooking', 'recipe-log-cooked', { id: selected.id, date: madeDate, note: madeNote.trim() });
      if (r.data.ok) {
        setMadeNote('');
        await loadHistory(selected.id);
        await refreshRecipes();
      }
    } finally {
      setBusy(null);
    }
  }, [selected, madeDate, madeNote, loadHistory, refreshRecipes]);

  const computeNutrition = useCallback(async () => {
    if (!selected) return;
    setBusy('nutrition');
    setNutrition(null);
    try {
      const r = await lensRun<RecipeNutrition>('cooking', 'recipe-nutrition-compute', { id: selected.id });
      if (r.data.ok && r.data.result) {
        setNutrition(r.data.result);
        await refreshRecipes();
      }
    } finally {
      setBusy(null);
    }
  }, [selected, refreshRecipes]);

  const exportCard = useCallback(async () => {
    if (!selected) return;
    setBusy('export');
    try {
      const r = await lensRun<ExportResult>('cooking', 'recipe-export-card', { id: selected.id });
      if (r.data.ok) setExported(r.data.result);
    } finally {
      setBusy(null);
    }
  }, [selected]);

  const loadByStore = useCallback(async () => {
    setBusy('store');
    try {
      const r = await lensRun<ByStoreResult>('cooking', 'shopping-list-by-store', {});
      if (r.data.ok) setByStore(r.data.result);
    } finally {
      setBusy(null);
    }
  }, []);

  const printCard = useCallback(() => {
    if (!exported) return;
    const w = window.open('', '_blank');
    if (w) { w.document.write(exported.html); w.document.close(); w.focus(); w.print(); }
  }, [exported]);

  const downloadCard = useCallback(() => {
    if (!exported) return;
    const blob = new Blob([exported.html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${exported.title.replace(/[^\w]+/g, '-').toLowerCase()}-card.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, [exported]);

  const nutritionChart = useMemo(() => {
    if (!nutrition) return [];
    return [
      { macro: 'Protein', grams: nutrition.total.proteinG },
      { macro: 'Carbs', grams: nutrition.total.carbsG },
      { macro: 'Fat', grams: nutrition.total.fatG },
      { macro: 'Fiber', grams: nutrition.total.fiberG },
      { macro: 'Sugar', grams: nutrition.total.sugarG },
    ];
  }, [nutrition]);

  return (
    <div className="space-y-4">
      <RecipeImportBar onImported={refreshRecipes} />

      <div className="rounded-lg border border-orange-500/15 bg-[#0d1117]">
        <header className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
          <ChefHat className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Kitchen workbench</span>
          {loading && <Loader2 className="w-3 h-3 animate-spin text-gray-500" />}
          <button
            onClick={loadByStore}
            className="ml-auto inline-flex items-center gap-1.5 rounded border border-orange-500/30 px-2.5 py-1 text-xs text-orange-300 hover:bg-orange-500/10"
          >
            <Store className="w-3 h-3" /> Shop by store
          </button>
        </header>

        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[260px_1fr]">
          {/* Recipe picker */}
          <div className="border-b border-white/10 lg:border-b-0 lg:border-r">
            {recipes.length === 0 ? (
              <p className="p-6 text-center text-xs text-gray-500">No recipes yet. Import one above to get started.</p>
            ) : (
              <ul className="max-h-[420px] overflow-y-auto">
                {recipes.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => selectRecipe(r)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-2 text-left text-xs',
                        selectedId === r.id ? 'bg-orange-500/10 text-orange-200' : 'text-gray-300 hover:bg-white/[0.03]',
                      )}
                    >
                      <ChefHat className="w-3.5 h-3.5 shrink-0 text-gray-500" />
                      <span className="min-w-0 flex-1 truncate">{r.title}</span>
                      {r.ratings.length > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-300">
                          <Star className="w-2.5 h-2.5 fill-current" />{avgStars(r.ratings)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Detail / actions */}
          <div className="p-4">
            {!selected ? (
              <p className="py-10 text-center text-xs text-gray-500">Select a recipe to cook, rate, compute nutrition, or export.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-white">{selected.title}</div>
                    <div className="text-[11px] text-gray-500">
                      serves {selected.servings} · {selected.prepMin + selected.cookMin} min · {selected.ingredients.length} ingredients · {selected.steps.length} steps
                    </div>
                  </div>
                  <button
                    onClick={() => startCookMode(selected.id)}
                    disabled={selected.steps.length === 0}
                    className="inline-flex items-center gap-1.5 rounded bg-orange-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-orange-400 disabled:opacity-40"
                  >
                    <Play className="w-3.5 h-3.5" /> Cook mode
                  </button>
                </div>

                {/* Nutrition + export action row */}
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={computeNutrition}
                    disabled={busy === 'nutrition' || selected.ingredients.length === 0}
                    className="inline-flex items-center gap-1.5 rounded border border-white/10 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/[0.05] disabled:opacity-40"
                  >
                    {busy === 'nutrition' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calculator className="w-3 h-3" />}
                    Compute USDA nutrition
                  </button>
                  <button
                    onClick={exportCard}
                    disabled={busy === 'export'}
                    className="inline-flex items-center gap-1.5 rounded border border-white/10 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/[0.05] disabled:opacity-40"
                  >
                    {busy === 'export' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />}
                    Export printable card
                  </button>
                </div>

                {/* Nutrition result */}
                {nutrition && (
                  <div className="rounded border border-white/10 bg-black/30 p-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-orange-300">
                      <Flame className="w-3 h-3" /> USDA-linked nutrition · {nutrition.resolvedCount}/{nutrition.ingredientCount} ingredients matched
                    </div>
                    <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {[
                        ['Total kcal', nutrition.total.caloriesKcal],
                        ['Per serving', nutrition.perServing.caloriesKcal],
                        ['Protein /sv', `${nutrition.perServing.proteinG} g`],
                        ['Sodium', `${nutrition.total.sodiumMg} mg`],
                      ].map(([label, val]) => (
                        <div key={String(label)} className="rounded bg-lattice-deep p-2 text-center">
                          <div className="text-base font-bold text-orange-400">{val}</div>
                          <div className="text-[10px] text-gray-500">{label}</div>
                        </div>
                      ))}
                    </div>
                    <ChartKit
                      kind="bar"
                      data={nutritionChart}
                      xKey="macro"
                      series={[{ key: 'grams', label: 'grams (total)', color: '#f59e0b' }]}
                      height={170}
                      showLegend={false}
                    />
                    {nutrition.resolvedCount < nutrition.ingredientCount && (
                      <p className="mt-1.5 text-[10px] text-gray-500">
                        Unmatched: {nutrition.lines.filter((l) => !l.resolved).map((l) => l.ingredient).join(', ') || 'none'}
                      </p>
                    )}
                  </div>
                )}

                {/* Export result */}
                {exported && (
                  <div className="rounded border border-white/10 bg-black/30 p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="flex-1 text-[11px] uppercase tracking-wider text-orange-300">Printable recipe card</span>
                      <button onClick={printCard} className="inline-flex items-center gap-1 rounded bg-orange-500 px-2 py-1 text-[11px] font-semibold text-black hover:bg-orange-400">
                        <Printer className="w-3 h-3" /> Print
                      </button>
                      <button onClick={downloadCard} className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[11px] text-gray-300 hover:bg-white/[0.05]">
                        <Download className="w-3 h-3" /> Download HTML
                      </button>
                    </div>
                    <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-lattice-deep p-2 font-mono text-[10px] leading-relaxed text-gray-300">{exported.card}</pre>
                  </div>
                )}

                {/* Rating + made-it forms */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="rounded border border-white/10 bg-black/30 p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-amber-300">
                      <Star className="w-3 h-3" /> Rate this recipe
                    </div>
                    <div className="mb-2 flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} onClick={() => setRatingStars(n)} aria-label={`${n} stars`}>
                          <Star className={cn('w-5 h-5', n <= ratingStars ? 'fill-amber-400 text-amber-400' : 'text-gray-600')} />
                        </button>
                      ))}
                    </div>
                    <input
                      value={ratingNote}
                      onChange={(e) => setRatingNote(e.target.value)}
                      placeholder="Note (optional)…"
                      className="mb-2 w-full rounded border border-lattice-border bg-lattice-deep px-2 py-1 text-xs text-white"
                    />
                    <button
                      onClick={submitRating}
                      disabled={busy === 'rate'}
                      className="inline-flex items-center gap-1 rounded bg-amber-500 px-2.5 py-1 text-[11px] font-semibold text-black hover:bg-amber-400 disabled:opacity-40"
                    >
                      {busy === 'rate' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Star className="w-3 h-3" />} Save rating
                    </button>
                  </div>

                  <div className="rounded border border-white/10 bg-black/30 p-3">
                    <div className="mb-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-emerald-300">
                      <ClipboardCheck className="w-3 h-3" /> Log &quot;I made it&quot;
                    </div>
                    <input
                      type="date"
                      value={madeDate}
                      onChange={(e) => setMadeDate(e.target.value)}
                      className="mb-2 w-full rounded border border-lattice-border bg-lattice-deep px-2 py-1 text-xs text-white"
                    />
                    <input
                      value={madeNote}
                      onChange={(e) => setMadeNote(e.target.value)}
                      placeholder="How did it go? (optional)…"
                      className="mb-2 w-full rounded border border-lattice-border bg-lattice-deep px-2 py-1 text-xs text-white"
                    />
                    <button
                      onClick={submitMadeIt}
                      disabled={busy === 'made'}
                      className="inline-flex items-center gap-1 rounded bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-black hover:bg-emerald-400 disabled:opacity-40"
                    >
                      {busy === 'made' ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Log it
                    </button>
                  </div>
                </div>

                {/* History */}
                <div className="rounded border border-white/10 bg-black/30 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gray-400">
                    <History className="w-3 h-3" /> History
                  </div>
                  {busy === 'history' ? (
                    <p className="text-xs text-gray-500">Loading…</p>
                  ) : !history || (history.ratingCount === 0 && history.timesCooked === 0) ? (
                    <p className="text-xs text-gray-500">No ratings or cook log yet — rate it or log a cook above.</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded bg-lattice-deep p-2 text-center">
                          <div className="text-base font-bold text-amber-400">{history.avgRating || '—'}</div>
                          <div className="text-[10px] text-gray-500">avg ({history.ratingCount})</div>
                        </div>
                        <div className="rounded bg-lattice-deep p-2 text-center">
                          <div className="text-base font-bold text-emerald-400">{history.timesCooked}</div>
                          <div className="text-[10px] text-gray-500">times cooked</div>
                        </div>
                        <div className="rounded bg-lattice-deep p-2 text-center">
                          <div className="text-xs font-bold text-gray-200">{history.lastCooked || '—'}</div>
                          <div className="text-[10px] text-gray-500">last cooked</div>
                        </div>
                      </div>
                      {history.ratings.length > 0 && (
                        <ul className="space-y-1">
                          {history.ratings.slice(0, 5).map((rt) => (
                            <li key={rt.id} className="flex items-start gap-2 text-[11px]">
                              <span className="inline-flex shrink-0 text-amber-400">
                                {'★'.repeat(rt.stars)}<span className="text-gray-700">{'★'.repeat(5 - rt.stars)}</span>
                              </span>
                              <span className="text-gray-400">{rt.note || <em className="text-gray-600">no note</em>}</span>
                              <span className="ml-auto shrink-0 text-gray-600">{rt.at.slice(0, 10)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {history.madeLog.length > 0 && (
                        <ul className="space-y-1 border-t border-white/5 pt-1.5">
                          {history.madeLog.slice(0, 5).map((ml) => (
                            <li key={ml.id} className="flex items-start gap-2 text-[11px]">
                              <CheckCircle2 className="mt-0.5 w-3 h-3 shrink-0 text-emerald-400" />
                              <span className="text-gray-300">{ml.date}</span>
                              <span className="text-gray-500">{ml.note}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Multi-store shopping result */}
      {byStore && (
        <div className="rounded-lg border border-orange-500/15 bg-[#0d1117] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Store className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-semibold text-gray-200">Shopping by store</span>
            <span className="text-[10px] text-gray-500">
              {byStore.consolidatedFrom} items → {byStore.totalItems} after unit normalization · {byStore.storeCount} store(s)
            </span>
            <button onClick={() => setByStore(null)} className="ml-auto text-gray-500 hover:text-white" aria-label="close">
              <X className="w-4 h-4" />
            </button>
          </div>
          {byStore.stores.length === 0 ? (
            <p className="py-6 text-center text-xs text-gray-500">Shopping list is empty — generate one from your meal plan first.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {byStore.stores.map((st) => (
                <div key={st.store} className="rounded border border-white/10 bg-black/30 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-orange-300">
                    <Store className="w-3 h-3" /> {st.store}
                    <span className="ml-auto text-[10px] text-gray-500">{st.itemCount} items</span>
                  </div>
                  {st.aisles.map((al) => (
                    <div key={al.aisle} className="mb-1.5">
                      <div className="text-[10px] uppercase tracking-wider text-gray-500">{al.aisle}</div>
                      <ul className="space-y-0.5">
                        {al.items.map((it, i) => (
                          <li key={`${it.name}-${i}`} className="flex items-center gap-2 text-xs">
                            <span className={cn('flex-1', it.checked ? 'text-gray-600 line-through' : 'text-gray-200')}>{it.name}</span>
                            {it.qty !== null && (
                              <span className="font-mono text-[10px] text-gray-500">
                                {it.qty} {it.unit}{it.normalized && <span className="ml-0.5 text-orange-400/70">·norm</span>}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {cookRecipe && <CookMode recipe={cookRecipe} onClose={() => setCookRecipe(null)} />}
    </div>
  );
}

export default RecipeKitchen;
