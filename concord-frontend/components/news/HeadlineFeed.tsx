'use client';

import { useEffect, useState } from 'react';
import { Newspaper, Loader2, ExternalLink, Bookmark, BookmarkCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Headline {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  excerpt: string;
  category: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  imageUrl?: string;
}

const STORAGE_KEY = 'concord:news:saved:v1';
function loadSaved(): string[] { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
function saveSaved(ids: string[]) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); } catch { /* noop */ } }

const CATEGORIES = ['top', 'world', 'us', 'business', 'tech', 'science', 'health', 'sports', 'entertainment'];

export function HeadlineFeed() {
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('top');
  const [saved, setSaved] = useState<string[]>([]);
  // FIX-news-002: sort + source filter over the loaded list — the desk
  // previously offered only category chips, so 'Top' could not be
  // re-ordered or narrowed to one source.
  const [sort, setSort] = useState<'newest' | 'oldest' | 'source'>('newest');
  const [sourceFilter, setSourceFilter] = useState('all');
  const sources = Array.from(new Set(headlines.map((h) => h.source).filter(Boolean))).sort();
  const visible = headlines
    .filter((h) => sourceFilter === 'all' || h.source === sourceFilter)
    .slice()
    .sort((a, b) => (sort === 'source'
      ? a.source.localeCompare(b.source) || +new Date(b.publishedAt) - +new Date(a.publishedAt)
      : sort === 'oldest'
        ? +new Date(a.publishedAt) - +new Date(b.publishedAt)
        : +new Date(b.publishedAt) - +new Date(a.publishedAt)));

  useEffect(() => { setSaved(loadSaved()); }, []);
  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await lensRun({ domain: 'news', action: 'headlines', input: { category, limit: 30 } });
        setHeadlines((res.data?.result?.headlines || []) as Headline[]);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, [category]);

  function toggleSave(id: string) {
    setSaved(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      saveSaved(next);
      return next;
    });
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Newspaper className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Headlines</span>
        <span className="ml-auto text-[10px] text-gray-400">{visible.length} of {headlines.length} stories</span>
      </header>
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-1 overflow-x-auto">
        {CATEGORIES.map(c => (
          <button key={c} onClick={() => { setCategory(c); setSourceFilter('all'); }} className={cn('px-2 py-0.5 text-[10px] uppercase tracking-wider rounded',
            category === c ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-400 hover:text-white'
          )}>{c}</button>
        ))}
      </div>
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
        <label className="text-[10px] uppercase tracking-wider text-gray-400">Sort
          <select aria-label="Sort headlines" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="ml-1.5 rounded border border-white/10 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-200">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="source">Source A–Z</option>
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-wider text-gray-400">Source
          <select aria-label="Filter by source" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="ml-1.5 rounded border border-white/10 bg-zinc-900 px-1.5 py-1 text-[11px] text-zinc-200">
            <option value="all">All sources</option>
            {sources.map((src) => <option key={src} value={src}>{src}</option>)}
          </select>
        </label>
      </div>
      <div className="max-h-[600px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map(h => {
              const isSaved = saved.includes(h.id);
              return (
                <li key={h.id} className="px-3 py-2 hover:bg-white/[0.03]">
                  <div className="flex items-start gap-3">
                    <span className={cn('mt-1 w-1 h-12 rounded',
                      h.sentiment === 'positive' ? 'bg-green-500' :
                      h.sentiment === 'negative' ? 'bg-red-500' : 'bg-gray-500'
                    )} />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-white">{h.title}</h3>
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">{h.excerpt}</p>
                      <div className="text-[10px] text-gray-400 mt-1 flex items-center gap-2">
                        <span className="text-cyan-300">{h.source}</span>
                        <span>{new Date(h.publishedAt).toLocaleString()}</span>
                        <span className="uppercase">{h.category}</span>
                        <a href={h.url} target="_blank" rel="noreferrer noopener" className="text-cyan-300 hover:text-cyan-100 inline-flex items-center gap-0.5 ml-auto"><ExternalLink className="w-3 h-3" /> Read</a>
                      </div>
                    </div>
                    <button onClick={() => toggleSave(h.id)} className="p-1 text-gray-400 hover:text-yellow-400" title={isSaved ? 'Unsave' : 'Save'}>
                      {isSaved ? <BookmarkCheck className="w-4 h-4 text-yellow-400" /> : <Bookmark className="w-4 h-4" />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
export default HeadlineFeed;
