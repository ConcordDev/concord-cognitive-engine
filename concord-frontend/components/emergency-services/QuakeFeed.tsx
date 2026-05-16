'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, Loader2, ExternalLink, MapPin, Activity } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Quake {
  id: string;
  properties: {
    mag: number;
    place: string;
    time: number;
    url: string;
    tsunami: number;
    alert?: string;
    felt?: number;
    type?: string;
    title?: string;
  };
  geometry: { coordinates: [number, number, number] };
}

const FEEDS = [
  { id: 'significant_week', label: 'Significant (week)' },
  { id: 'all_day', label: 'All (day)' },
  { id: '4.5_week', label: 'M4.5+ (week)' },
  { id: '2.5_day', label: 'M2.5+ (day)' },
] as const;

export function QuakeFeed() {
  const [feed, setFeed] = useState<typeof FEEDS[number]['id']>('significant_week');

  const quakes = useQuery({
    queryKey: ['usgs-quakes', feed],
    queryFn: async () => {
      const r = await fetch(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`);
      if (!r.ok) throw new Error(`usgs ${r.status}`);
      const j = await r.json();
      return ((j.features || []) as Quake[]).slice(0, 30);
    },
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });

  const list = quakes.data || [];
  const tsunamis = list.filter((q) => q.properties.tsunami === 1).length;
  const m5plus = list.filter((q) => q.properties.mag >= 5).length;
  const maxMag = list.length > 0 ? Math.max(...list.map((q) => q.properties.mag)) : 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <AlertOctagon className="h-5 w-5 text-rose-400" />
          <h2 className="text-sm font-semibold text-white">Live seismic feed</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">earthquake.usgs.gov · live</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={feed} onChange={(e) => setFeed(e.target.value as typeof FEEDS[number]['id'])} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
            {FEEDS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          {list.length > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="usgs-earthquakes"
              apiUrl={`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`}
              title={`USGS quakes — ${feed} (${list.length})`}
              content={list.slice(0, 20).map((q, i) => `${i + 1}. M${q.properties.mag.toFixed(1)} · ${q.properties.place}\n   ${new Date(q.properties.time).toISOString()} · depth ${q.geometry.coordinates[2]?.toFixed(1)}km${q.properties.tsunami ? ' · TSUNAMI' : ''}\n   ${q.properties.url}`).join('\n\n')}
              extraTags={['emergency-services', 'usgs', 'earthquake', feed]}
              rawData={{ feed, quakes: list }}
            />
          )}
        </div>
      </header>
      {quakes.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">USGS unreachable.</div>}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Events</div>
          <div className="mt-0.5 font-mono text-lg text-rose-300">{list.length}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Max mag</div>
          <div className="mt-0.5 font-mono text-lg text-rose-300">{maxMag > 0 ? `M${maxMag.toFixed(1)}` : '—'}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">M5+</div>
          <div className="mt-0.5 font-mono text-lg text-amber-300">{m5plus}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Tsunamis</div>
          <div className="mt-0.5 font-mono text-lg text-cyan-300">{tsunamis}</div>
        </div>
      </div>
      <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
        {list.map((q) => {
          const mag = q.properties.mag;
          const color = mag >= 6 ? 'border-rose-500/40 bg-rose-500/10' : mag >= 4.5 ? 'border-orange-500/30 bg-orange-500/5' : 'border-amber-500/20 bg-amber-500/5';
          return (
            <a key={q.id} href={q.properties.url} target="_blank" rel="noopener noreferrer" className={`block rounded-lg border ${color} p-2.5 hover:border-rose-400/60`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-rose-200">M{mag.toFixed(1)}</span>
                    <span className="line-clamp-1 text-[12px] text-zinc-100">{q.properties.place}</span>
                    {q.properties.tsunami === 1 && <span className="rounded bg-cyan-500/30 px-1 font-mono text-[9px] text-cyan-200">TSUNAMI</span>}
                    {q.properties.alert && <span className={`rounded px-1 font-mono text-[9px] uppercase ${q.properties.alert === 'red' ? 'bg-rose-500/30 text-rose-200' : q.properties.alert === 'orange' ? 'bg-orange-500/30 text-orange-200' : 'bg-yellow-500/30 text-yellow-200'}`}>{q.properties.alert}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-500">
                    <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{q.geometry.coordinates[1]?.toFixed(2)}, {q.geometry.coordinates[0]?.toFixed(2)}</span>
                    <span className="flex items-center gap-0.5"><Activity className="h-3 w-3" />depth {q.geometry.coordinates[2]?.toFixed(1)}km</span>
                    {q.properties.felt && <span>felt by {q.properties.felt}</span>}
                    <span>{new Date(q.properties.time).toLocaleString()}</span>
                  </div>
                </div>
                <ExternalLink className="h-3 w-3 shrink-0 text-zinc-500" />
              </div>
            </a>
          );
        })}
        {list.length === 0 && !quakes.isPending && !quakes.isError && (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-500">No events in this feed.</div>
        )}
      </div>
      {quakes.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Pulling USGS…</div>}
    </div>
  );
}
