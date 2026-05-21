'use client';

/**
 * MultiModalDirections — turn-by-turn directions with a walk/bike/drive
 * mode toggle. Calls the `directions-multimodal` atlas macro (real OSRM
 * routing across driving/walking/cycling profiles) and renders the
 * GeoJSON route + maneuver step list.
 *
 * Backend: atlas.directions-multimodal — real OSRM, no key.
 */

import { useState } from 'react';
import {
  Car, PersonStanding, Bike, Loader2, Navigation, ChevronRight, MapPin,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

type Mode = 'driving' | 'walking' | 'cycling';

interface Step {
  instruction: string;
  type: string;
  modifier: string | null;
  roadName: string;
  distanceMeters: number;
  durationSeconds: number;
}

interface MultiModalResult {
  mode: Mode;
  distanceKm: number;
  distanceMiles: number;
  durationText: string;
  steps: Step[];
  stepCount: number;
  source: string;
}

const MODES: Array<{ id: Mode; label: string; icon: typeof Car }> = [
  { id: 'driving', label: 'Drive', icon: Car },
  { id: 'walking', label: 'Walk', icon: PersonStanding },
  { id: 'cycling', label: 'Bike', icon: Bike },
];

function fmtMeters(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

export function MultiModalDirections() {
  const [startLat, setStartLat] = useState('');
  const [startLng, setStartLng] = useState('');
  const [endLat, setEndLat] = useState('');
  const [endLng, setEndLng] = useState('');
  const [mode, setMode] = useState<Mode>('driving');
  const [result, setResult] = useState<MultiModalResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    [startLat, startLng, endLat, endLng].every((v) => v.trim() !== '' && Number.isFinite(Number(v)));

  async function compute() {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const r = await lensRun<MultiModalResult>('atlas', 'directions-multimodal', {
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
        setError(r.data?.error || 'Routing failed.');
      }
    } catch {
      setResult(null);
      setError('Routing service unreachable.');
    }
    setLoading(false);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-2">
          <Navigation className="h-4 w-4 text-sky-400" />
          <span className="text-sm font-semibold text-white">Multi-modal directions</span>
        </div>

        <div className="mt-3 flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11px] transition ${active ? 'bg-sky-500/20 text-sky-200' : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'}`}
              >
                <Icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <input
            type="number" step="any" placeholder="Start lat" value={startLat}
            onChange={(e) => setStartLat(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-sky-500/40 focus:outline-none"
          />
          <input
            type="number" step="any" placeholder="Start lng" value={startLng}
            onChange={(e) => setStartLng(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-sky-500/40 focus:outline-none"
          />
          <input
            type="number" step="any" placeholder="Dest lat" value={endLat}
            onChange={(e) => setEndLat(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-sky-500/40 focus:outline-none"
          />
          <input
            type="number" step="any" placeholder="Dest lng" value={endLng}
            onChange={(e) => setEndLng(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:border-sky-500/40 focus:outline-none"
          />
        </div>

        <button
          type="button"
          onClick={compute}
          disabled={loading || !ready}
          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-sky-500 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
          Get directions
        </button>
      </div>

      <div className="p-3">
        {error && (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</div>
        )}
        {!result && !error && !loading && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">
            No data yet. Enter start and destination coordinates, pick a mode, then tap "Get directions".
          </div>
        )}
        {result && (
          <div className="space-y-3">
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-2xl text-sky-200">{result.durationText}</span>
                <span className="font-mono text-sm text-zinc-400">{result.distanceKm} km · {result.distanceMiles} mi</span>
              </div>
              <div className="mt-1 text-[10px] text-zinc-500">via {result.mode} · {result.stepCount} step{result.stepCount === 1 ? '' : 's'}</div>
            </div>
            {result.steps.length > 0 && (
              <ol className="space-y-1">
                {result.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 rounded border border-zinc-800 bg-zinc-900/40 px-2.5 py-1.5">
                    <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400" />
                    <div className="flex-1 text-[11px]">
                      <div className="capitalize text-zinc-100">{step.instruction || step.type}</div>
                      <div className="text-[10px] text-zinc-500">
                        {step.roadName && <span>{step.roadName} · </span>}
                        {fmtMeters(step.distanceMeters)}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {result.steps.length === 0 && (
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                <MapPin className="h-3.5 w-3.5" /> Route resolved but the provider returned no maneuver steps.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
