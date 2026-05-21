'use client';

/**
 * LiveTrafficPanel — traffic-adjusted ETA for a route. Calls the
 * `live-traffic-eta` atlas macro, which routes via OSRM (free-flow) and
 * overlays a time-of-day congestion model to surface a realistic ETA.
 *
 * Backend: atlas.live-traffic-eta — OSRM + demand model, no key.
 */

import { useState } from 'react';
import { Loader2, Gauge, Clock, TrafficCone } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type Mode = 'driving' | 'walking' | 'cycling';

interface TrafficLeg {
  index: number;
  distanceKm: number;
  freeFlowText: string;
  trafficText: string;
}

interface TrafficResult {
  mode: Mode;
  distanceKm: number;
  freeFlowText: string;
  trafficText: string;
  delayText: string;
  congestionLevel: string;
  congestionFactor: number;
  localHour: number;
  etaIso: string;
  legs: TrafficLeg[];
  source: string;
}

const LEVEL_COLOR: Record<string, string> = {
  'free-flow': 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  none: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  light: 'text-lime-300 border-lime-500/30 bg-lime-500/10',
  moderate: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  heavy: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
};

export function LiveTrafficPanel() {
  const [startLat, setStartLat] = useState('');
  const [startLng, setStartLng] = useState('');
  const [endLat, setEndLat] = useState('');
  const [endLng, setEndLng] = useState('');
  const [mode, setMode] = useState<Mode>('driving');
  const [result, setResult] = useState<TrafficResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    [startLat, startLng, endLat, endLng].every((v) => v.trim() !== '' && Number.isFinite(Number(v)));

  async function compute() {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<TrafficResult>('atlas', 'live-traffic-eta', {
        mode,
        waypoints: [
          { lat: Number(startLat), lng: Number(startLng) },
          { lat: Number(endLat), lng: Number(endLng) },
        ],
      });
      if (r.data?.ok && r.data.result) {
        setResult(r.data.result);
      } else {
        setResult(null);
        setError(r.data?.error || 'Traffic ETA failed.');
      }
    } catch {
      setResult(null);
      setError('Traffic service unreachable.');
    }
    setLoading(false);
  }

  const eta = result?.etaIso
    ? new Date(result.etaIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;
  const levelClass = result ? LEVEL_COLOR[result.congestionLevel] || LEVEL_COLOR.moderate : '';

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-2">
          <TrafficCone className="h-4 w-4 text-amber-400" />
          <span className="text-sm font-semibold text-white">Live traffic &amp; ETA</span>
        </div>

        <div className="mt-3 flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
          {(['driving', 'walking', 'cycling'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded px-2 py-1.5 text-[11px] capitalize transition ${mode === m ? 'bg-amber-500/20 text-amber-200' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <input type="number" step="any" placeholder="Start lat" value={startLat} onChange={(e) => setStartLat(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none" />
          <input type="number" step="any" placeholder="Start lng" value={startLng} onChange={(e) => setStartLng(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none" />
          <input type="number" step="any" placeholder="Dest lat" value={endLat} onChange={(e) => setEndLat(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none" />
          <input type="number" step="any" placeholder="Dest lng" value={endLng} onChange={(e) => setEndLng(e.target.value)} className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-amber-500/40 focus:outline-none" />
        </div>

        <button
          type="button"
          onClick={compute}
          disabled={loading || !ready}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-400 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />}
          Check traffic
        </button>
      </div>

      <div className="p-3">
        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>
        )}
        {!result && !error && !loading && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">
            No data yet. Enter route coordinates to see a traffic-adjusted ETA.
          </div>
        )}
        {result && (
          <div className="space-y-3">
            <div className={`rounded-lg border p-3 ${levelClass}`}>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-2xl">{result.trafficText}</span>
                {eta && (
                  <span className="flex items-center gap-1 font-mono text-sm">
                    <Clock className="h-3.5 w-3.5" /> arrive {eta}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[10px] capitalize opacity-80">
                {result.congestionLevel} traffic · ×{result.congestionFactor} · free-flow {result.freeFlowText}
                {result.delayText !== '0m' && <span> · +{result.delayText} delay</span>}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-center">
                <p className="font-mono text-sm text-white">{result.distanceKm} km</p>
                <p className="text-[10px] text-zinc-500">Distance</p>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-center">
                <p className="font-mono text-sm text-white">{result.localHour}h</p>
                <p className="text-[10px] text-zinc-500">Local hour</p>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-center">
                <p className="font-mono text-sm text-white">{result.legs.length}</p>
                <p className="text-[10px] text-zinc-500">Legs</p>
              </div>
            </div>
            {result.legs.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Per-leg congestion</div>
                {result.legs.map((leg) => (
                  <div key={leg.index} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5 text-[11px]">
                    <span className="text-zinc-300">Leg {leg.index + 1} · {leg.distanceKm} km</span>
                    <span className="font-mono text-zinc-400">{leg.freeFlowText} → <span className="text-amber-300">{leg.trafficText}</span></span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-zinc-600">Source: {result.source}</p>
          </div>
        )}
      </div>
    </div>
  );
}
