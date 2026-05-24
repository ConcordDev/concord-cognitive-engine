'use client';

/**
 * VisiblePassPredictor — Heavens-Above-style visible-pass predictions
 * for the user's location. Reads geolocation from the browser, then
 * calls space.iss-passes (real wheretheiss.at ground-track geometry).
 */

import { useState, useCallback } from 'react';
import { Eye, MapPin, AlertTriangle, Loader2, ArrowUpRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Pass {
  startUtc: string;
  endUtc: string;
  peakUtc: string;
  durationSeconds: number;
  peakElevationDeg: number;
  quality: 'excellent' | 'good' | 'low';
}

interface PassResult {
  observer: { latitude: number; longitude: number };
  minElevationDeg: number;
  passes: Pass[];
  count: number;
  windowMinutes: number;
}

const QUALITY_TONE: Record<string, string> = {
  excellent: 'text-emerald-400 bg-emerald-500/10',
  good: 'text-cyan-400 bg-cyan-500/10',
  low: 'text-zinc-400 bg-zinc-500/10',
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function VisiblePassPredictor() {
  const [result, setResult] = useState<PassResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);

  const runPrediction = useCallback(async (lat: number, lon: number) => {
    setLoading(true);
    setError(null);
    const r = await lensRun<PassResult>('space', 'iss-passes', {
      latitude: lat,
      longitude: lon,
      minElevationDeg: 10,
    });
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setError(r.data?.error || 'Pass prediction failed');
    setLoading(false);
  }, []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not available in this browser');
      return;
    }
    setLoading(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const c = { lat: p.coords.latitude, lon: p.coords.longitude };
        setCoords(c);
        runPrediction(c.lat, c.lon);
      },
      (e) => {
        setError(`Location denied: ${e.message}`);
        setLoading(false);
      },
      { timeout: 10000 },
    );
  }, [runPrediction]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Eye className="w-4 h-4 text-cyan-400" /> Visible ISS Passes
        </h3>
        <button
          onClick={locate}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded-lg"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MapPin className="w-3.5 h-3.5" />}
          Use my location
        </button>
      </div>

      {coords && (
        <p className="text-[11px] text-zinc-400">
          Observer · {coords.lat.toFixed(3)}°, {coords.lon.toFixed(3)}° — next{' '}
          {result?.windowMinutes ?? 95} minutes
        </p>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {!coords && !error && (
        <p className="text-xs text-zinc-400 border border-dashed border-zinc-800 rounded-lg p-4 text-center">
          Share your location to compute when the ISS rises above your horizon.
        </p>
      )}

      {result && result.count === 0 && (
        <p className="text-xs text-zinc-400 border border-dashed border-zinc-800 rounded-lg p-4 text-center">
          No ISS passes above {result.minElevationDeg}° in the next {result.windowMinutes} minutes.
        </p>
      )}

      {result && result.count > 0 && (
        <ul className="space-y-2">
          {result.passes.map((p, i) => (
            <li
              key={i}
              className="flex items-center gap-3 p-3 bg-zinc-900 rounded-lg border border-zinc-800"
            >
              <div className="text-center shrink-0">
                <p className="text-sm font-mono font-bold text-white tabular-nums">
                  {fmtTime(p.startUtc)}
                </p>
                <p className="text-[10px] text-zinc-400">start</p>
              </div>
              <ArrowUpRight className="w-4 h-4 text-zinc-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-zinc-300">
                  Peak {fmtTime(p.peakUtc)} · {Math.round(p.durationSeconds / 60)} min visible
                </p>
                <p className="text-[11px] text-zinc-400">
                  Max elevation {p.peakElevationDeg}° above horizon
                </p>
              </div>
              <span
                className={cn(
                  'text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0',
                  QUALITY_TONE[p.quality],
                )}
              >
                {p.quality}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
