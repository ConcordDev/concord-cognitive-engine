'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Film, Loader2, Search, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { publicLookup, carryLookupMeta, lookupMeta } from '@/lib/public-lookup';

interface Meme { id: string; name: string; url: string; width: number; height: number; box_count: number; captions?: number }

export function AnimationReference() {
  const [query, setQuery] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => { void tick; }, [tick]);

  const memes = useQuery({
    queryKey: ['imgflip-memes'],
    queryFn: async () => {
      const j = await publicLookup<{ success?: boolean; data?: { memes?: Meme[] } }>('imgflip-memes', {});
      if (!j.success) throw new Error('imgflip unavailable');
      const items = (j.data?.memes || []) as Meme[];
      carryLookupMeta(j, items);
      return items;
    },
    refetchInterval: false,
    staleTime: 60 * 60 * 1000,
  });

  const meta = lookupMeta(memes.data);
  const filtered = (memes.data || []).filter((m) => !query.trim() || m.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--lt-blue,#0891b2)] pb-3">
        <div className="flex items-center gap-2">
          <Film className="h-5 w-5 text-[var(--lt-blue,#22d3ee)]" />
          <h2 className="text-sm font-semibold text-[var(--lt-graphite,#fff)]">Frame templates</h2>
          <span className="rounded bg-[var(--lt-chip,#27272a)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--lt-muted,#a1a1aa)]">imgflip · via Concord server · 100 most-used compositions</span>
        </div>
        {memes.data && memes.data.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="imgflip"
            apiUrl="https://imgflip.com/"
            title={`Frame templates — ${filtered.length}${query ? ` matching "${query}"` : ''}`}
            content={filtered.slice(0, 30).map((m, i) => `${i + 1}. ${m.name} (${m.width}×${m.height}, ${m.box_count} panels) — ${m.url}`).join('\n')}
            extraTags={['animation', 'reference', 'compositions']}
            rawData={{ query, memes: filtered.slice(0, 50) }}
          />
        )}
      </header>
      <form onSubmit={(e) => e.preventDefault()} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--lt-muted,#a1a1aa)]" />
          <input type="text" value={query} onChange={(e) => { setQuery(e.target.value); setTick((t) => t + 1); }} placeholder="Filter compositions (e.g. drake, distracted boyfriend)…" className="w-full rounded-md border border-[var(--lt-line-2,#27272a)] bg-[var(--lt-input,#09090b)] py-1.5 pl-8 pr-3 text-sm text-[var(--lt-graphite,#fff)]" />
        </div>
        <span className="font-mono text-[10px] text-[var(--lt-muted,#a1a1aa)]">{filtered.length} / {memes.data?.length ?? '—'}</span>
      </form>
      {memes.isError && <div className="rounded border border-[#f2c3bc] bg-red-500/5 px-3 py-2 text-xs text-[var(--lt-bad,#fb7185)]">Imgflip is unavailable right now — nothing is being shown in its place.</div>}
      {meta?.stale && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">Showing cached Imgflip data{meta.fetchedAt ? ` from ${new Date(meta.fetchedAt).toLocaleString()}` : ''} — live source unavailable.</div>}
      {memes.isPending && <div className="flex items-center gap-2 text-xs text-[var(--lt-muted,#a1a1aa)]"><Loader2 className="h-4 w-4 animate-spin" /> Fetching reference templates…</div>}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 max-h-[480px] overflow-y-auto">
        {filtered.slice(0, 40).map((m) => (
          <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer" className="group block rounded border border-[var(--lt-line-2,#27272a)] bg-[var(--lt-input,#09090b)] overflow-hidden hover:border-[var(--lt-blue,#0891b2)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={m.url} alt={m.name} className="h-24 w-full object-cover" loading="lazy" />
            <div className="px-1.5 py-1">
              <div className="line-clamp-1 text-[10px] text-[var(--lt-graphite-2,#d4d4d8)] group-hover:text-[var(--lt-blue,#22d3ee)]">{m.name}</div>
              <div className="flex items-center justify-between font-mono text-[9px] text-[var(--lt-muted,#a1a1aa)]">
                <span>{m.width}×{m.height}</span>
                <span>{m.box_count}p<ExternalLink className="ml-1 inline h-2 w-2" /></span>
              </div>
            </div>
          </a>
        ))}
        {filtered.length === 0 && !memes.isPending && !memes.isError && (
          <div className="col-span-full rounded border border-dashed border-[var(--lt-line-2,#27272a)] p-6 text-center text-[11px] text-[var(--lt-muted,#a1a1aa)]">No templates match.</div>
        )}
      </div>
    </div>
  );
}
