'use client';

/**
 * NasaLivePanel — real NASA live data for the astronomy lens.
 *
 * Phase 4 of the 10-dimension UX completeness sprint. Proves the
 * REAL_FREE tier wire-up pattern end-to-end:
 *
 *   1. Free public API declared in server/lib/integration-registry.js
 *   2. Direct-fetch macros in server/domains/astronomy-live.js
 *   3. publicReadDomains entry so frontend can call them
 *   4. This component renders the data with proper attribution
 *
 * Three tabs: APOD (picture of the day), ISS (live position),
 * NEO (near-earth objects today, sorted by miss distance).
 */

import { useEffect, useState, useCallback } from 'react';
import { Loader2, Orbit as Telescope, Satellite, AlertTriangle, RefreshCw, ExternalLink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ApodPayload {
  date: string;
  title: string;
  explanation: string;
  mediaType: string;
  url: string;
  hdurl: string | null;
  copyright: string | null;
}

interface IssPayload {
  latitude: number;
  longitude: number;
  altitudeKm: number;
  velocityKmh: number;
  visibility: string;
  footprintKm: number;
}

interface NeoObject {
  id: string;
  name: string;
  date: string;
  diameterKmMin?: number;
  diameterKmMax?: number;
  hazardous: boolean;
  missDistanceKm: number | null;
  relativeVelocityKmh: number | null;
  jplUrl: string | null;
}

type Tab = 'apod' | 'iss' | 'neo';

async function runMacro<T>(name: string, input: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const r = await lensRun({ domain: 'astronomy', name, input });
    return r?.data as T;
  } catch {
    return null;
  }
}

export function NasaLivePanel({ className }: { className?: string }) {
  const [tab, setTab] = useState<Tab>('apod');
  const [apod, setApod] = useState<ApodPayload | null>(null);
  const [iss, setIss] = useState<IssPayload | null>(null);
  const [neo, setNeo] = useState<NeoObject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const fetchTab = useCallback(async (next: Tab) => {
    setLoading(true);
    setError(null);
    try {
      if (next === 'apod') {
        const r = await runMacro<{ ok: boolean; apod?: ApodPayload; reason?: string; fetchedAt?: number }>('live_apod');
        if (r?.ok && r.apod) {
          setApod(r.apod);
          setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
        } else setError(r?.reason || 'fetch_failed');
      } else if (next === 'iss') {
        const r = await runMacro<{ ok: boolean; iss?: IssPayload; reason?: string; fetchedAt?: number }>('live_iss');
        if (r?.ok && r.iss) {
          setIss(r.iss);
          setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
        } else setError(r?.reason || 'fetch_failed');
      } else if (next === 'neo') {
        const r = await runMacro<{ ok: boolean; objects?: NeoObject[]; reason?: string; fetchedAt?: number }>('live_neo');
        if (r?.ok) {
          setNeo(r.objects || []);
          setUpdatedAt(r.fetchedAt || Math.floor(Date.now() / 1000));
        } else setError(r?.reason || 'fetch_failed');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchTab(tab); }, [tab, fetchTab]);

  // ISS auto-refresh every 5s (it moves at 27,600 km/h).
  useEffect(() => {
    if (tab !== 'iss') return;
    const id = setInterval(() => { void fetchTab('iss'); }, 5000);
    return () => clearInterval(id);
  }, [tab, fetchTab]);

  return (
    <section className={cn('rounded-lg border border-zinc-800 bg-zinc-950/80 overflow-hidden', className)}>
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/80 bg-zinc-900/40">
        <Telescope className="w-4 h-4 text-sky-400" aria-hidden="true" />
        <h3 className="text-sm font-medium text-zinc-100 flex-1">NASA · Live</h3>
        <span className="text-[10px] text-emerald-400 font-mono">REAL data</span>
        <button
          type="button"
          onClick={() => void fetchTab(tab)}
          className="p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
          aria-label="Refresh"
          disabled={loading}
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <nav className="flex border-b border-zinc-800/80 text-xs" role="tablist">
        {(['apod', 'iss', 'neo'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-2 font-medium transition-colors',
              tab === t
                ? 'text-sky-300 border-b-2 border-sky-400'
                : 'text-zinc-400 hover:text-zinc-200 border-b-2 border-transparent',
            )}
          >
            {t === 'apod' && 'Picture of the Day'}
            {t === 'iss' && 'ISS Live'}
            {t === 'neo' && 'Near-Earth Objects'}
          </button>
        ))}
      </nav>

      <div className="p-3 min-h-[200px]">
        {loading && !updatedAt && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-zinc-400" aria-hidden="true" />
          </div>
        )}
        {error && (
          <div className="text-xs text-rose-300/80 py-4">
            <AlertTriangle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />
            NASA unreachable ({error}) — retry with the refresh button.
          </div>
        )}

        {tab === 'apod' && apod && !error && (
          <article className="space-y-2">
            <header className="flex items-baseline gap-2 flex-wrap">
              <h4 className="text-sm font-semibold text-zinc-100">{apod.title}</h4>
              <span className="text-[10px] text-zinc-400 font-mono">{apod.date}</span>
              {apod.copyright && <span className="text-[10px] text-zinc-400 italic ml-auto">© {apod.copyright.trim()}</span>}
            </header>
            {apod.mediaType === 'image' && apod.url && (
              <a href={apod.hdurl || apod.url} target="_blank" rel="noopener noreferrer" className="block rounded overflow-hidden border border-zinc-800 group">
                {/* eslint-disable-next-line @next/next/no-img-element -- NASA APOD serves arbitrary external image hosts; next/image domain allowlist is impractical here */}
                <img src={apod.url} alt={apod.title} className="w-full h-auto block" loading="lazy" />
              </a>
            )}
            {apod.mediaType === 'video' && (
              <div className="rounded overflow-hidden border border-zinc-800 aspect-video">
                <iframe src={apod.url} title={apod.title} className="w-full h-full" allow="encrypted-media" allowFullScreen />
              </div>
            )}
            <p className="text-xs text-zinc-300 leading-relaxed">{apod.explanation}</p>
            <footer className="text-[10px] text-zinc-400 pt-2">
              Source: NASA Astronomy Picture of the Day · {updatedAt ? new Date(updatedAt * 1000).toLocaleTimeString() : ''}
            </footer>
          </article>
        )}

        {tab === 'iss' && iss && !error && (
          <article className="space-y-3">
            <header className="flex items-center gap-2">
              <Satellite className="w-4 h-4 text-amber-300" aria-hidden="true" />
              <h4 className="text-sm font-semibold text-zinc-100">International Space Station</h4>
              <span className="ml-auto text-[10px] text-emerald-400 font-mono animate-pulse">live · 5s</span>
            </header>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <dt className="text-zinc-400">Latitude</dt>
                <dd className="text-zinc-100 font-mono">{iss.latitude.toFixed(4)}°</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Longitude</dt>
                <dd className="text-zinc-100 font-mono">{iss.longitude.toFixed(4)}°</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Altitude</dt>
                <dd className="text-zinc-100 font-mono">{iss.altitudeKm.toFixed(1)} km</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Velocity</dt>
                <dd className="text-zinc-100 font-mono">{Math.round(iss.velocityKmh).toLocaleString()} km/h</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Visibility</dt>
                <dd className="text-zinc-100">{iss.visibility}</dd>
              </div>
              <div>
                <dt className="text-zinc-400">Footprint</dt>
                <dd className="text-zinc-100 font-mono">{Math.round(iss.footprintKm)} km</dd>
              </div>
            </dl>
            <footer className="text-[10px] text-zinc-400 pt-1">Source: wheretheiss.at · auto-refresh 5s</footer>
          </article>
        )}

        {tab === 'neo' && neo.length > 0 && !error && (
          <article className="space-y-2">
            <header className="flex items-baseline gap-2">
              <h4 className="text-sm font-semibold text-zinc-100">Today’s near-Earth objects</h4>
              <span className="text-[10px] text-zinc-400 font-mono ml-auto">closest first · {neo.length} shown</span>
            </header>
            <ul className="divide-y divide-zinc-800/60 text-xs">
              {neo.map((o) => (
                <li key={o.id} className="py-2 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn('font-medium', o.hazardous ? 'text-amber-300' : 'text-zinc-200')}>{o.name}</span>
                      {o.hazardous && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-500/30">
                          potentially hazardous
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-400 font-mono mt-0.5">
                      {o.diameterKmMin && o.diameterKmMax
                        ? `${o.diameterKmMin.toFixed(2)}–${o.diameterKmMax.toFixed(2)} km diameter`
                        : '— km'}
                      {o.relativeVelocityKmh && ` · ${Math.round(o.relativeVelocityKmh).toLocaleString()} km/h`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-zinc-400">miss distance</div>
                    <div className="text-xs font-mono text-zinc-200">
                      {o.missDistanceKm ? `${Math.round(o.missDistanceKm).toLocaleString()} km` : '—'}
                    </div>
                  </div>
                  {o.jplUrl && (
                    <a href={o.jplUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-sky-400 shrink-0" aria-label="JPL orbit details">
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <footer className="text-[10px] text-zinc-400 pt-1">Source: NASA NeoWs</footer>
          </article>
        )}
      </div>
    </section>
  );
}

export default NasaLivePanel;
