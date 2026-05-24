'use client';

/**
 * StravaSegmentsPanel — segments + KOM/QOM-style leaderboards.
 * fitness.segment-list / segment-create / segment-effort / segment-leaderboard.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trophy, Mountain, ChevronRight, Map as MapIcon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { MapView, type MapMarker } from '@/components/viz/MapView';
import { cn } from '@/lib/utils';

interface Segment {
  id: string;
  name: string;
  activityType: string;
  distanceKm: number;
  elevationGainM: number;
  location: string | null;
  effortCount: number;
  myBestSeconds: number | null;
  courseRecordSeconds: number | null;
}
interface GeoSegment {
  id: string;
  name: string;
  lat: number;
  lon: number;
  activityType: string;
  distanceKm: number;
  elevationGainM: number;
  effortCount: number;
  courseRecordSeconds: number | null;
}
interface BoardRow { rank: number; userId: string; time: string; timeSeconds: number; isMe: boolean; title: string | null }

function timeLabel(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function StravaSegmentsPanel() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', activityType: 'run', distanceKm: '', elevationGainM: '', location: '', lat: '', lon: '' });
  const [openSeg, setOpenSeg] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [effortTime, setEffortTime] = useState('');
  const [geoSegments, setGeoSegments] = useState<GeoSegment[]>([]);
  const [showMap, setShowMap] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [r, ex] = await Promise.all([
      lensRun('fitness', 'segment-list', {}),
      lensRun('fitness', 'segment-explore', {}),
    ]);
    if (r.data?.ok === false) setError(r.data?.error || 'Failed to load segments');
    else { setSegments(r.data?.result?.segments || []); setError(null); }
    if (ex.data?.ok) setGeoSegments(ex.data.result?.segments || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!form.name.trim()) { setError('Segment name is required.'); return; }
    const lat = form.lat.trim() ? Number(form.lat) : undefined;
    const lon = form.lon.trim() ? Number(form.lon) : undefined;
    const r = await lensRun('fitness', 'segment-create', {
      name: form.name.trim(),
      activityType: form.activityType,
      distanceKm: Number(form.distanceKm) || 0,
      elevationGainM: Number(form.elevationGainM) || 0,
      location: form.location.trim(),
      lat: Number.isFinite(lat) ? lat : undefined,
      lon: Number.isFinite(lon) ? lon : undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not create segment'); return; }
    setForm({ name: '', activityType: 'run', distanceKm: '', elevationGainM: '', location: '', lat: '', lon: '' });
    setShowForm(false);
    await refresh();
  };

  const useMyLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setForm((f) => ({
        ...f,
        lat: pos.coords.latitude.toFixed(5),
        lon: pos.coords.longitude.toFixed(5),
      })),
      (err) => setError(`GPS error: ${err.message}`),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const openLeaderboard = async (segId: string) => {
    if (openSeg === segId) { setOpenSeg(null); return; }
    setOpenSeg(segId);
    const r = await lensRun('fitness', 'segment-leaderboard', { segmentId: segId });
    setBoard(r.data?.ok === false ? [] : (r.data?.result?.leaderboard || []));
  };

  const recordEffort = async (segId: string) => {
    const sec = Number(effortTime);
    if (!sec || sec <= 0) { setError('Enter a time in seconds.'); return; }
    const r = await lensRun('fitness', 'segment-effort', { segmentId: segId, timeSeconds: sec });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not record effort'); return; }
    setEffortTime('');
    await openLeaderboard(segId === openSeg ? segId : segId);
    const lb = await lensRun('fitness', 'segment-leaderboard', { segmentId: segId });
    setBoard(lb.data?.result?.leaderboard || []);
    setOpenSeg(segId);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-12 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const geoMarkers: MapMarker[] = geoSegments.map((g) => ({
    id: g.id,
    lat: g.lat,
    lon: g.lon,
    label: g.name,
    tone: g.courseRecordSeconds != null ? 'good' : 'info',
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400"><span className="text-zinc-100 font-semibold">{segments.length}</span> segments</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowMap((v) => !v)}
            className={cn('flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg',
              showMap ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-300 hover:text-zinc-100')}>
            <MapIcon className="w-3.5 h-3.5" /> Explore map
          </button>
          <button type="button" onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> New segment
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showMap && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-orange-400" />
            <h3 className="text-sm font-semibold text-zinc-100">Segment explorer</h3>
            <span className="text-[11px] text-zinc-400">{geoSegments.length} geo-located</span>
          </div>
          {geoSegments.length === 0 ? (
            <p className="text-xs text-zinc-400 italic py-6 text-center">
              No geo-located segments yet. Add latitude &amp; longitude when creating a segment to place it on the map.
            </p>
          ) : (
            <>
              <MapView markers={geoMarkers} height={260} onSelect={(m) => openLeaderboard(m.id)} />
              <p className="text-[11px] text-zinc-400">Tap a pin to open its leaderboard.</p>
            </>
          )}
        </div>
      )}

      {showForm && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Segment name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.activityType} onChange={(e) => setForm({ ...form, activityType: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['run', 'ride', 'hike', 'walk'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input placeholder="Distance (km)" inputMode="decimal" value={form.distanceKm} onChange={(e) => setForm({ ...form, distanceKm: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Elevation (m)" inputMode="numeric" value={form.elevationGainM} onChange={(e) => setForm({ ...form, elevationGainM: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Location name" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Latitude (for map)" inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Longitude (for map)" inputMode="decimal" value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={useMyLocation}
            className="col-span-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-lg px-2 py-1.5">
            Use my current location
          </button>
          <button type="button" onClick={create}
            className="col-span-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            Create segment
          </button>
        </div>
      )}

      {segments.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No segments yet. Create a climb or sprint to start a leaderboard.
        </div>
      ) : (
        <ul className="space-y-2">
          {segments.map((seg) => (
            <li key={seg.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
              <button type="button" onClick={() => openLeaderboard(seg.id)}
                className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-zinc-900">
                <div>
                  <p className="text-sm font-semibold text-zinc-100">{seg.name}</p>
                  <p className="text-[11px] text-zinc-400">
                    {seg.distanceKm} km · {seg.elevationGainM} m · {seg.effortCount} efforts
                    {seg.location ? ` · ${seg.location}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {seg.courseRecordSeconds != null && (
                    <span className="flex items-center gap-1 text-[11px] text-amber-400">
                      <Trophy className="w-3 h-3" />{timeLabel(seg.courseRecordSeconds)}
                    </span>
                  )}
                  <ChevronRight className={cn('w-4 h-4 text-zinc-600 transition-transform', openSeg === seg.id && 'rotate-90')} />
                </div>
              </button>

              {openSeg === seg.id && (
                <div className="border-t border-zinc-800 px-3 py-2 bg-zinc-950/50">
                  {board.length === 0 ? (
                    <p className="text-[11px] text-zinc-400 italic py-2">No efforts recorded yet.</p>
                  ) : (
                    <ol className="space-y-1 mb-2">
                      {board.map((row) => (
                        <li key={row.userId} className={cn('flex items-center justify-between text-[11px] px-2 py-1 rounded',
                          row.isMe ? 'bg-orange-950/40 text-orange-200' : 'text-zinc-300')}>
                          <span className="flex items-center gap-1.5">
                            <span className="w-5 text-zinc-400">{row.rank}</span>
                            {row.title && <Trophy className="w-3 h-3 text-amber-400" />}
                            <span className="font-mono">{row.userId.slice(0, 10)}</span>
                          </span>
                          <span className="font-mono">{row.time}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="flex gap-1">
                    <input placeholder="Your time (seconds)" inputMode="numeric" value={effortTime}
                      onChange={(e) => setEffortTime(e.target.value)}
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                    <button type="button" onClick={() => recordEffort(seg.id)}
                      className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-orange-600 hover:bg-orange-500 text-white rounded-lg">
                      <Mountain className="w-3 h-3" /> Record
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
