'use client';

/**
 * DreamLibrary — search + tag-cloud + calendar timeline over your dream
 * history. Wraps `dreams.search`, `dreams.tags`, `dreams.timeline`. Click
 * any result to open the DreamReader.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';

interface SearchDream {
  id: string;
  title?: string;
  prose?: string;
  fragmentCount?: number;
  composer?: string;
  composedAt?: number;
  scope?: string;
  priceCc?: number | null;
  tags?: string[];
}
interface TagEntry { tag: string; count: number }
interface TimelineDay {
  day: string;
  count: number;
  dreams: Array<{ id: string; title?: string; composedAt?: number; fragmentCount?: number; tags?: string[] }>;
}

type Mode = 'search' | 'timeline';

export function DreamLibrary({ onOpen, reloadKey }: { onOpen: (dreamId: string) => void; reloadKey: number }) {
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [scope, setScope] = useState<'' | 'public' | 'personal'>('');
  const [results, setResults] = useState<SearchDream[]>([]);
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [days, setDays] = useState<TimelineDay[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const runSearch = useCallback(async () => {
    setSearching(true);
    const r = await lensRun<{ ok: boolean; dreams?: SearchDream[] }>('dreams', 'search', {
      query: query.trim() || undefined,
      tag: activeTag || undefined,
      scope: scope || undefined,
    });
    if (r.data.ok) setResults(r.data.result?.dreams || []);
    setSearching(false);
    setLoadedOnce(true);
  }, [query, activeTag, scope]);

  const loadTags = useCallback(async () => {
    const r = await lensRun<{ ok: boolean; tags?: TagEntry[] }>('dreams', 'tags', {});
    if (r.data.ok) setTags(r.data.result?.tags || []);
  }, []);

  const loadTimeline = useCallback(async () => {
    const r = await lensRun<{ ok: boolean; days?: TimelineDay[] }>('dreams', 'timeline', {});
    if (r.data.ok) setDays(r.data.result?.days || []);
  }, []);

  useEffect(() => { void runSearch(); }, [runSearch, reloadKey]);
  useEffect(() => { void loadTags(); }, [loadTags, reloadKey]);
  useEffect(() => { if (mode === 'timeline') void loadTimeline(); }, [mode, loadTimeline, reloadKey]);

  const timelineEvents: TimelineEvent[] = days.flatMap((d) =>
    d.dreams.map((dr) => ({
      id: dr.id,
      label: dr.title || 'Dream',
      time: (dr.composedAt || 0) * 1000,
      tone: 'info' as const,
      detail: `${dr.fragmentCount ?? 0} fragments`,
    })),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode('search')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            mode === 'search' ? 'bg-purple-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Search
        </button>
        <button
          type="button"
          onClick={() => setMode('timeline')}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            mode === 'timeline' ? 'bg-purple-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Timeline
        </button>
      </div>

      {mode === 'search' && (
        <>
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runSearch(); }}
              placeholder="Search dream prose, titles, fragments…"
              className="min-w-[12rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600"
            />
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as '' | 'public' | 'personal')}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-300"
            >
              <option value="">All scopes</option>
              <option value="personal">Personal</option>
              <option value="public">Published</option>
            </select>
            <button
              type="button"
              onClick={() => void runSearch()}
              disabled={searching}
              className="rounded-lg bg-purple-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-600 disabled:opacity-50"
            >
              {searching ? '…' : 'Search'}
            </button>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wider text-zinc-400">Tags:</span>
              {activeTag && (
                <button
                  type="button"
                  onClick={() => setActiveTag(null)}
                  className="rounded bg-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-200 hover:bg-zinc-600"
                >
                  clear
                </button>
              )}
              {tags.map((t) => (
                <button
                  key={t.tag}
                  type="button"
                  onClick={() => setActiveTag(activeTag === t.tag ? null : t.tag)}
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                    activeTag === t.tag
                      ? 'bg-purple-700 text-white'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  {t.tag} · {t.count}
                </button>
              ))}
            </div>
          )}

          {loadedOnce && results.length === 0 ? (
            <p className="rounded-xl border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-600">
              No dreams match this search.
            </p>
          ) : (
            <ul className="space-y-2">
              {results.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(d.id)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-left hover:border-purple-700/60 hover:bg-zinc-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-sm font-bold text-zinc-100">{d.title || 'Dream'}</h4>
                          {d.scope === 'public' && (
                            <span className="shrink-0 rounded bg-emerald-900/60 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-emerald-300">
                              {d.priceCc != null ? `${d.priceCc} CC` : 'published'}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{d.prose}</p>
                        <p className="mt-1 font-mono text-[10px] text-zinc-400">
                          {d.fragmentCount ?? 0} fragments ·{' '}
                          {d.composedAt ? new Date(d.composedAt * 1000).toLocaleDateString() : '—'}
                        </p>
                        {d.tags && d.tags.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {d.tags.map((t) => (
                              <span key={t} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-400">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {mode === 'timeline' && (
        <>
          {timelineEvents.length > 0 ? (
            <TimelineView events={timelineEvents} height={140} onSelect={(e) => onOpen(e.id)} />
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-600">
              No dreams to plot yet.
            </p>
          )}
          <ul className="space-y-2">
            {days.map((d) => (
              <li key={d.day} className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-200">
                    {new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, {
                      weekday: 'short', month: 'short', day: 'numeric',
                    })}
                  </span>
                  <span className="font-mono text-[10px] text-zinc-400">{d.count} dream{d.count === 1 ? '' : 's'}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {d.dreams.map((dr) => (
                    <button
                      key={dr.id}
                      type="button"
                      onClick={() => onOpen(dr.id)}
                      className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 hover:border-purple-700/60 hover:text-zinc-100"
                    >
                      {dr.title || 'Dream'} · {dr.fragmentCount ?? 0}f
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
