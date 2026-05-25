'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MessageSquare, Loader2, Search, ExternalLink, ArrowUp, Calendar } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface HnHit {
  objectID: string;
  title?: string;
  url?: string;
  author?: string;
  points?: number;
  num_comments?: number;
  created_at: string;
  story_text?: string;
  _tags?: string[];
}

export function HackerNewsReference() {
  const [query, setQuery] = useState('');
  const [byDate, setByDate] = useState(false);
  const [hits, setHits] = useState<HnHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: async () => {
      setError(null);
      const endpoint = byDate ? 'search_by_date' : 'search';
      try {
        const r = await fetch(`https://hn.algolia.com/api/v1/${endpoint}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=20`);
        if (!r.ok) throw new Error(`algolia ${r.status}`);
        const j = await r.json();
        setHits(j.hits || []);
      } catch (e) { setHits([]); setError(e instanceof Error ? e.message : 'request failed'); }
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Hacker News reference</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">hn.algolia.com · live</span>
        </div>
        {hits.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="hn-algolia"
            apiUrl={`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}`}
            title={`HN search — "${query}" (${hits.length})`}
            content={hits.slice(0, 20).map((h, i) => `${i + 1}. ${h.title || '(no title)'} [${h.points || 0}↑ · ${h.num_comments || 0} comments]\n   by ${h.author} · ${new Date(h.created_at).toLocaleDateString()}\n   ${h.url || `https://news.ycombinator.com/item?id=${h.objectID}`}`).join('\n\n')}
            extraTags={['chat', 'hacker-news', 'reference']}
            rawData={{ query, byDate, hits }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Hacker News stories…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
          <input type="checkbox" checked={byDate} onChange={(e) => setByDate(e.target.checked)} />
          newest first
        </label>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {hits.map((h) => (
          <a key={h.objectID} href={h.url || `https://news.ycombinator.com/item?id=${h.objectID}`} target="_blank" rel="noopener noreferrer" className="block rounded border border-zinc-800 bg-zinc-950 p-2 hover:border-cyan-500/30">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="line-clamp-1 text-sm text-white">{h.title || '(no title)'}</div>
                <div className="mt-0.5 flex items-center gap-x-3 text-[10px] text-zinc-400">
                  <span className="flex items-center gap-0.5"><ArrowUp className="h-3 w-3" />{h.points || 0}</span>
                  <span><MessageSquare className="mr-0.5 inline h-3 w-3" />{h.num_comments || 0}</span>
                  <span>{h.author}</span>
                  <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" />{new Date(h.created_at).toLocaleDateString()}</span>
                </div>
                {h.story_text && <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-400">{h.story_text.replace(/<[^>]+>/g, '')}</p>}
              </div>
              <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
            </div>
          </a>
        ))}
        {hits.length === 0 && !search.isPending && !error && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">Search HN for context to drop into your chat.</div>
        )}
      </div>
    </div>
  );
}
