'use client';

/**
 * TripWorkspaceSection — lists the macro-backed `travel` domain trips
 * (created via trip-create / shown by trip-list) and opens any of them
 * into the full Google Travel / TripIt feature-parity TripWorkspace:
 * itinerary map, agenda timeline, weather, flight/hotel search, booking
 * import, flight-status, collaboration and budget breakdown.
 *
 * Trips here are real user-created records — the section also surfaces
 * trips shared WITH the user by travel companions (trip-shared-list).
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, MapPin, Plane, Users } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { TripWorkspace, type WorkspaceTrip } from './TripWorkspace';

interface DomainTrip {
  id: string;
  name: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
  status?: string;
}

interface SharedTrip extends DomainTrip {
  ownerId: string;
  myRole: string;
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'text-zinc-500', upcoming: 'text-sky-400', active: 'text-emerald-400', past: 'text-zinc-600',
};

export function TripWorkspaceSection() {
  const [trips, setTrips] = useState<DomainTrip[]>([]);
  const [shared, setShared] = useState<SharedTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WorkspaceTrip | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', destination: '', startDate: '', endDate: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [own, shr] = await Promise.all([
      lensRun('travel', 'trip-list', {}),
      lensRun('travel', 'trip-shared-list', {}),
    ]);
    setTrips((own.data?.result?.trips as DomainTrip[]) || []);
    setShared((shr.data?.result?.trips as SharedTrip[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createTrip = useCallback(async () => {
    if (!form.name.trim() || !form.destination.trim()) {
      setError('Trip name and destination are required.');
      return;
    }
    const r = await lensRun('travel', 'trip-create', {
      name: form.name.trim(), destination: form.destination.trim(),
      startDate: form.startDate, endDate: form.endDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not create trip.'); return; }
    setForm({ name: '', destination: '', startDate: '', endDate: '' });
    setShowAdd(false); setError(null);
    await refresh();
  }, [form, refresh]);

  if (selected) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <TripWorkspace trip={selected} onBack={() => { setSelected(null); void refresh(); }} />
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
          <Plane className="w-4 h-4 text-sky-400" /> Trip workspace
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            map · agenda · collaborate
          </span>
        </h3>
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> New trip
        </button>
      </div>

      {error && (
        <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>
      )}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Trip name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Destination" value={form.destination} onChange={(e) => setForm((p) => ({ ...p, destination: e.target.value }))}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" title="Start date" value={form.startDate} onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" title="End date" value={form.endDate} onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={createTrip}
            className="col-span-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">
            Create trip
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : trips.length === 0 && shared.length === 0 ? (
        <div className="text-center text-zinc-500 text-xs italic py-8 border border-zinc-800 rounded-xl">
          No trips yet. Create one to open the map, agenda, weather and collaboration tools.
        </div>
      ) : (
        <div className="space-y-2">
          {trips.map((t) => (
            <button key={t.id} type="button" onClick={() => setSelected(t)}
              className="w-full flex items-center justify-between bg-zinc-900/70 border border-zinc-800 hover:border-sky-700 rounded-xl p-3 text-left transition-colors">
              <div>
                <p className="text-sm font-semibold text-zinc-100">
                  {t.name}
                  {t.status && <span className={cn('ml-2 text-[10px] uppercase', STATUS_COLOR[t.status])}>{t.status}</span>}
                </p>
                <p className="text-[11px] text-zinc-500 flex items-center gap-1">
                  <MapPin className="w-3 h-3" />{t.destination}
                  {t.startDate ? ` · ${t.startDate}${t.endDate ? ` → ${t.endDate}` : ''}` : ''}
                </p>
              </div>
              <span className="text-[10px] text-sky-400">Open workspace →</span>
            </button>
          ))}
          {shared.length > 0 && (
            <div className="pt-1">
              <p className="text-[11px] font-semibold text-zinc-400 flex items-center gap-1 mb-1.5">
                <Users className="w-3.5 h-3.5" /> Shared with you
              </p>
              {shared.map((t) => (
                <button key={t.id} type="button" onClick={() => setSelected(t)}
                  className="w-full flex items-center justify-between bg-zinc-900/50 border border-dashed border-zinc-800 hover:border-sky-700 rounded-xl p-3 text-left transition-colors mb-1">
                  <div>
                    <p className="text-sm font-semibold text-zinc-100">{t.name}</p>
                    <p className="text-[11px] text-zinc-500 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />{t.destination} · from {t.ownerId} · {t.myRole}
                    </p>
                  </div>
                  <span className="text-[10px] text-sky-400">Open workspace →</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
