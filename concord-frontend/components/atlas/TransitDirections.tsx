'use client';

/**
 * TransitDirections — public-transport directions. Calls the
 * `transit-directions` atlas macro, which discovers OSM transit stops
 * near the origin/destination and builds walk + ride + walk legs.
 *
 * Backend: atlas.transit-directions — Overpass OSM transit stops, no key.
 */

import { useState } from 'react';
import { Loader2, TrainFront, PersonStanding, Bus, MapPin } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface TransitLeg {
  type: 'walk' | 'transit';
  mode?: string;
  from: string;
  to: string;
  distanceKm: number;
  durationText: string;
}

interface TransitStop {
  name: string;
  lat: number;
  lng: number;
  kind: string;
  walkKm: number;
}

interface TransitResult {
  feasible: boolean;
  reason?: string;
  legs?: TransitLeg[];
  totalDurationText?: string;
  boardStop?: TransitStop;
  alightStop?: TransitStop;
  originStops?: TransitStop[];
  destStops?: TransitStop[];
  source: string;
}

function legIcon(leg: TransitLeg) {
  if (leg.type === 'walk') return PersonStanding;
  if (leg.mode === 'rail' || leg.mode === 'tram') return TrainFront;
  return Bus;
}

export function TransitDirections() {
  const [startLat, setStartLat] = useState('');
  const [startLng, setStartLng] = useState('');
  const [endLat, setEndLat] = useState('');
  const [endLng, setEndLng] = useState('');
  const [result, setResult] = useState<TransitResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    [startLat, startLng, endLat, endLng].every((v) => v.trim() !== '' && Number.isFinite(Number(v)));

  async function compute() {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<TransitResult>('atlas', 'transit-directions', {
        start: { lat: Number(startLat), lng: Number(startLng) },
        end: { lat: Number(endLat), lng: Number(endLng) },
      });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result);
      } else {
        setResult(null);
        setError(r.data?.error || 'Transit lookup failed.');
      }
    } catch {
      setResult(null);
      setError('Transit service unreachable.');
    }
    setLoading(false);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-2">
          <TrainFront className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-semibold text-white">Transit directions</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <input type="number" step="any" placeholder="From lat" value={startLat} onChange={(e) => setStartLat(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-400 focus:border-emerald-500/40 focus:outline-none" />
          <input type="number" step="any" placeholder="From lng" value={startLng} onChange={(e) => setStartLng(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-400 focus:border-emerald-500/40 focus:outline-none" />
          <input type="number" step="any" placeholder="To lat" value={endLat} onChange={(e) => setEndLat(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-400 focus:border-emerald-500/40 focus:outline-none" />
          <input type="number" step="any" placeholder="To lng" value={endLng} onChange={(e) => setEndLng(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-400 focus:border-emerald-500/40 focus:outline-none" />
        </div>
        <button
          type="button"
          onClick={compute}
          disabled={loading || !ready}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TrainFront className="h-3.5 w-3.5" />}
          Plan transit route
        </button>
      </div>

      <div className="p-3">
        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>
        )}
        {!result && !error && !loading && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">
            No data yet. Enter origin and destination coordinates to find transit stops and routes.
          </div>
        )}
        {result && !result.feasible && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {result.reason || 'No transit route found.'}
          </div>
        )}
        {result && result.feasible && result.legs && (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <span className="font-mono text-2xl text-emerald-200">{result.totalDurationText}</span>
              <div className="mt-1 text-[10px] text-zinc-400">
                {result.legs.length} legs · board at {result.boardStop?.name} · alight at {result.alightStop?.name}
              </div>
            </div>
            <div className="space-y-1">
              {result.legs.map((leg, i) => {
                const Icon = legIcon(leg);
                return (
                  <div key={i} className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
                    <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${leg.type === 'transit' ? 'text-emerald-400' : 'text-zinc-400'}`} />
                    <div className="flex-1 text-[11px]">
                      <div className="text-zinc-100">
                        {leg.from} → {leg.to}
                        {leg.mode && <span className="ml-1 rounded bg-emerald-500/15 px-1 text-[9px] uppercase text-emerald-300">{leg.mode}</span>}
                      </div>
                      <div className="text-[10px] text-zinc-400">{leg.distanceKm} km · {leg.durationText}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {result.originStops && result.originStops.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-400">Nearby stops at origin</div>
                {result.originStops.map((s, i) => (
                  <div key={i} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1 text-[10px]">
                    <span className="flex items-center gap-1 text-zinc-300"><MapPin className="h-3 w-3" />{s.name}</span>
                    <span className="font-mono text-zinc-400">{s.kind} · {s.walkKm} km</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-zinc-400">Source: {result.source}</p>
          </div>
        )}
      </div>
    </div>
  );
}
