'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Mic, Loader2, Search, ExternalLink } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

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
  const search = useMutation({
    mutationFn: async () => callMacro<{ podcasts: Podcast[] }>('itunes-search', { query: query.trim(), limit: 30 }),
    onSuccess: (env) => { if (env.ok && env.result) setPodcasts(env.result.podcasts); else setPodcasts([]); },
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
