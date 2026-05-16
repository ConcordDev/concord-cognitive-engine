'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { HardHat, Loader2, Search, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface OshaResult {
  id?: string;
  title?: string;
  body?: string;
  url?: string;
  date?: string;
  type?: string;
  raw?: Record<string, unknown>;
}

// Uses OSHA's public CKAN-style catalog search endpoint:
// https://catalog.data.gov/api/3/action/package_search?q=osha+construction
// Returns real federal datasets / publications relevant to construction safety.
export function OshaIncidentSearch() {
  const [query, setQuery] = useState('construction fatality');
  const [hits, setHits] = useState<OshaResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: async () => {
      setError(null);
      try {
        const url = `https://catalog.data.gov/api/3/action/package_search?q=${encodeURIComponent('osha ' + query)}&rows=20`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`data.gov ${r.status}`);
        const j = await r.json();
        const results = (j.result?.results || []).map((p: Record<string, unknown>) => {
          const org = p.organization as { title?: string } | undefined;
          return {
            id: p.id as string,
            title: p.title as string,
            body: p.notes as string,
            url: `https://catalog.data.gov/dataset/${p.name as string}`,
            date: p.metadata_modified as string,
            type: org?.title || 'OSHA',
            raw: p,
          } as OshaResult;
        });
        setHits(results);
      } catch (e) { setHits([]); setError(e instanceof Error ? e.message : 'request failed'); }
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <HardHat className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">OSHA / federal construction datasets</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">catalog.data.gov CKAN · live</span>
        </div>
        {hits.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="data-gov-ckan"
            apiUrl={`https://catalog.data.gov/api/3/action/package_search?q=${encodeURIComponent('osha ' + query)}`}
            title={`OSHA datasets — "${query}" (${hits.length})`}
            content={hits.slice(0, 20).map((h, i) => `${i + 1}. ${h.title}\n   ${(h.body || '').slice(0, 200)}\n   ${h.url}`).join('\n\n')}
            extraTags={['construction', 'osha', 'datasets', 'safety']}
            rawData={{ query, hits }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search OSHA / construction safety datasets…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="space-y-1 max-h-[480px] overflow-y-auto">
        {hits.map((h) => (
          <a key={h.id} href={h.url} target="_blank" rel="noopener noreferrer" className="block rounded border border-zinc-800 bg-zinc-950 p-2.5 hover:border-cyan-500/30">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="line-clamp-1 text-sm text-white">{h.title}</span>
                  <span className="font-mono text-[10px] text-zinc-500">{h.type}</span>
                </div>
                {h.body && <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-400">{h.body}</p>}
                {h.date && <div className="mt-0.5 text-[10px] text-zinc-500">updated {new Date(h.date).toLocaleDateString()}</div>}
              </div>
              <ExternalLink className="h-3 w-3 shrink-0 text-zinc-500" />
            </div>
          </a>
        ))}
        {hits.length === 0 && !search.isPending && !error && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">Search real federal construction safety datasets.</div>
        )}
      </div>
    </div>
  );
}
