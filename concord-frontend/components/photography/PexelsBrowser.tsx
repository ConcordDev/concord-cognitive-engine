'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Camera, Loader2, Search } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Photo { id: number; photographer: string; photographerUrl?: string; width: number; height: number; avgColor?: string; largeUrl?: string; mediumUrl?: string; pexelsUrl?: string; alt?: string }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('photography', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function PexelsBrowser() {
  const [query, setQuery] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const search = useMutation({
    mutationFn: async () => callMacro<{ photos: Photo[] }>('pexels-search', { query: query.trim(), perPage: 24 }),
    onSuccess: (env) => { if (env.ok && env.result) { setPhotos(env.result.photos); setError(null); } else { setPhotos([]); setError(env.error || 'failed'); } },
  });
  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Camera className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Pexels Stock Photos</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">pexels · free api key</span>
        </div>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="mountain · sunrise · cyberpunk · macro flower…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((p) => (
            <motion.div key={p.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
              <div className="relative aspect-square w-full" style={{ background: p.avgColor || '#0a0a0a' }}>
                {p.mediumUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.mediumUrl} alt={p.alt || ''} loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="space-y-0.5 p-2 text-[10px]">
                <div className="line-clamp-1 text-white">{p.alt || `Photo ${p.id}`}</div>
                <div className="flex items-center justify-between text-zinc-500">
                  <span>{p.photographer}</span>
                  <SaveAsDtuButton
                    compact
                    apiSource="pexels"
                    apiUrl={p.pexelsUrl}
                    title={`Pexels ${p.id} — ${p.photographer}`}
                    content={`Photographer: ${p.photographer}\nResolution: ${p.width}×${p.height}\nAvg color: ${p.avgColor}\nLarge: ${p.largeUrl}\nPexels: ${p.pexelsUrl}\nAlt text: ${p.alt}`}
                    extraTags={['photography', 'pexels', 'stock']}
                    rawData={p}
                  />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
