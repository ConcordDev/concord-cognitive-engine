'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Utensils, Loader2, Search, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Product {
  code: string;
  product_name?: string;
  brands?: string;
  nutriscore_grade?: string;
  nova_group?: number;
  ecoscore_grade?: string;
  categories_tags?: string[];
  ingredients_text?: string;
  countries_tags?: string[];
}

const NUTRI_COLOR: Record<string, string> = {
  a: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  b: 'border-lime-500/40 bg-lime-500/10 text-lime-300',
  c: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  d: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
  e: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

export function OpenFoodFactsSearch() {
  const [draft, setDraft] = useState('sourdough');
  const [query, setQuery] = useState('sourdough');

  const products = useQuery({
    queryKey: ['off-search', query],
    queryFn: async () => {
      const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=25&fields=code,product_name,brands,nutriscore_grade,nova_group,ecoscore_grade,categories_tags,ingredients_text,countries_tags`);
      if (!r.ok) throw new Error(`off ${r.status}`);
      const j = await r.json();
      return (j.products || []) as Product[];
    },
    enabled: query.length >= 2,
    staleTime: 60 * 60 * 1000,
  });

  const list = products.data || [];
  const nutriDist = list.reduce<Record<string, number>>((a, p) => { const g = p.nutriscore_grade; if (g) a[g] = (a[g] || 0) + 1; return a; }, {});
  const novaAvg = list.length > 0 ? list.filter((p) => p.nova_group).reduce((a, p) => a + (p.nova_group || 0), 0) / Math.max(1, list.filter((p) => p.nova_group).length) : 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Utensils className="h-5 w-5 text-amber-400" />
          <h2 className="text-sm font-semibold text-white">Open Food Facts search</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">world.openfoodfacts.org</span>
        </div>
        {list.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="openfoodfacts"
            apiUrl={`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}`}
            title={`Open Food Facts — "${query}" (${list.length})`}
            content={list.slice(0, 20).map((p, i) => `${i + 1}. ${p.product_name || '(unnamed)'}${p.brands ? ` · ${p.brands}` : ''}${p.nutriscore_grade ? ` · NutriScore ${p.nutriscore_grade.toUpperCase()}` : ''}${p.nova_group ? ` · NOVA ${p.nova_group}` : ''}\n   https://world.openfoodfacts.org/product/${p.code}`).join('\n\n')}
            extraTags={['food', 'openfoodfacts', 'nutrition', query.toLowerCase()]}
            rawData={{ query, products: list }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); setQuery(draft.trim()); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search food (e.g. olive oil, coffee, granola)" className="w-full rounded border border-zinc-800 bg-zinc-950 pl-7 pr-2 py-1.5 text-xs text-white focus:border-amber-500/40 focus:outline-none" />
        </div>
        <button type="submit" className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-mono text-amber-200 hover:bg-amber-500/20">search</button>
      </form>
      {products.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Open Food Facts unreachable.</div>}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Products</div><div className="mt-0.5 font-mono text-lg text-amber-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">NutriScore A/B</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{(nutriDist.a || 0) + (nutriDist.b || 0)}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Avg NOVA</div><div className="mt-0.5 font-mono text-lg text-amber-300">{novaAvg > 0 ? novaAvg.toFixed(1) : '—'}</div></div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((p) => (
          <a key={p.code} href={`https://world.openfoodfacts.org/product/${p.code}`} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 hover:border-amber-500/40">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-zinc-100">{p.product_name || '(unnamed)'}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-400">
                  {p.brands && <span>{p.brands}</span>}
                  {p.nutriscore_grade && <span className={`rounded px-1 font-mono ${NUTRI_COLOR[p.nutriscore_grade] || ''}`}>nutri {p.nutriscore_grade.toUpperCase()}</span>}
                  {p.nova_group && <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">NOVA {p.nova_group}</span>}
                  {p.ecoscore_grade && <span className="rounded bg-emerald-500/15 px-1 font-mono text-[9px] text-emerald-200">eco {p.ecoscore_grade.toUpperCase()}</span>}
                </div>
              </div>
              <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
            </div>
          </a>
        ))}
        {list.length === 0 && !products.isPending && !products.isError && query.length >= 2 && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No products.</div>}
      </div>
      {products.isPending && query.length >= 2 && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Searching…</div>}
    </div>
  );
}
