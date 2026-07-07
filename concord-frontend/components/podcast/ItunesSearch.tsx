'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Mic, Loader2, Search, ExternalLink, LibraryBig, Check } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { showToast } from '@/components/common/Toasts';

interface Podcast { collectionId: number; trackId?: number; title: string; artist?: string; genre?: string; artwork?: string; feedUrl?: string; episodeCount?: number; collectionUrl?: string; contentAdvisory?: string }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('podcast', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function ItunesSearch() {
  const [query, setQuery] = useState('');
  const [podcasts, setPodcasts] = useState<Podcast[]>([]);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const search = useMutation({
    mutationFn: async () => callMacro<{ podcasts: Podcast[] }>('itunes-search', { query: query.trim(), limit: 30 }),
    onSuccess: (env) => { if (env.ok && env.result) setPodcasts(env.result.podcasts); else setPodcasts([]); },
  });
  // Add-to-Library bridges an iTunes search result into the real listening
  // engine (podcastLens STATE in server/domains/podcast.js) — show-add +
  // an immediate rss-refresh so it shows up in the Listening Hub with real
  // episodes, not just as a bookmarked DTU nobody can subscribe to or play.
  const addToLibrary = useMutation({
    mutationFn: async (p: Podcast) => {
      const added = await callMacro<{ show: { id: string } }>('show-add', {
        title: p.title, author: p.artist, category: p.genre, feedUrl: p.feedUrl,
      });
      if (!added.ok || !added.result) throw new Error(added.error || 'could not add show');
      const showId = added.result.show.id;
      if (p.feedUrl) {
        const refreshed = await callMacro<{ ingested: number }>('rss-refresh', { showId, feedUrl: p.feedUrl });
        if (!refreshed.ok) throw new Error(refreshed.error || 'feed unreachable');
      }
      return { showId, collectionId: p.collectionId };
    },
    onSuccess: ({ collectionId }) => {
      setAddedIds((prev) => new Set(prev).add(collectionId));
      showToast('success', 'Added to your library');
    },
    onError: (e) => showToast('error', e instanceof Error ? e.message : 'Could not add to library'),
  });
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Podcast Search</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">apple podcasts · itunes</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Show name or topic — Lex Fridman, 99% Invisible, hardcore history…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {podcasts.map((p) => (
          <motion.div key={p.collectionId} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-3 rounded border border-zinc-800 bg-zinc-950 p-3">
            {p.artwork && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.artwork} alt={p.title} className="h-16 w-16 shrink-0 rounded object-cover" loading="lazy" />
            )}
            <div className="min-w-0 flex-1">
              <div className="font-medium text-white line-clamp-2 text-sm">{p.title}</div>
              <div className="text-[11px] text-zinc-400">{p.artist}</div>
              <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-400">
                {p.genre && <span className="rounded bg-zinc-800 px-1.5">{p.genre}</span>}
                {p.episodeCount != null && <span>{p.episodeCount} episodes</span>}
                {p.contentAdvisory === 'Explicit' && <span className="text-rose-400">explicit</span>}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => addToLibrary.mutate(p)}
                disabled={addedIds.has(p.collectionId) || (addToLibrary.isPending && addToLibrary.variables?.collectionId === p.collectionId)}
                title="Add to your library — subscribe and pull episodes into the Listening Hub"
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-60"
              >
                {addedIds.has(p.collectionId) ? <Check className="h-3 w-3" /> : addToLibrary.isPending && addToLibrary.variables?.collectionId === p.collectionId ? <Loader2 className="h-3 w-3 animate-spin" /> : <LibraryBig className="h-3 w-3" />}
                {addedIds.has(p.collectionId) ? 'Added' : 'Add to Library'}
              </button>
              <SaveAsDtuButton
                compact
                apiSource="itunes-podcasts"
                apiUrl={p.collectionUrl}
                title={`${p.title} — ${p.artist}`}
                content={`Podcast: ${p.title}\nHost: ${p.artist}\nGenre: ${p.genre}\nEpisodes: ${p.episodeCount}\nFeed: ${p.feedUrl}\nApple Podcasts: ${p.collectionUrl}`}
                extraTags={['podcast', 'itunes', (p.genre || 'podcast').toLowerCase().replace(/\s+/g, '-')]}
                rawData={p}
              />
              {p.collectionUrl && <a href={p.collectionUrl} target="_blank" rel="noopener noreferrer" className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" aria-label="apple"><ExternalLink className="h-3 w-3" /></a>}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
