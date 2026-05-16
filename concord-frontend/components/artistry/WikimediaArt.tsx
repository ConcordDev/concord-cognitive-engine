'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Palette, Loader2, Search, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface WmImage { pageid: number; title: string; thumb?: string; imageinfo?: { url: string; width: number; height: number; descriptionshorturl?: string; extmetadata?: Record<string, { value: string }> } }

export function WikimediaArt() {
  const [query, setQuery] = useState('renaissance painting');
  const [hits, setHits] = useState<WmImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const search = useMutation({
    mutationFn: async () => {
      setError(null);
      const params = new URLSearchParams({
        action: 'query',
        generator: 'search',
        gsrnamespace: '6',
        gsrsearch: `filetype:bitmap ${query.trim()}`,
        gsrlimit: '20',
        prop: 'imageinfo|pageimages',
        iiprop: 'url|size|extmetadata',
        iiurlwidth: '320',
        pithumbsize: '320',
        format: 'json',
        origin: '*',
      });
      try {
        const r = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`);
        if (!r.ok) throw new Error(`wikimedia ${r.status}`);
        const j = await r.json();
        const pages = j.query?.pages || {};
        const list = Object.values(pages).map((p: unknown) => {
          const pg = p as { pageid: number; title: string; thumbnail?: { source: string }; imageinfo?: WmImage['imageinfo'][] };
          return {
            pageid: pg.pageid,
            title: pg.title,
            thumb: pg.thumbnail?.source,
            imageinfo: pg.imageinfo?.[0],
          } as WmImage;
        });
        setHits(list);
      } catch (e) { setHits([]); setError(e instanceof Error ? e.message : 'request failed'); }
    },
  });

  const meta = (h: WmImage, k: string) => h.imageinfo?.extmetadata?.[k]?.value?.replace(/<[^>]+>/g, '') || '';

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Wikimedia Commons art</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">commons.wikimedia.org · CC-licensed</span>
        </div>
        {hits.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="wikimedia-commons"
            apiUrl="https://commons.wikimedia.org/w/api.php"
            title={`Wikimedia art — "${query}" (${hits.length})`}
            content={hits.slice(0, 25).map((h, i) => `${i + 1}. ${h.title.replace('File:', '')}\n   Artist: ${meta(h, 'Artist') || '—'}\n   License: ${meta(h, 'LicenseShortName') || meta(h, 'License') || '—'}\n   ${h.imageinfo?.descriptionshorturl || ''}`).join('\n\n')}
            extraTags={['artistry', 'wikimedia', 'commons']}
            rawData={{ query, hits }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); if (query.trim()) search.mutate(); }} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search art (e.g. Hokusai, art nouveau, watercolor)…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <button type="submit" disabled={!query.trim() || search.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Search
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 max-h-[520px] overflow-y-auto">
        {hits.map((h) => (
          <a key={h.pageid} href={h.imageinfo?.descriptionshorturl || `https://commons.wikimedia.org/?curid=${h.pageid}`} target="_blank" rel="noopener noreferrer" className="group block rounded border border-zinc-800 bg-zinc-950 overflow-hidden hover:border-cyan-500/30">
            {h.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={h.thumb} alt={h.title} className="h-32 w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-32 items-center justify-center bg-zinc-900"><Palette className="h-8 w-8 text-zinc-700" /></div>
            )}
            <div className="px-2 py-1.5">
              <div className="line-clamp-1 text-[11px] text-white group-hover:text-cyan-300">{h.title.replace(/^File:|\.(jpg|jpeg|png|gif|webp)$/gi, '')}</div>
              <div className="line-clamp-1 text-[10px] text-zinc-500">{meta(h, 'Artist') || meta(h, 'Credit') || ''}</div>
              <div className="mt-0.5 flex items-center justify-between font-mono text-[9px] text-zinc-500">
                <span>{meta(h, 'LicenseShortName') || ''}</span>
                <ExternalLink className="h-2.5 w-2.5" />
              </div>
            </div>
          </a>
        ))}
        {hits.length === 0 && !search.isPending && !error && (
          <div className="col-span-full rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">Search the public Wikimedia Commons art collection.</div>
        )}
      </div>
    </div>
  );
}
