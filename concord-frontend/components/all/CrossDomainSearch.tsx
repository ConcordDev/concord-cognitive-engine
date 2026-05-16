'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Search, Loader2, FileText, ExternalLink } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface DtuHit { id: string; title?: string; content?: string; tags?: string[]; source?: string; createdAt?: string; kind?: string; domain?: string }

export function CrossDomainSearch() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<DtuHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: async () => {
      setError(null);
      try {
        const r = await apiHelpers.dtus.search(query.trim());
        const data = r.data as { dtus?: DtuHit[]; results?: DtuHit[] } | DtuHit[];
        const list = Array.isArray(data) ? data : (data.dtus || data.results || []);
        setHits(list as DtuHit[]);
      } catch (e) { setError(e instanceof Error ? e.message : 'search failed'); setHits([]); }
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Cross-domain DTU search</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/dtus/search · real substrate</span>
        </div>
        {hits.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-search"
            title={`DTU search — "${query}" (${hits.length} hits)`}
            content={`Query: ${query}\n\n${hits.slice(0, 25).map((h, i) => `${i + 1}. ${h.title || h.id} — ${(h.content || '').slice(0, 100)} [${(h.tags || []).slice(0, 4).join(', ')}]`).join('\n')}`}
            extraTags={['search', 'dtu-substrate']}
            rawData={{ query, hits }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search across all DTU domains…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {hits.map((h) => (
          <a key={h.id} href={`/lenses/dtus?id=${encodeURIComponent(h.id)}`} className="block rounded border border-zinc-800 bg-zinc-950 p-2 hover:border-cyan-500/30">
            <div className="flex items-start gap-2">
              <FileText className="mt-0.5 h-3.5 w-3.5 text-cyan-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="line-clamp-1 text-sm text-white">{h.title || h.id}</span>
                  {h.domain && <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-400">{h.domain}</span>}
                  {h.kind && <span className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-400">{h.kind}</span>}
                </div>
                <p className="line-clamp-2 text-[11px] text-zinc-500">{h.content}</p>
                <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-zinc-600">
                  {h.tags?.slice(0, 5).map((t) => <span key={t} className="rounded bg-zinc-800 px-1 text-zinc-400">{t}</span>)}
                  {h.source && <span>· source: {h.source}</span>}
                </div>
              </div>
              <ExternalLink className="mt-0.5 h-3 w-3 text-zinc-500" />
            </div>
          </a>
        ))}
        {hits.length === 0 && !search.isPending && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">Enter a query to search every DTU in your substrate.</div>
        )}
      </div>
    </div>
  );
}
