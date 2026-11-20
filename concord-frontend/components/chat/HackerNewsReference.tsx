'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { MessageSquare, Loader2, Search, ExternalLink, ArrowUp, Calendar } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { publicLookup, lookupMeta } from '@/lib/public-lookup';

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
  const [noticeData, setNoticeData] = useState<unknown>(null);

  const search = useMutation({
    mutationFn: async () => {
      setError(null);
      try {
        const j = await publicLookup<{ hits?: HnHit[] }>('hn-search', { q: query, tags: 'story', byDate });
        setHits(j.hits || []);
        setNoticeData(j);
      } catch (e) { setHits([]); setNoticeData(null); setError('Hacker News is unavailable right now — nothing is being shown in its place.'); }
    },
  });

  const noticeMeta = lookupMeta(noticeData);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-[color:var(--nb-blue,rgba(6,182,212,0.15))] pb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-[color:var(--nb-blue,#22d3ee)]" />
          <h2 className="text-sm font-semibold text-[color:var(--nb-ink,#ffffff)]">Hacker News reference</h2>
          <span className="rounded bg-[var(--nb-wash,#27272a)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--nb-muted,#a1a1aa)]">Hacker News · via Concord server</span>
        </div>
        {hits.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="hn-algolia"
            apiUrl={`https://hn.algolia.com/?q=${encodeURIComponent(query)}`}
            title={`HN search — "${query}" (${hits.length})`}
            content={hits.slice(0, 20).map((h, i) => `${i + 1}. ${h.title || '(no title)'} [${h.points || 0}↑ · ${h.num_comments || 0} comments]\n   by ${h.author} · ${new Date(h.created_at).toLocaleDateString()}\n   ${h.url || `https://news.ycombinator.com/item?id=${h.objectID}`}`).join('\n\n')}
            extraTags={['chat', 'hacker-news', 'reference']}
            rawData={{ query, byDate, hits }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[color:var(--nb-muted,#a1a1aa)]" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Hacker News stories…" className="w-full rounded-md border border-[color:var(--nb-rule,#27272a)] bg-[var(--nb-paper,#09090b)] py-1.5 pl-8 pr-3 text-sm text-[color:var(--nb-ink,#ffffff)]" />
        </div>
        <label className="flex items-center gap-1 text-[11px] text-[color:var(--nb-muted,#a1a1aa)]">
          <input type="checkbox" checked={byDate} onChange={(e) => setByDate(e.target.checked)} />
          newest first
        </label>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--nb-blue,rgba(6,182,212,0.3))] bg-[var(--nb-blue-soft,rgba(6,182,212,0.1))] px-3 py-1.5 text-xs text-[color:var(--nb-blue,#a5f3fc)] hover:bg-[var(--nb-blue-soft,rgba(6,182,212,0.2))] disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <div className="rounded border border-[color:var(--nb-red,rgba(239,68,68,0.2))] bg-[var(--nb-red-soft,rgba(239,68,68,0.05))] px-3 py-2 text-xs text-[color:var(--nb-red,#fca5a5)]">{error}</div>}
      {noticeMeta?.stale && <div className="rounded border border-[color:var(--nb-ochre,rgba(245,158,11,0.2))] bg-[var(--nb-hl,rgba(245,158,11,0.05))] px-3 py-2 text-xs text-[color:var(--nb-ochre,#fcd34d)]">Showing cached Hacker News results{noticeMeta.fetchedAt ? ` from ${new Date(noticeMeta.fetchedAt).toLocaleString()}` : ''} — live source unavailable.</div>}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {hits.map((h) => (
          <a key={h.objectID} href={h.url || `https://news.ycombinator.com/item?id=${h.objectID}`} target="_blank" rel="noopener noreferrer" className="block rounded border border-[color:var(--nb-rule,#27272a)] bg-[var(--nb-paper,#09090b)] p-2 hover:border-[color:var(--nb-blue,rgba(6,182,212,0.3))]">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="line-clamp-1 text-sm text-[color:var(--nb-ink,#ffffff)]">{h.title || '(no title)'}</div>
                <div className="mt-0.5 flex items-center gap-x-3 text-[10px] text-[color:var(--nb-muted,#a1a1aa)]">
                  <span className="flex items-center gap-0.5"><ArrowUp className="h-3 w-3" />{h.points || 0}</span>
                  <span><MessageSquare className="mr-0.5 inline h-3 w-3" />{h.num_comments || 0}</span>
                  <span>{h.author}</span>
                  <span className="flex items-center gap-0.5"><Calendar className="h-3 w-3" />{new Date(h.created_at).toLocaleDateString()}</span>
                </div>
                {h.story_text && <p className="mt-0.5 line-clamp-2 text-[11px] text-[color:var(--nb-muted,#a1a1aa)]">{h.story_text.replace(/<[^>]+>/g, '')}</p>}
              </div>
              <ExternalLink className="h-3 w-3 shrink-0 text-[color:var(--nb-muted,#a1a1aa)]" />
            </div>
          </a>
        ))}
        {hits.length === 0 && !search.isPending && !error && (
          <div className="rounded border border-dashed border-[color:var(--nb-rule,#27272a)] p-6 text-center text-[11px] text-[color:var(--nb-muted,#a1a1aa)]">Search HN for context to drop into your chat.</div>
        )}
      </div>
    </div>
  );
}
