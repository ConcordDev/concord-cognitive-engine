'use client';

/**
 * IssLiveTracker — live ISS position over a world map, refreshed every
 * 5 seconds from the wheretheiss.at API (space.iss-track macro), with a
 * future ground-track polyline from space.iss-groundtrack. No API key.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Satellite, RefreshCw, AlertTriangle, Gauge, Sun, Moon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { MapView, type MapMarker } from '@/components/viz/MapView';
import { cn } from '@/lib/utils';

interface IssPosition {
  latitude: number;
  longitude: number;
  altitudeKm: number;
  velocityKmH: number;
  visibility: string;
  footprintKm: number;
  timestamp: number;
}

interface TrackPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
}

export function IssLiveTracker() {
  const [pos, setPos] = useState<IssPosition | null>(null);
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshPosition = useCallback(async () => {
    const r = await lensRun<IssPosition>('space', 'iss-track', {});
    if (r.data?.ok && r.data.result) {
      setPos(r.data.result);
      setError(null);
    } else {
      setError(r.data?.error || 'ISS position unavailable');
    }
    setLoading(false);
  }, []);

  const refreshTrack = useCallback(async () => {
    const r = await lensRun<{ points: TrackPoint[] }>('space', 'iss-groundtrack', {
      minutes: 90,
      stepSeconds: 240,
    });
    if (r.data?.ok && r.data.result?.points) setTrack(r.data.result.points);
  }, []);

  useEffect(() => {
    refreshPosition();
    refreshTrack();
    timerRef.current = setInterval(refreshPosition, 5000);
    const trackTimer = setInterval(refreshTrack, 120000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      clearInterval(trackTimer);
    };
  }, [refreshPosition, refreshTrack]);

  const markers: MapMarker[] = [];
  if (pos) {
    track.forEach((t, i) =>
      markers.push({ id: `t${i}`, lat: t.latitude, lon: t.longitude, tone: 'info', value: 0.15 }),
    );
    markers.push({
      id: 'iss',
      lat: pos.latitude,
      lon: pos.longitude,
      label: `ISS · ${pos.altitudeKm.toFixed(0)} km`,
      tone: 'warn',
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Satellite className="w-4 h-4 text-amber-400" /> ISS · Live Position
          {!loading && !error && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> live
            </span>
          )}
        </h3>
        <button
          onClick={refreshPosition}
          className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white"
          aria-label="Refresh ISS position"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 overflow-hidden bg-zinc-950">
        <MapView markers={markers} height={320} />
      </div>

      {pos && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'Latitude', value: `${pos.latitude.toFixed(2)}°` },
            { label: 'Longitude', value: `${pos.longitude.toFixed(2)}°` },
            { label: 'Altitude', value: `${pos.altitudeKm.toFixed(1)} km` },
            { label: 'Velocity', value: `${(pos.velocityKmH / 1000).toFixed(2)} km/s` },
          ].map((s) => (
            <div key={s.label} className="p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
              <p className="text-[11px] text-zinc-400">{s.label}</p>
              <p className="text-sm font-mono font-semibold text-white tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {pos && (
        <div className="flex items-center gap-4 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1.5">
            {pos.visibility === 'eclipsed' ? (
              <Moon className="w-3.5 h-3.5 text-indigo-400" />
            ) : (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            )}
            {pos.visibility}
          </span>
          <span className="flex items-center gap-1.5">
            <Gauge className="w-3.5 h-3.5" /> footprint {pos.footprintKm.toFixed(0)} km
          </span>
          <span className={cn('ml-auto', track.length > 0 ? 'text-cyan-400' : 'text-zinc-600')}>
            {track.length > 0 ? `${track.length}-point ground track` : 'computing track…'}
          </span>
        </div>
      )}
    </div>
  );
}
