'use client';

import { useQueries } from '@tanstack/react-query';
import { Mountain, Loader2, Sunrise, Sunset, Moon, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface AlmanacResponse {
  status: string;
  results: {
    sunrise: string;
    sunset: string;
    solar_noon: string;
    day_length: string;
    civil_twilight_begin: string;
    civil_twilight_end: string;
    nautical_twilight_begin?: string;
    nautical_twilight_end?: string;
  };
}

const CAMPS = [
  { id: 'everest', label: 'Everest Base Camp (NP)', lat: 28.0, lon: 86.85 },
  { id: 'denali', label: 'Denali Base Camp (US)', lat: 62.97, lon: -151.0 },
  { id: 'aconcagua', label: 'Aconcagua Plaza Mulas (AR)', lat: -32.65, lon: -70.0 },
  { id: 'kilimanjaro', label: 'Kilimanjaro Marangu Gate (TZ)', lat: -3.07, lon: 37.52 },
  { id: 'mcmurdo', label: 'McMurdo Station (AQ)', lat: -77.85, lon: 166.67 },
  { id: 'svalbard', label: 'Svalbard Longyearbyen (NO)', lat: 78.22, lon: 15.65 },
  { id: 'cape-horn', label: 'Cape Horn (CL)', lat: -55.98, lon: -67.27 },
  { id: 'eldorado', label: 'Mt. Elbrus North (RU)', lat: 43.35, lon: 42.45 },
];

export function BaseCampAlmanac() {
  const results = useQueries({
    queries: CAMPS.map((c) => ({
      queryKey: ['sunrise-sunset', c.id],
      queryFn: async () => {
        const r = await fetch(`https://api.sunrise-sunset.org/json?lat=${c.lat}&lng=${c.lon}&formatted=0`);
        if (!r.ok) throw new Error(`almanac ${r.status}`);
        return (await r.json()) as AlmanacResponse;
      },
      staleTime: 60 * 60 * 1000,
    })),
  });

  const camps = CAMPS.map((c, i) => ({ c, q: results[i] }));
  const loaded = camps.filter(({ q }) => q.data?.results);

  function fmt(iso?: string) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }); } catch { return '—'; }
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Mountain className="h-5 w-5 text-stone-400" />
          <h2 className="text-sm font-semibold text-white">Base camp almanac (today UTC)</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">sunrise-sunset.org · live</span>
        </div>
        {loaded.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="sunrise-sunset"
            apiUrl="https://api.sunrise-sunset.org/json"
            title={`Base camp almanac — ${loaded.length} sites (${new Date().toISOString().slice(0, 10)})`}
            content={loaded.map(({ c, q }) => {
              const r = q.data!.results;
              return `${c.label} (${c.lat}, ${c.lon}): sunrise ${fmt(r.sunrise)} UTC · sunset ${fmt(r.sunset)} UTC · day ${r.day_length}`;
            }).join('\n')}
            extraTags={['expedition-journal', 'almanac', 'sunrise-sunset']}
            rawData={{ camps: loaded.map(({ c, q }) => ({ ...c, almanac: q.data?.results })) }}
          />
        )}
      </header>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {camps.map(({ c, q }) => {
          const r = q.data?.results;
          return (
            <div key={c.id} className="rounded-lg border border-stone-500/20 bg-stone-500/5 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-stone-200">{c.label}</span>
                <span className="font-mono text-[10px] text-zinc-500">{c.lat.toFixed(1)}°, {c.lon.toFixed(1)}°</span>
              </div>
              {q.isPending && <div className="mt-2 flex items-center gap-1 text-[10px] text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" /> almanac…</div>}
              {q.isError && <div className="mt-2 text-[10px] text-rose-400">unreachable</div>}
              {r && (
                <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="flex items-center gap-1"><Sunrise className="h-3 w-3 text-amber-400" /><span className="font-mono text-zinc-100">{fmt(r.sunrise)}</span></div>
                  <div className="flex items-center gap-1"><Sunset className="h-3 w-3 text-orange-400" /><span className="font-mono text-zinc-100">{fmt(r.sunset)}</span></div>
                  <div className="flex items-center gap-1"><Moon className="h-3 w-3 text-cyan-400" /><span className="font-mono text-zinc-100">{r.day_length}</span></div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="flex items-center gap-1 text-[10px] text-zinc-500">
        <ExternalLink className="h-3 w-3" />
        UTC times from sunrise-sunset.org. Day length = sunrise→sunset duration.
      </p>
    </div>
  );
}
