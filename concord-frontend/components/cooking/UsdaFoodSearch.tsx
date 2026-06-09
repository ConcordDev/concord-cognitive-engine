'use client';

/**
 * UsdaFoodSearch — real USDA FoodData Central search.
 *
 * Phase 4 of the 10-dimension UX completeness sprint. Backed by
 * cooking.live_food_search / food.live_food_search.
 *
 * Search a food; get real macros per 100g (KCal / protein / fat /
 * carbs / fiber / sugars / sodium) from USDA's authoritative dataset.
 * Foundation Foods + SR Legacy + Survey (FNDDS) types.
 */

import { useState, useCallback, useRef } from 'react';
import { Search, Loader2, Apple, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Food {
  fdcId: number;
  description: string;
  brandOwner: string | null;
  dataType: string;
  publishedDate: string;
  servingSize: string | null;
  kcalPer100g?: number;
  proteinG?: number;
  fatG?: number;
  carbsG?: number;
  fiberG?: number;
  sugarsG?: number;
  sodiumMg?: number;
}

export interface UsdaFoodSearchProps {
  /** Domain to call ('cooking' or 'food'). Default 'cooking'. */
  domain?: 'cooking' | 'food';
  className?: string;
  onSelect?: (food: Food) => void;
}

async function runMacro<T>(domain: string, name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await lensRun({ domain, name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export function UsdaFoodSearch({ domain = 'cooking', className, onSelect }: UsdaFoodSearchProps) {
  const [query, setQuery] = useState('');
  const [foods, setFoods] = useState<Food[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usingDemoKey, setUsingDemoKey] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setFoods([]); return; }
    setLoading(true);
    setError(null);
    const r = await runMacro<{ ok: boolean; foods?: Food[]; reason?: string; usingDemoKey?: boolean }>(
      domain, 'live_food_search', { query: q, limit: 15 },
    );
    if (r?.ok) {
      setFoods(r.foods || []);
      setUsingDemoKey(!!r.usingDemoKey);
    } else {
      setError(r?.reason || 'fetch_failed');
      setFoods([]);
    }
    setLoading(false);
  }, [domain]);

  const onQueryChange = (next: string) => {
    setQuery(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(next), 500);
  };

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Apple className="w-4 h-4 text-lime-300" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">USDA · FoodData Central</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        {usingDemoKey && (
          <span className="text-[10px] text-amber-400 font-mono" title="Set USDA_API_KEY env for production">DEMO_KEY</span>
        )}
      </header>

      <div className="p-3 border-b border-zinc-800/40 relative">
        <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search a food (e.g. avocado, oat milk, salmon)…"
          className="w-full pl-8 pr-8 py-1.5 text-xs bg-zinc-900 border border-zinc-700 rounded text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-lime-500/40"
        />
        {loading && <Loader2 className="absolute right-5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-zinc-400" aria-hidden="true" />}
      </div>

      {error && (
        <div className="px-3 py-3 text-xs text-rose-300/80">
          <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />USDA unreachable ({error})
        </div>
      )}

      {!error && foods.length === 0 && query.trim().length >= 2 && !loading && (
        <div className="px-3 py-4 text-xs text-zinc-400 italic text-center">No matches in USDA database for &ldquo;{query.trim()}&rdquo;.</div>
      )}

      {foods.length > 0 && (
        <ul className="divide-y divide-zinc-800/60 max-h-[500px] overflow-y-auto">
          {foods.map((f) => (
            <li key={f.fdcId}>
              {onSelect ? (
                <button aria-label="Select food"
                  type="button"
                  onClick={() => onSelect(f)}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-zinc-900/60 transition-colors"
                >
                  <FoodRow f={f} />
                </button>
              ) : (
                <div className="px-3 py-2 text-xs">
                  <FoodRow f={f} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <footer className="px-3 py-1.5 text-[10px] text-zinc-400 border-t border-zinc-800/40">
        Source: USDA FoodData Central · per 100 g unless otherwise noted
      </footer>
    </section>
  );
}

function FoodRow({ f }: { f: Food }) {
  return (
    <>
      <div className="text-zinc-200 font-medium truncate">{f.description}</div>
      <div className="text-[10px] text-zinc-400 font-mono mt-0.5 truncate">
        {f.brandOwner ? `${f.brandOwner} · ` : ''}{f.dataType}{f.servingSize ? ` · serving ${f.servingSize}` : ''}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-zinc-400 font-mono">
        {f.kcalPer100g != null && <span><span className="text-zinc-400">kcal</span> {f.kcalPer100g.toFixed(0)}</span>}
        {f.proteinG != null && <span><span className="text-zinc-400">P</span> {f.proteinG.toFixed(1)}g</span>}
        {f.fatG != null && <span><span className="text-zinc-400">F</span> {f.fatG.toFixed(1)}g</span>}
        {f.carbsG != null && <span><span className="text-zinc-400">C</span> {f.carbsG.toFixed(1)}g</span>}
        {f.fiberG != null && <span><span className="text-zinc-400">fib</span> {f.fiberG.toFixed(1)}g</span>}
        {f.sugarsG != null && <span><span className="text-zinc-400">sug</span> {f.sugarsG.toFixed(1)}g</span>}
        {f.sodiumMg != null && <span><span className="text-zinc-400">Na</span> {f.sodiumMg.toFixed(0)}mg</span>}
      </div>
    </>
  );
}

export default UsdaFoodSearch;
