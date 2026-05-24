'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Film, Loader2, Search, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Meme { id: string; name: string; url: string; width: number; height: number; box_count: number; captions?: number }

export function AnimationReference() {
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { void tick; }, [tick]);

  const memes = useQuery({
    queryKey: ['imgflip-memes'],
    queryFn: async () => {
      const r = await fetch('https://api.imgflip.com/get_memes');
      if (!r.ok) throw new Error(`imgflip ${r.status}`);
      const j = await r.json();
      if (!j.success) throw new Error('imgflip returned failure');
      return (j.data?.memes || []) as Meme[];
    },
    refetchInterval: false,
    staleTime: 60 * 60 * 1000,
  });

  const filtered = (memes.data || []).filter((m) => !query.trim() || m.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Film className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Frame templates</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">imgflip · 100 most-used compositions</span>
        </div>
        {memes.data && memes.data.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="imgflip"
            apiUrl="https://api.imgflip.com/get_memes"
            title={`Frame templates — ${filtered.length}${query ? ` matching "${query}"` : ''}`}
            content={filtered.slice(0, 30).map((m, i) => `${i + 1}. ${m.name} (${m.width}×${m.height}, ${m.box_count} panels) — ${m.url}`).join('\n')}
            extraTags={['animation', 'reference', 'compositions']}
            rawData={{ query, memes: filtered.slice(0, 50) }}
          />
        )}
      </header>
      <form onSubmit={(e) => e.preventDefault()} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => { setQuery(e.target.value); setTick((t) => t + 1); }} placeholder="Filter compositions (e.g. drake, distracted boyfriend)…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <span className="font-mono text-[10px] text-zinc-400">{filtered.length} / {memes.data?.length ?? '—'}</span>
      </form>
      {memes.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">imgflip unreachable.</div>}
      {memes.isPending && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Fetching reference templates…</div>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 max-h-[480px] overflow-y-auto">
        {filtered.slice(0, 40).map((m) => (
          <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer" className="group block rounded border border-zinc-800 bg-zinc-950 overflow-hidden hover:border-cyan-500/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt={m.name} className="h-24 w-full object-cover" loading="lazy" />
            <div className="px-1.5 py-1">
              <div className="line-clamp-1 text-[10px] text-zinc-300 group-hover:text-cyan-300">{m.name}</div>
              <div className="flex items-center justify-between font-mono text-[9px] text-zinc-400">
                <span>{m.width}×{m.height}</span>
                <span>{m.box_count}p<ExternalLink className="ml-1 inline h-2 w-2" /></span>
              </div>
            </div>
          </a>
        ))}
        {filtered.length === 0 && !memes.isPending && !memes.isError && (
          <div className="col-span-full rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">No templates match.</div>
        )}
      </div>
    </div>
  );
}
