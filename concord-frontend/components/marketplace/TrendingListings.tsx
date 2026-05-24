'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBag, Loader2, Tag } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface TrendingItem { id: string; title?: string; kind?: string; citation_count?: number; created_at?: number; creator_id?: string; tags?: string[]; }

export function TrendingListings() {
  const [windowHours, setWindowHours] = useState(168);

  const trending = useQuery({
    queryKey: ['marketplace-trending', windowHours],
    queryFn: async () => {
      const r = await lensRun({ domain: 'discovery', name: 'trending', input: { windowHours, limit: 30 } });
      const data = r.data as { ok: boolean; result?: TrendingItem[] | { items?: TrendingItem[] }; items?: TrendingItem[] };
      const arr = Array.isArray(data.result) ? data.result : (data.result as { items?: TrendingItem[] })?.items || data.items || [];
      return arr as TrendingItem[];
    },
    refetchInterval: 60000,
  });

  const list = trending.data || [];
  const totalCitations = list.reduce((a, x) => a + (x.citation_count || 0), 0);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><ShoppingBag className="h-5 w-5 text-emerald-400" /><h2 className="text-sm font-semibold text-white">Trending in marketplace</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">discovery.trending · live</span></div>
        <div className="flex items-center gap-2">
          <select value={windowHours} onChange={(e) => setWindowHours(Number(e.target.value))} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            <option value={24}>last 24h</option>
            <option value={168}>last 7d</option>
            <option value={720}>last 30d</option>
          </select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="concord-marketplace" title={`Marketplace trending — ${windowHours}h (${list.length})`} content={list.slice(0, 20).map((x, i) => `${i + 1}. [${x.citation_count ?? 0} cites] ${x.title || x.id} · ${x.kind || '—'}`).join('\n')} extraTags={['marketplace', 'trending', 'concord']} rawData={{ windowHours, trending: list }} />}
        </div>
      </header>
      {trending.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">discovery.trending unreachable.</div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Trending</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-400">Citations</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{totalCitations.toLocaleString()}</div></div>
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {list.map((x) => (
          <div key={x.id} className="rounded border border-emerald-500/15 bg-emerald-500/5 p-2 text-[11px]">
            <div className="flex items-center justify-between gap-2">
              <span className="line-clamp-1 text-zinc-100">{x.title || x.id}</span>
              <span className="shrink-0 font-mono text-[10px] text-emerald-300">{x.citation_count ?? 0} cites</span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-zinc-400">
              {x.kind && <span className="rounded bg-zinc-800 px-1 font-mono">{x.kind}</span>}
              {x.creator_id && <span className="font-mono">by {x.creator_id.slice(0, 8)}</span>}
              {x.tags && x.tags.slice(0, 3).map((t) => <span key={t} className="inline-flex items-center gap-0.5"><Tag className="h-2.5 w-2.5" />{t}</span>)}
            </div>
          </div>
        ))}
        {list.length === 0 && !trending.isPending && !trending.isError && <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No trending in this window.</div>}
      </div>
      {trending.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling…</div>}
    </div>
  );
}
