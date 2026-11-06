'use client';

import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Mountain, Loader2, Sunrise, Sunset, Moon, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';
import { publicLookup, lookupMeta } from '@/lib/public-lookup';

interface AlmanacResponse {
  status: string;
  results: {
    sunrise: string;
    sunset: string;
    solar_noon: string;
    day_length: string;
    civil_twilight_begin: string;
    civil_twilight_end: string;
    sun_status?: string;
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

/**
 * F7 — the polar rows. For a camp in polar day or polar night the upstream
 * returns its sentinel (sunrise and sunset the same 00:00 instant), which the
 * row used to render as real times: 00:00 / 00:00 / 0 — a displayed 0 that
 * matches NEITHER polar state. A polar row renders dashes for the times and
 * the status word instead: the upstream's own sun_status when it carries one,
 * never guessed from the day-length figure.
 */
export function polarStatus(r: { sunrise?: string; sunset?: string; sun_status?: string }): string | null {
  if (!r.sunrise || !r.sunset || r.sunrise !== r.sunset) return null;
  try {
    const t = new Date(r.sunrise).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
    if (t !== '00:00') return null;
  } catch { return null; }
  if (r.sun_status === 'midnight_sun') return 'Midnight sun';
  if (r.sun_status === 'polar_night') return 'Polar night';
  return 'Polar — no sunrise or sunset today';
}

export function BaseCampAlmanac() {
  const [savedDtuId, setSavedDtuId] = useState<string | null>(null);
  const results = useQueries({
    queries: CAMPS.map((c) => ({
      queryKey: ['sunrise-sunset', c.id],
      queryFn: async () => publicLookup<AlmanacResponse>('sunrise-sunset', { lat: c.lat, lng: c.lon }),
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
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">sunrise-sunset.org · via Concord server</span>
        </div>
        {loaded.length > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="sunrise-sunset"
            apiUrl="https://sunrise-sunset.org/"
            title={`Base camp almanac — ${loaded.length} sites (${new Date().toISOString().slice(0, 10)})`}
            content={loaded.map(({ c, q }) => {
              const r = q.data!.results;
              const polar = polarStatus(r);
              return polar
                ? `${c.label} (${c.lat}, ${c.lon}): ${polar} — no sunrise or sunset today`
                : `${c.label} (${c.lat}, ${c.lon}): sunrise ${fmt(r.sunrise)} UTC · sunset ${fmt(r.sunset)} UTC · day ${r.day_length}`;
            }).join('\n')}
            extraTags={['expedition-journal', 'almanac']}
            rawData={{ camps: loaded.map(({ c, q }) => ({ ...c, almanac: q.data?.results })) }}
            onSaved={setSavedDtuId}
          />
        )}
      </header>
      {savedDtuId && <p className="text-[11px] text-emerald-300">Saved as DTU {savedDtuId} — find it in your DTUs.</p>}
      {camps.some(({ q }) => lookupMeta(q.data)?.stale) && <div className="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">Showing cached sunrise/sunset times for one or more camps — live source unavailable.</div>}
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {camps.map(({ c, q }) => {
          const r = q.data?.results;
          return (
            <div key={c.id} className="rounded-lg border border-stone-500/20 bg-stone-500/5 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-stone-200">{c.label}</span>
                <span className="font-mono text-[10px] text-zinc-400">{c.lat.toFixed(1)}°, {c.lon.toFixed(1)}°</span>
              </div>
              {q.isPending && <div className="mt-2 flex items-center gap-1 text-[10px] text-zinc-400"><Loader2 className="h-3 w-3 animate-spin" /> almanac…</div>}
              {q.isError && <div className="mt-2 text-[10px] text-rose-400">unavailable</div>}
              {r && (polarStatus(r) ? (
                <div className="mt-2 flex items-center gap-1 text-[11px]">
                  <Moon className="h-3 w-3 text-cyan-400" />
                  <span className="font-mono text-zinc-100">{polarStatus(r)}</span>
                  <span className="text-zinc-500">· sunrise — · sunset —</span>
                </div>
              ) : (
                <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="flex items-center gap-1"><Sunrise className="h-3 w-3 text-amber-400" /><span className="font-mono text-zinc-100">{fmt(r.sunrise)}</span></div>
                  <div className="flex items-center gap-1"><Sunset className="h-3 w-3 text-orange-400" /><span className="font-mono text-zinc-100">{fmt(r.sunset)}</span></div>
                  <div className="flex items-center gap-1"><Moon className="h-3 w-3 text-cyan-400" /><span className="font-mono text-zinc-100">{r.day_length}</span></div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <p className="flex items-center gap-1 text-[10px] text-zinc-400">
        <ExternalLink className="h-3 w-3" />
        UTC times from sunrise-sunset.org. Day length = sunrise→sunset duration.
      </p>
    </div>
  );
}
