'use client';

/**
 * EventMap — plots geographically-located timeline events on the shared
 * MapView and lets the user attach/clear coordinates per event. Points
 * come from the history.map-points macro; coordinates persist via
 * history.event-set-location. No hardcoded places.
 */

import { useCallback, useEffect, useState } from 'react';
import { MapPin, Save, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { MapView, type MapMarker } from '@/components/viz';

interface MapPoint {
  id: string;
  timelineId: string;
  timelineTitle: string;
  title: string;
  year: number;
  dateLabel: string;
  lat: number;
  lng: number;
  place: string;
  category: string;
}
interface EventOption { id: string; title: string; dateLabel: string }

export function EventMap({
  timelineId,
  events,
  onChanged,
}: {
  timelineId: string;
  events: EventOption[];
  onChanged?: () => void;
}) {
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [eventId, setEventId] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [place, setPlace] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const r = await lensRun<{ points: MapPoint[] }>('history', 'map-points', { timelineId });
    if (r.data?.ok && r.data.result) setPoints(r.data.result.points || []);
  }, [timelineId]);

  useEffect(() => { void load(); }, [load]);

  const setLocation = useCallback(async () => {
    setError('');
    if (!eventId) { setError('Select an event'); return; }
    const r = await lensRun('history', 'event-set-location', {
      timelineId, eventId, lat: Number(lat), lng: Number(lng), place: place.trim(),
    });
    if (!r.data?.ok) { setError(r.data?.error || 'Could not set location'); return; }
    setLat(''); setLng(''); setPlace(''); setEventId('');
    await load();
    onChanged?.();
  }, [timelineId, eventId, lat, lng, place, load, onChanged]);

  const clearLocation = useCallback(async (id: string) => {
    await lensRun('history', 'event-set-location', { timelineId, eventId: id, clear: true });
    await load();
    onChanged?.();
  }, [timelineId, load, onChanged]);

  const markers: MapMarker[] = points.map((p) => ({
    id: p.id, lat: p.lat, lon: p.lng,
    label: `${p.dateLabel} — ${p.title}`, tone: 'info',
  }));

  return (
    <div className="space-y-3">
      <MapView markers={markers} height={280} />

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5 space-y-2">
        <p className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5 text-amber-400" /> Plot an event geographically
        </p>
        <div className="flex flex-wrap gap-1.5">
          <select value={eventId} onChange={(e) => setEventId(e.target.value)}
            className="flex-1 min-w-[160px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200">
            <option value="">select event…</option>
            {events.map((e) => <option key={e.id} value={e.id}>{e.dateLabel} — {e.title}</option>)}
          </select>
          <input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="lat" inputMode="decimal"
            className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
          <input value={lng} onChange={(e) => setLng(e.target.value)} placeholder="lng" inputMode="decimal"
            className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
          <input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="place name"
            className="w-32 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
          <button onClick={setLocation} disabled={!eventId}
            className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-semibold disabled:opacity-40 inline-flex items-center gap-1">
            <Save className="w-3 h-3" /> Set
          </button>
        </div>
        {error && <p className="text-[10px] text-rose-400">{error}</p>}
      </div>

      {points.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic">No mapped events yet.</p>
      ) : (
        <ul className="space-y-1">
          {points.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-[11px] text-zinc-300 bg-zinc-900/40 rounded px-2 py-1">
              <span className="font-mono text-amber-400">{p.dateLabel}</span>
              <span className="flex-1 truncate">{p.title}</span>
              <span className="text-zinc-400 truncate max-w-[120px]">{p.place || `${p.lat.toFixed(2)}, ${p.lng.toFixed(2)}`}</span>
              <button onClick={() => clearLocation(p.id)} title="Remove location"
                className="text-rose-400 hover:text-rose-300"><X className="w-3 h-3" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
