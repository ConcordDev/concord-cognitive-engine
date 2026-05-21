'use client';

/**
 * StravaGpsPanel — GPS activity recording + GPX import, and a map-based
 * personal heatmap. Live recording uses the browser Geolocation API to
 * sample real position fixes; GPX import parses a real uploaded file.
 * Hydrates the heatmap from fitness.activity-heatmap.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, MapPin, Square, Upload, Flame, Route, Activity, Ruler, Clock,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { MapView, type MapMarker } from '@/components/viz/MapView';

interface TrackPoint { lat: number; lon: number; ele?: number; t: number }
interface HeatCell { lat: number; lon: number; count: number; intensity: number }

const TYPES = ['run', 'ride', 'walk', 'hike', 'swim', 'row'];

function durLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, '0')}`;
}

export function StravaGpsPanel() {
  const [type, setType] = useState('run');
  const [recording, setRecording] = useState(false);
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cells, setCells] = useState<HeatCell[]>([]);
  const [tracks, setTracks] = useState(0);
  const [loadingHeat, setLoadingHeat] = useState(true);

  const watchRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshHeatmap = useCallback(async () => {
    setLoadingHeat(true);
    const r = await lensRun('fitness', 'activity-heatmap', {});
    if (r.data?.ok) {
      setCells(r.data.result?.cells || []);
      setTracks(r.data.result?.tracks || 0);
    }
    setLoadingHeat(false);
  }, []);

  useEffect(() => { void refreshHeatmap(); }, [refreshHeatmap]);

  useEffect(() => () => {
    if (watchRef.current != null && typeof navigator !== 'undefined') {
      navigator.geolocation?.clearWatch(watchRef.current);
    }
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const startRecording = () => {
    setError(null);
    setNotice(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation is not available in this browser.');
      return;
    }
    setPoints([]);
    setElapsed(0);
    startRef.current = Date.now();
    setRecording(true);
    timerRef.current = setInterval(() => {
      setElapsed(Math.round((Date.now() - startRef.current) / 1000));
    }, 1000);
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPoints((prev) => [...prev, {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          ele: typeof pos.coords.altitude === 'number' ? pos.coords.altitude : undefined,
          t: pos.timestamp,
        }]);
      },
      (err) => setError(`GPS error: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  };

  const stopRecording = async () => {
    if (watchRef.current != null) {
      navigator.geolocation?.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
    if (points.length < 2) {
      setError('Not enough GPS fixes captured to save (need at least 2).');
      return;
    }
    setBusy(true);
    const r = await lensRun('fitness', 'gps-record', {
      type,
      points: points.map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele, t: p.t })),
      durationSec: elapsed,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not save recording'); return; }
    setNotice(`Saved ${r.data?.result?.summary?.distanceKm ?? 0} km GPS activity.`);
    setPoints([]);
    setElapsed(0);
    await refreshHeatmap();
  };

  const importGpx = async (file: File) => {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const gpx = await file.text();
      const r = await lensRun('fitness', 'gps-record', { type, gpx });
      if (r.data?.ok === false) { setError(r.data?.error || 'GPX import failed'); return; }
      setNotice(`Imported ${r.data?.result?.summary?.distanceKm ?? 0} km from ${file.name}.`);
      await refreshHeatmap();
    } catch {
      setError('Could not read the GPX file.');
    } finally {
      setBusy(false);
    }
  };

  const liveDistanceKm = (() => {
    let m = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const R = 6371000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
      const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
      m += 2 * R * Math.asin(Math.sqrt(h));
    }
    return Math.round((m / 1000) * 100) / 100;
  })();

  const markers: MapMarker[] = cells.map((c, i) => ({
    id: `cell-${i}`,
    lat: c.lat,
    lon: c.lon,
    value: c.intensity,
  }));

  return (
    <div className="space-y-4">
      {/* live recorder */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-orange-400" />
          <h3 className="text-sm font-semibold text-zinc-100">GPS recorder</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            disabled={recording}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 disabled:opacity-50"
          >
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {!recording ? (
            <button
              type="button"
              onClick={startRecording}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
            >
              <Activity className="w-3.5 h-3.5" /> Start recording
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Square className="w-3.5 h-3.5" />}
              Stop &amp; save
            </button>
          )}
          <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg cursor-pointer">
            <Upload className="w-3.5 h-3.5" /> Import GPX
            <input
              type="file"
              accept=".gpx,application/gpx+xml,text/xml"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importGpx(f); e.target.value = ''; }}
            />
          </label>
        </div>

        {recording && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5">
              <p className="text-[10px] uppercase text-zinc-500">Time</p>
              <p className="text-sm font-bold text-zinc-100 flex items-center gap-1">
                <Clock className="w-3 h-3 text-orange-400" />{durLabel(elapsed)}
              </p>
            </div>
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5">
              <p className="text-[10px] uppercase text-zinc-500">Distance</p>
              <p className="text-sm font-bold text-zinc-100 flex items-center gap-1">
                <Ruler className="w-3 h-3 text-orange-400" />{liveDistanceKm} km
              </p>
            </div>
            <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1.5">
              <p className="text-[10px] uppercase text-zinc-500">GPS fixes</p>
              <p className="text-sm font-bold text-zinc-100 flex items-center gap-1">
                <MapPin className="w-3 h-3 text-orange-400" />{points.length}
              </p>
            </div>
          </div>
        )}

        {error && <p className="text-xs text-rose-400">{error}</p>}
        {notice && <p className="text-xs text-emerald-400">{notice}</p>}
      </div>

      {/* heatmap */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-semibold text-zinc-100">Activity heatmap</h3>
          </div>
          <span className="text-[11px] text-zinc-500 flex items-center gap-1">
            <Route className="w-3 h-3" /> {tracks} GPS track{tracks === 1 ? '' : 's'}
          </span>
        </div>
        {loadingHeat ? (
          <div className="flex items-center justify-center py-10 text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : cells.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm italic py-10 border border-zinc-800 rounded-lg">
            No GPS data yet. Record an activity or import a GPX file to build your heatmap.
          </div>
        ) : (
          <>
            <MapView markers={markers} height={280} />
            <p className="text-[11px] text-zinc-500">
              {cells.length} hot cells · brighter cells are routes you cover most often.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
