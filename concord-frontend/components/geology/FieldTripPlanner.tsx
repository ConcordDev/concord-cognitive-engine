'use client';

/**
 * FieldTripPlanner — field-trip / outcrop sequencing. Build an ordered
 * itinerary of outcrop stops with per-stop lithology, formation and
 * notes; reorder stops up/down. Wires geology.fieldtrip-create / -list
 * / -add-stop / -update-stop / -reorder-stops / -delete. No seed data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Route, Plus, Trash2, Loader2, ChevronUp, ChevronDown, MapPin, Crosshair } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Stop {
  id: string; order: number; name: string; lat: number | null; lon: number | null;
  lithology: string | null; formation: string | null; notes: string;
}
interface FieldTrip {
  id: string; name: string; area: string | null; date: string; summary: string; stops: Stop[];
}

export function FieldTripPlanner() {
  const [trips, setTrips] = useState<FieldTrip[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tripForm, setTripForm] = useState({ name: '', area: '', date: '' });
  const [stopForm, setStopForm] = useState({ name: '', lithology: '', formation: '', notes: '', lat: '', lon: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun('geology', 'fieldtrip-list', {});
    if (r.data?.ok) {
      const list = (r.data.result?.fieldTrips as FieldTrip[]) || [];
      setTrips(list);
      setActiveId((prev) => (prev && list.some((t) => t.id === prev) ? prev : list[0]?.id ?? null));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const active = trips.find((t) => t.id === activeId) || null;

  const createTrip = useCallback(async () => {
    if (!tripForm.name.trim()) return;
    setError(null);
    const r = await lensRun('geology', 'fieldtrip-create', {
      name: tripForm.name.trim(), area: tripForm.area.trim(),
      date: tripForm.date || undefined,
    });
    const inner = r.data?.result as { ok?: boolean; error?: string; fieldTrip?: FieldTrip } | undefined;
    if (r.data?.ok && inner?.ok !== false) {
      setTripForm({ name: '', area: '', date: '' });
      setActiveId(inner?.fieldTrip?.id ?? null);
      await refresh();
    } else setError(inner?.error || r.data?.error || 'Could not create field trip');
  }, [tripForm, refresh]);

  const deleteTrip = useCallback(async (id: string) => {
    await lensRun('geology', 'fieldtrip-delete', { id });
    await refresh();
  }, [refresh]);

  const useGps = useCallback(() => {
    if (!navigator.geolocation) { setError('Geolocation unavailable'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setStopForm((f) => ({ ...f, lat: p.coords.latitude.toFixed(5), lon: p.coords.longitude.toFixed(5) })),
      () => setError('Could not read GPS location'),
    );
  }, []);

  const addStop = useCallback(async () => {
    if (!active || !stopForm.name.trim()) return;
    setError(null);
    const r = await lensRun('geology', 'fieldtrip-add-stop', {
      tripId: active.id, name: stopForm.name.trim(),
      lithology: stopForm.lithology.trim(), formation: stopForm.formation.trim(),
      notes: stopForm.notes.trim(),
      lat: stopForm.lat ? Number(stopForm.lat) : undefined,
      lon: stopForm.lon ? Number(stopForm.lon) : undefined,
    });
    const inner = r.data?.result as { ok?: boolean; error?: string } | undefined;
    if (r.data?.ok && inner?.ok !== false) {
      setStopForm({ name: '', lithology: '', formation: '', notes: '', lat: '', lon: '' });
      await refresh();
    } else setError(inner?.error || r.data?.error || 'Could not add stop');
  }, [active, stopForm, refresh]);

  const move = useCallback(async (idx: number, dir: -1 | 1) => {
    if (!active) return;
    const ids = active.stops.map((s) => s.id);
    const swap = idx + dir;
    if (swap < 0 || swap >= ids.length) return;
    [ids[idx], ids[swap]] = [ids[swap], ids[idx]];
    const r = await lensRun('geology', 'fieldtrip-reorder-stops', { tripId: active.id, stopIds: ids });
    const inner = r.data?.result as { ok?: boolean; error?: string } | undefined;
    if (r.data?.ok && inner?.ok !== false) await refresh();
    else setError(inner?.error || r.data?.error || 'Could not reorder stops');
  }, [active, refresh]);

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Route className="w-4 h-4 text-orange-400" />
        <h3 className="text-sm font-bold text-zinc-100">Field Trips &amp; Outcrop Itinerary</h3>
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex gap-1.5">
        <input value={tripForm.name} onChange={(e) => setTripForm({ ...tripForm, name: e.target.value })}
          placeholder="Field trip name"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={tripForm.area} onChange={(e) => setTripForm({ ...tripForm, area: e.target.value })}
          placeholder="Area / region"
          className="w-32 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input type="date" value={tripForm.date} onChange={(e) => setTripForm({ ...tripForm, date: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={createTrip} disabled={!tripForm.name.trim()}
          className="px-3 py-1 text-xs rounded bg-orange-600 hover:bg-orange-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Trip
        </button>
      </div>

      {error && <p className="text-xs text-rose-400 mb-2">{error}</p>}

      {trips.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No field trips planned yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 mb-3">
            {trips.map((t) => (
              <button key={t.id} onClick={() => setActiveId(t.id)}
                className={`px-2 py-1 text-[11px] rounded inline-flex items-center gap-1 ${
                  t.id === activeId ? 'bg-orange-600 text-white' : 'bg-zinc-800 text-zinc-300'}`}>
                {t.name}<span className="opacity-60">· {t.stops.length}</span>
              </button>
            ))}
          </div>

          {active && (
            <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-bold text-zinc-100">{active.name}</p>
                  <p className="text-[11px] text-zinc-400">
                    {active.area ? `${active.area} · ` : ''}{active.date} · {active.stops.length} stops
                  </p>
                </div>
                <button onClick={() => deleteTrip(active.id)} aria-label="Delete trip"
                  className="text-rose-400 hover:text-rose-300">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <ol className="space-y-1 mb-3">
                {active.stops.length === 0 && (
                  <p className="text-xs text-zinc-400 italic">No stops yet — add the first outcrop below.</p>
                )}
                {active.stops.map((s, idx) => (
                  <li key={s.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-2.5 py-1.5 flex items-start gap-2">
                    <span className="w-5 h-5 shrink-0 rounded-full bg-orange-900/70 text-orange-300 text-[11px] font-bold flex items-center justify-center">{s.order}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-zinc-100 truncate">{s.name}</p>
                      <p className="text-[11px] text-zinc-400">
                        {s.lithology && <span>{s.lithology} · </span>}
                        {s.formation && <span>{s.formation} · </span>}
                        {s.lat != null && s.lon != null && (
                          <span className="inline-flex items-center gap-0.5">
                            <MapPin className="w-2.5 h-2.5" />{s.lat.toFixed(3)}, {s.lon.toFixed(3)}
                          </span>
                        )}
                      </p>
                      {s.notes && <p className="text-[11px] text-zinc-400 mt-0.5">{s.notes}</p>}
                    </div>
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button onClick={() => move(idx, -1)} disabled={idx === 0} aria-label="Move stop up"
                        className="text-zinc-400 hover:text-zinc-200 disabled:opacity-20">
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => move(idx, 1)} disabled={idx === active.stops.length - 1} aria-label="Move stop down"
                        className="text-zinc-400 hover:text-zinc-200 disabled:opacity-20">
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="border-t border-zinc-800 pt-2 space-y-1.5">
                <div className="flex gap-1.5">
                  <input value={stopForm.name} onChange={(e) => setStopForm({ ...stopForm, name: e.target.value })}
                    placeholder="Outcrop / stop name"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                  <button onClick={useGps}
                    className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1">
                    <Crosshair className="w-3 h-3" />{stopForm.lat ? 'GPS✓' : 'GPS'}
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <input value={stopForm.lithology} onChange={(e) => setStopForm({ ...stopForm, lithology: e.target.value })}
                    placeholder="Lithology"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                  <input value={stopForm.formation} onChange={(e) => setStopForm({ ...stopForm, formation: e.target.value })}
                    placeholder="Formation"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                </div>
                <div className="flex gap-1.5">
                  <input value={stopForm.notes} onChange={(e) => setStopForm({ ...stopForm, notes: e.target.value })}
                    placeholder="Stop notes"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                  <button onClick={addStop} disabled={!stopForm.name.trim()}
                    className="px-3 py-1 text-xs rounded bg-orange-600 hover:bg-orange-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
                    <Plus className="w-3 h-3" />Stop
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
