'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Globe2, Loader2, ExternalLink, AlertTriangle, MapPin } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Event { id: string; title: string; description?: string; link: string; closed?: string; categories: { id: string; title: string }[]; geometry: { type: string; coordinates: [number, number] | number[][] }[]; }

const CATEGORIES = [
  { id: '', label: 'all' },
  { id: 'wildfires', label: 'wildfires' },
  { id: 'severeStorms', label: 'storms' },
  { id: 'volcanoes', label: 'volcanoes' },
];

export function EarthEventsLive() {
  const [category, setCategory] = useState<typeof CATEGORIES[number]['id']>('');

  const events = useQuery({
    queryKey: ['world-eonet', category],
    queryFn: async () => {
      const cat = category ? `&category=${category}` : '';
      const r = await fetch(`https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30${cat}`);
      if (!r.ok) throw new Error(`eonet ${r.status}`);
      const j = await r.json();
      return (j.events || []) as Event[];
    },
    staleTime: 10 * 60 * 1000,
  });

  const list = events.data || [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-emerald-400" /><h2 className="text-sm font-semibold text-white">Earth events — happening now</h2><span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">eonet.gsfc.nasa.gov</span></div>
        <div className="flex items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value as typeof CATEGORIES[number]['id'])} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">{CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
          {list.length > 0 && <SaveAsDtuButton compact apiSource="nasa-eonet-world" apiUrl={`https://eonet.gsfc.nasa.gov/api/v3/events?status=open${category ? `&category=${category}` : ''}`} title={`Earth events — ${category || 'all'} (${list.length} active)`} content={list.slice(0, 20).map((e, i) => `${i + 1}. ${e.title} · ${e.categories?.map((c) => c.title).join(', ')}\n   ${e.link}`).join('\n\n')} extraTags={['world', 'nasa', 'earth-events', category || 'all']} rawData={{ category, events: list }} />}
        </div>
      </header>
      {events.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">NASA EONET unreachable.</div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Active</div><div className="mt-0.5 font-mono text-lg text-amber-300">{list.length}</div></div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5"><div className="text-[10px] uppercase tracking-wider text-zinc-500">Categories</div><div className="mt-0.5 font-mono text-lg text-emerald-300">{new Set(list.flatMap((e) => e.categories?.map((c) => c.id) || [])).size}</div></div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((e) => {
          const lastGeom = e.geometry?.[e.geometry.length - 1];
          const coords = Array.isArray(lastGeom?.coordinates) && lastGeom.type === 'Point' ? (lastGeom.coordinates as [number, number]) : null;
          return (
            <a key={e.id} href={e.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 hover:border-emerald-500/40">
              <div className="flex items-center gap-2">
                <span className="rounded bg-amber-500/30 px-1 font-mono text-[9px] text-amber-200"><AlertTriangle className="inline h-2.5 w-2.5 mr-0.5" />ongoing</span>
                <p className="line-clamp-1 text-[12px] text-zinc-100">{e.title}</p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-500">
                {e.categories?.slice(0, 2).map((c) => <span key={c.id} className="rounded bg-emerald-500/20 px-1 font-mono text-[9px] text-emerald-200">{c.title}</span>)}
                {coords && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{coords[1]?.toFixed(2)}, {coords[0]?.toFixed(2)}</span>}
                <ExternalLink className="h-3 w-3 text-zinc-500" />
              </div>
            </a>
          );
        })}
      </div>
      {events.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling…</div>}
    </div>
  );
}
