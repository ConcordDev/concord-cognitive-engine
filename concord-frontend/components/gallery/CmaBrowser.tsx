'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Image as ImageIcon, Loader2, Search } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Work {
  id: number; accessionNumber?: string;
  title?: string; creators?: string[]; culture?: string;
  creationDate?: string; type?: string; medium?: string; department?: string;
  image?: string; imageThumb?: string; url?: string; copyright?: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('gallery', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function CmaBrowser() {
  const [query, setQuery] = useState('');
  const [works, setWorks] = useState<Work[]>([]);
  const search = useMutation({
    mutationFn: async () => callMacro<{ works: Work[] }>('cma-search', { query: query.trim(), hasImage: true, limit: 24 }),
    onSuccess: (env) => { if (env.ok && env.result) setWorks(env.result.works); else setWorks([]); },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Cleveland Museum of Art</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">~32k CC0 artworks</span>
        </div>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="van gogh, cypresses, ukiyo-e…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white placeholder-zinc-600 focus:border-cyan-500/40 focus:outline-none" />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>

      {works.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {works.map((w) => (
            <motion.div key={w.id} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/40">
              <div className="relative aspect-square w-full bg-zinc-900">
                {w.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.imageThumb || w.image} alt={w.title || ''} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center"><ImageIcon className="h-6 w-6 text-zinc-700" /></div>
                )}
                <span className="absolute right-1 top-1 rounded bg-emerald-500/20 px-1.5 text-[9px] font-bold uppercase text-emerald-300">CC0</span>
              </div>
              <div className="p-2 text-[11px]">
                <div className="line-clamp-2 text-white">{w.title}</div>
                {w.creators?.[0] && <div className="line-clamp-1 text-[10px] text-zinc-500">{w.creators[0]}</div>}
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[9px] font-mono text-zinc-600">{w.creationDate || w.type}</span>
                  <SaveAsDtuButton
                    compact
                    apiSource="cleveland-museum-of-art"
                    apiUrl={w.url}
                    title={`${w.title}${w.creators?.[0] ? ` — ${w.creators[0]}` : ''}`}
                    content={`Title: ${w.title}\nArtist: ${w.creators?.join(', ') || '—'}\nDate: ${w.creationDate || '—'}\nMedium: ${w.medium || '—'}\nDept: ${w.department || '—'}\nCMA: ${w.url}\nLicense: CC0`}
                    extraTags={['gallery', 'cma', 'cc0', (w.type || 'artwork').toLowerCase()]}
                    rawData={w}
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
