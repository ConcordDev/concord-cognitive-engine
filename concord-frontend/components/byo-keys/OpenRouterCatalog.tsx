'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Key, Loader2, Search, Cpu } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { publicLookup, carryLookupMeta, lookupMeta } from '@/lib/public-lookup';

interface OrModel {
  id: string;
  name?: string;
  description?: string;
  pricing?: { prompt: string; completion: string };
  context_length?: number;
  architecture?: { modality?: string; tokenizer?: string };
  per_request_limits?: Record<string, unknown> | null;
  top_provider?: { is_moderated?: boolean; max_completion_tokens?: number };
}

type CatalogSort = 'default' | 'name' | 'context' | 'price-in' | 'price-out';
const PAGE_SIZE = 100;

export function OpenRouterCatalog() {
  const [query, setQuery] = useState('');
  // FIX-byo-keys-013: the catalog was hard-capped at the first 100
  // rows with no sort and no way to inspect a model. It now pages
  // (Show more), sorts, and rows open a detail view.
  const [sort, setSort] = useState<CatalogSort>('default');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const models = useQuery({
    queryKey: ['openrouter-models'],
    queryFn: async () => {
      const j = await publicLookup<{ data?: OrModel[] }>('openrouter-models', {});
      const items = (j.data || []) as OrModel[];
      carryLookupMeta(j, items);
      return items;
    },
    staleTime: 60 * 60 * 1000,
  });

  const meta = lookupMeta(models.data);
  const price = (p?: string) => { const n = parseFloat(p || ''); return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY; };
  const matched = (models.data || []).filter((m) => !query.trim() || m.id.toLowerCase().includes(query.toLowerCase()) || (m.name || '').toLowerCase().includes(query.toLowerCase()));
  const sorted = [...matched].sort((a, b) => {
    if (sort === 'name') return a.id.localeCompare(b.id);
    if (sort === 'context') return (b.context_length || 0) - (a.context_length || 0);
    if (sort === 'price-in') return price(a.pricing?.prompt) - price(b.pricing?.prompt);
    if (sort === 'price-out') return price(a.pricing?.completion) - price(b.pricing?.completion);
    return 0;
  });
  const filtered = sorted.slice(0, shown);
  const selected = (models.data || []).find((m) => m.id === selectedId) || null;

  const fmtPrice = (p?: string) => {
    if (!p) return '—';
    const n = parseFloat(p);
    if (n === 0) return 'free';
    return `$${(n * 1000000).toFixed(2)}/M`;
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Provider catalog</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">OpenRouter · via Concord server · {models.data?.length ?? '—'} models</span>
        </div>
        {filtered.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="openrouter"
            apiUrl="https://openrouter.ai/models"
            title={`OpenRouter model catalog — ${filtered.length}${query ? ` matching "${query}"` : ''}`}
            content={filtered.slice(0, 50).map((m) => `${m.id} · ctx=${m.context_length || '?'} · in=${fmtPrice(m.pricing?.prompt)} · out=${fmtPrice(m.pricing?.completion)}${m.name ? ` · ${m.name}` : ''}`).join('\n')}
            extraTags={['byo-keys', 'llm-catalog', 'openrouter']}
            rawData={{ query, count: filtered.length, models: filtered.slice(0, 80) }}
          />
        )}
      </header>
      <form onSubmit={(e) => e.preventDefault()} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE_SIZE); setSelectedId(null); }} aria-label="Filter models" placeholder="Filter (e.g. opus, claude, gpt-4, qwen, llama)…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <span className="font-mono text-[10px] text-zinc-400">showing {filtered.length} of {matched.length} matching / {models.data?.length ?? '—'} total</span>
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
          Sort
          <select aria-label="Sort models" value={sort} onChange={(e) => { setSort(e.target.value as CatalogSort); setShown(PAGE_SIZE); }} className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-sm text-white">
            <option value="default">Catalog order</option>
            <option value="name">Name A–Z</option>
            <option value="context">Context, largest first</option>
            <option value="price-in">Input price, low first</option>
            <option value="price-out">Output price, low first</option>
          </select>
        </label>
      </form>
      {models.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">The OpenRouter model list is unavailable right now — nothing is being shown in its place.</div>}
      {meta?.stale && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">Showing the cached OpenRouter model list{meta.fetchedAt ? ` from ${new Date(meta.fetchedAt).toLocaleString()}` : ''} — live source unavailable.</div>}
      {models.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Pulling provider catalog…</div>}
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {filtered.map((m) => (
          <button type="button" key={m.id} onClick={() => setSelectedId(m.id === selectedId ? null : m.id)} aria-pressed={m.id === selectedId} aria-label={`Details for ${m.id}`} className={`block w-full rounded border p-2 text-left ${m.id === selectedId ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-mono text-sm text-cyan-300 line-clamp-1">{m.id}</span>
              <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-400">
                <span>ctx {m.context_length?.toLocaleString() || '?'}</span>
                <span className="text-emerald-300">in {fmtPrice(m.pricing?.prompt)}</span>
                <span className="text-amber-300">out {fmtPrice(m.pricing?.completion)}</span>
              </div>
            </div>
            {m.name && m.name !== m.id && <div className="text-[10px] text-zinc-400">{m.name}</div>}
            {m.description && <p className="line-clamp-2 text-[11px] text-zinc-400">{m.description}</p>}
            <div className="mt-0.5 flex flex-wrap gap-1 text-[9px]">
              {m.architecture?.modality && <span className="rounded bg-zinc-800 px-1 font-mono text-zinc-300"><Cpu className="mr-0.5 inline h-2.5 w-2.5" />{m.architecture.modality}</span>}
              {m.architecture?.tokenizer && <span className="rounded bg-zinc-800 px-1 font-mono text-zinc-300">{m.architecture.tokenizer}</span>}
              {m.top_provider?.is_moderated && <span className="rounded bg-amber-500/10 px-1 font-mono text-amber-300">moderated</span>}
            </div>
          </button>
        ))}
        {sorted.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + PAGE_SIZE)} className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 hover:border-zinc-500">
            Show more models ({sorted.length - shown} remaining)
          </button>
        )}
        {filtered.length === 0 && !models.isPending && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">No matching models.</div>
        )}
      </div>
      {selected && (
        <div className="rounded border border-cyan-500/30 bg-zinc-950 p-3" role="region" aria-label={`Model details: ${selected.id}`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-sm text-cyan-200">{selected.id}</span>
            <button type="button" onClick={() => setSelectedId(null)} className="text-[11px] text-zinc-400 underline">Close</button>
          </div>
          {selected.name && <p className="mt-0.5 text-xs text-zinc-300">{selected.name}</p>}
          {selected.description && <p className="mt-1 text-xs leading-relaxed text-zinc-400">{selected.description}</p>}
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-zinc-300 md:grid-cols-3">
            <div><dt className="text-zinc-400">Context</dt><dd>{selected.context_length?.toLocaleString() || '?'}</dd></div>
            <div><dt className="text-zinc-400">Input</dt><dd>{fmtPrice(selected.pricing?.prompt)}</dd></div>
            <div><dt className="text-zinc-400">Output</dt><dd>{fmtPrice(selected.pricing?.completion)}</dd></div>
            {selected.architecture?.modality && <div><dt className="text-zinc-400">Modality</dt><dd>{selected.architecture.modality}</dd></div>}
            {selected.architecture?.tokenizer && <div><dt className="text-zinc-400">Tokenizer</dt><dd>{selected.architecture.tokenizer}</dd></div>}
            {selected.top_provider?.max_completion_tokens != null && <div><dt className="text-zinc-400">Max completion</dt><dd>{selected.top_provider.max_completion_tokens.toLocaleString()}</dd></div>}
            {selected.top_provider?.is_moderated != null && <div><dt className="text-zinc-400">Moderated</dt><dd>{selected.top_provider.is_moderated ? 'yes' : 'no'}</dd></div>}
          </dl>
        </div>
      )}
    </div>
  );
}
