'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Box, Loader2, Search, ExternalLink, Heart, Eye } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface SfModel {
  uid: string;
  name: string;
  description?: string;
  thumbnails?: { images?: { url: string; width: number; height: number }[] };
  viewerUrl: string;
  embedUrl: string;
  user: { username: string; displayName: string };
  likeCount: number;
  viewCount: number;
  vertexCount: number;
  faceCount: number;
  isDownloadable: boolean;
  staffpickedAt?: string;
  categories?: { name: string; slug: string }[];
  tags?: { name: string; slug: string }[];
}

export function SketchfabModels() {
  const [query, setQuery] = useState('');
  const [downloadable, setDownloadable] = useState(true);
  const [hits, setHits] = useState<SfModel[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => {
      setError(null);
      const qs = new URLSearchParams();
      if (query.trim()) qs.set('q', query.trim());
      if (downloadable) qs.set('downloadable', 'true');
      qs.set('archives_flavours', 'false');
      qs.set('count', '20');
      qs.set('sort_by', '-likeCount');
      try {
        const r = await fetch(`https://api.sketchfab.com/v3/search?type=models&${qs.toString()}`);
        if (!r.ok) throw new Error(`sketchfab ${r.status}`);
        const j = await r.json();
        setHits((j.results || []) as SfModel[]);
      } catch (e) { setHits([]); setError(e instanceof Error ? e.message : 'request failed'); }
    },
  });

  const thumb = (m: SfModel) => {
    const imgs = m.thumbnails?.images || [];
    const small = imgs.find((i) => i.width >= 200 && i.width <= 400) || imgs[0];
    return small?.url;
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Box className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Sketchfab models</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">api.sketchfab.com v3 · no key</span>
        </div>
        {hits.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="sketchfab"
            apiUrl={`https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(query)}`}
            title={`Sketchfab models — "${query || 'top'}"`}
            content={hits.slice(0, 25).map((m, i) => `${i + 1}. ${m.name} by ${m.user.displayName} (${m.likeCount}♥/${m.viewCount}👁) — ${m.vertexCount.toLocaleString()}v/${m.faceCount.toLocaleString()}f ${m.isDownloadable ? '⬇' : ''}\n   ${m.viewerUrl}`).join('\n\n')}
            extraTags={['ar', 'sketchfab', '3d-models']}
            rawData={{ query, downloadable, hits }}
          />
        )}
      </header>
      <form onSubmit={(e) => { e.preventDefault(); load.mutate(); }} className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search 3D models…" className="w-full rounded-md border border-zinc-800 bg-zinc-950 py-1.5 pl-8 pr-3 text-sm text-white" />
        </div>
        <label className="flex items-center gap-1 text-[11px] text-zinc-400">
          <input type="checkbox" checked={downloadable} onChange={(e) => setDownloadable(e.target.checked)} className="rounded border-zinc-700 bg-zinc-950" />
          Downloadable only
        </label>
        <button type="submit" disabled={load.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Browse
        </button>
      </form>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 max-h-[520px] overflow-y-auto">
        {hits.map((m) => (
          <a key={m.uid} href={m.viewerUrl} target="_blank" rel="noopener noreferrer" className="group block rounded border border-zinc-800 bg-zinc-950 overflow-hidden hover:border-cyan-500/30">
            {thumb(m) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb(m)} alt={m.name} className="h-32 w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-32 items-center justify-center bg-zinc-900"><Box className="h-8 w-8 text-zinc-700" /></div>
            )}
            <div className="px-2 py-1.5">
              <div className="line-clamp-1 text-[11px] text-white group-hover:text-cyan-300">{m.name}</div>
              <div className="line-clamp-1 text-[10px] text-zinc-400">{m.user.displayName}</div>
              <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-zinc-400">
                <span className="flex items-center gap-1"><Heart className="h-2.5 w-2.5" />{m.likeCount}</span>
                <span className="flex items-center gap-1"><Eye className="h-2.5 w-2.5" />{m.viewCount.toLocaleString()}</span>
                {m.isDownloadable && <span className="rounded bg-emerald-500/20 px-1 text-emerald-300">⬇</span>}
                <ExternalLink className="h-2.5 w-2.5" />
              </div>
            </div>
          </a>
        ))}
        {hits.length === 0 && !load.isPending && !error && (
          <div className="col-span-full rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">Search for 3D models to anchor in AR.</div>
        )}
      </div>
    </div>
  );
}
