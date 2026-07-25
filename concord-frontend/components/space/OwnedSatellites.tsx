'use client';

/**
 * OwnedSatellites — track a user-owned (hypothetical/fictional) satellite
 * by name + orbital parameters, see its LIVE-derived period/orbits-per-day/
 * orbital class, and generate an ESTIMATED ground-station pass schedule.
 *
 * IMPORTANT — this is deliberately NOT styled like VisiblePassPredictor
 * (the real live-tracked ISS pass panel next to this tab). A user-tracked
 * satellite has no ephemeris feed to sample — there is nothing to track
 * live, because the object doesn't really exist. The pass-finder below is
 * an analytical estimate derived from orbital period alone (space.
 * satellite-passes), and is visually marked as such: amber/dashed framing,
 * an explicit "ESTIMATED" badge on every result, and the backend's own
 * honesty note surfaced verbatim — never presented with the same visual
 * confidence as the real wheretheiss.at-backed ISS passes tab.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Satellite, Plus, Trash2, Loader2, MapPin, AlertTriangle, Radar, Info,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TrackedSatellite {
  id: string;
  name: string;
  altitudeKm: number;
  inclinationDeg: number;
  notes: string;
  trackedAt: string;
  periodMinutes: number;
  orbitsPerDay: number;
  type: 'LEO' | 'MEO' | 'GEO';
}

interface EstimatedPass {
  index: number;
  startUtc: string;
  endUtc: string;
  durationMinutes: number;
}

interface PassesResult {
  satellite: { id: string; name: string; altitudeKm: number; inclinationDeg: number };
  observer: { latitude: number; longitude: number };
  windowHours: number;
  periodMinutes: number;
  passes: EstimatedPass[];
  count: number;
  precision: 'estimated';
  note: string;
}

const ZONE_TONE: Record<string, string> = {
  LEO: 'text-cyan-400 bg-cyan-500/10',
  MEO: 'text-indigo-400 bg-indigo-500/10',
  GEO: 'text-purple-400 bg-purple-500/10',
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function OwnedSatellites() {
  const [sats, setSats] = useState<TrackedSatellite[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', altitudeKm: '', inclinationDeg: '', notes: '' });
  const [trackError, setTrackError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState('');
  const [observer, setObserver] = useState({ latitude: '', longitude: '' });
  const [windowHours, setWindowHours] = useState('24');
  const [passResult, setPassResult] = useState<PassesResult | null>(null);
  const [passLoading, setPassLoading] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ satellites: TrackedSatellite[] }>('space', 'satellite-list', {});
    setSats(r.data?.result?.satellites || []);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function track() {
    setTrackError(null);
    const altitudeKm = Number(form.altitudeKm);
    if (!form.name.trim()) { setTrackError('Satellite name required'); return; }
    if (!Number.isFinite(altitudeKm) || altitudeKm <= 0) { setTrackError('Altitude (km) must be a positive number'); return; }
    const r = await lensRun('space', 'satellite-track', {
      name: form.name.trim(),
      altitudeKm,
      inclinationDeg: form.inclinationDeg.trim() ? Number(form.inclinationDeg) : undefined,
      notes: form.notes.trim(),
    });
    if (!r.data?.ok) { setTrackError(r.data?.error || 'Track failed'); return; }
    setForm({ name: '', altitudeKm: '', inclinationDeg: '', notes: '' });
    await refresh();
  }

  async function untrack(id: string) {
    await lensRun('space', 'satellite-untrack', { id });
    if (selectedId === id) { setSelectedId(''); setPassResult(null); }
    await refresh();
  }

  const findPasses = useCallback(async (lat: number, lon: number) => {
    if (!selectedId) { setPassError('Pick a tracked satellite first'); return; }
    setPassLoading(true);
    setPassError(null);
    const r = await lensRun<PassesResult>('space', 'satellite-passes', {
      id: selectedId,
      latitude: lat,
      longitude: lon,
      windowHours: Number(windowHours) || 24,
    });
    if (r.data?.ok && r.data.result) setPassResult(r.data.result);
    else setPassError(r.data?.error || 'Pass estimate failed');
    setPassLoading(false);
  }, [selectedId, windowHours]);

  function submitObserver() {
    const lat = Number(observer.latitude);
    const lon = Number(observer.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { setPassError('Latitude and longitude required'); return; }
    void findPasses(lat, lon);
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setPassError('Geolocation is not available in this browser'); return; }
    setPassLoading(true);
    setPassError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const lat = p.coords.latitude, lon = p.coords.longitude;
        setObserver({ latitude: lat.toFixed(4), longitude: lon.toFixed(4) });
        void findPasses(lat, lon);
      },
      (e) => { setPassError(`Location denied: ${e.message}`); setPassLoading(false); },
      { timeout: 10000 }, // @env-config-ok: PositionOptions.timeout — a W3C Geolocation API argument (how long to wait for a GPS fix before the error callback fires), not deployment config.
    );
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="space-y-5">
      {/* ── Track form ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Satellite className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-bold text-zinc-100">My Satellites</h3>
          <span className="text-[11px] text-zinc-400">user-owned — not live-tracked</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <input data-testid="sat-track-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Satellite name"
            className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input data-testid="sat-track-altitude" value={form.altitudeKm} onChange={e => setForm({ ...form, altitudeKm: e.target.value })} placeholder="Altitude (km)" type="number" min={1}
            className="w-32 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input data-testid="sat-track-inclination" value={form.inclinationDeg} onChange={e => setForm({ ...form, inclinationDeg: e.target.value })} placeholder="Inclination° (51.6)" type="number" min={0} max={180}
            className="w-36 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input data-testid="sat-track-notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Notes (optional)"
            className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <button data-testid="sat-track-submit" onClick={track} disabled={!form.name.trim() || !form.altitudeKm.trim()}
            className="px-2.5 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />Track
          </button>
        </div>
        {trackError && <p data-testid="sat-track-error" className="text-[11px] text-rose-400 mt-1.5">{trackError}</p>}

        {sats.length === 0 ? (
          <p data-testid="sat-list-empty" className="text-xs text-zinc-400 italic mt-3">No tracked satellites — add one above to compute its orbit.</p>
        ) : (
          <ul className="space-y-1 mt-3">
            {sats.map(s => (
              <li key={s.id} data-testid={`sat-list-item-${s.id}`}
                onClick={() => setSelectedId(s.id)}
                className={cn('group flex items-center gap-2 bg-zinc-900/60 border rounded-lg px-3 py-2 cursor-pointer transition-colors',
                  selectedId === s.id ? 'border-indigo-500/60' : 'border-zinc-800 hover:border-zinc-700')}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-zinc-100 truncate">{s.name}</p>
                  <p data-testid={`sat-list-item-${s.id}-detail`} className="text-[10px] text-zinc-400">
                    {s.altitudeKm} km · incl {s.inclinationDeg}° · period {s.periodMinutes} min · {s.orbitsPerDay} orbits/day
                    {s.notes ? ` · ${s.notes}` : ''}
                  </p>
                </div>
                <span data-testid={`sat-list-item-${s.id}-zone`} className={cn('text-[10px] px-1.5 py-0.5 rounded shrink-0', ZONE_TONE[s.type] || 'text-zinc-400 bg-zinc-800')}>{s.type}</span>
                <button aria-label="Delete" data-testid={`sat-list-item-${s.id}-delete`} onClick={(e) => { e.stopPropagation(); void untrack(s.id); }}
                  className="opacity-0 group-hover:opacity-100 text-rose-400 shrink-0"><Trash2 className="w-3 h-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Pass finder — ESTIMATED, visually distinct from live-tracked panels ── */}
      <div data-testid="sat-passes-panel" className="rounded-lg border border-dashed border-amber-700/40 bg-amber-950/10 p-3">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold text-amber-200 flex items-center gap-1.5">
            <Radar className="w-3.5 h-3.5 text-amber-400" /> Ground-Station Pass Finder
          </h4>
          <span data-testid="sat-passes-estimated-badge" className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold tracking-wide">
            ESTIMATED — not live
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <select data-testid="sat-passes-select" value={selectedId} onChange={e => { setSelectedId(e.target.value); setPassResult(null); }}
            className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200">
            <option value="">Select a tracked satellite…</option>
            {sats.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input data-testid="sat-passes-lat" value={observer.latitude} onChange={e => setObserver({ ...observer, latitude: e.target.value })} placeholder="Latitude" type="number"
            className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input data-testid="sat-passes-lon" value={observer.longitude} onChange={e => setObserver({ ...observer, longitude: e.target.value })} placeholder="Longitude" type="number"
            className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input data-testid="sat-passes-window" value={windowHours} onChange={e => setWindowHours(e.target.value)} placeholder="Window (h)" type="number" min={1} max={72}
            className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <button data-testid="sat-passes-mylocation" onClick={useMyLocation} disabled={passLoading || !selectedId}
            className="px-2 py-1.5 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 inline-flex items-center gap-1">
            <MapPin className="w-3 h-3" />My location
          </button>
          <button data-testid="sat-passes-find" onClick={submitObserver} disabled={passLoading || !selectedId}
            className="px-2.5 py-1.5 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40 inline-flex items-center gap-1">
            {passLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Radar className="w-3 h-3" />}Find passes
          </button>
        </div>

        {passError && (
          <div data-testid="sat-passes-error" className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 rounded-lg p-2.5 mb-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {passError}
          </div>
        )}

        {!passResult && !passError && (
          <p className="text-[11px] text-amber-200/60">
            Pick a satellite + ground station to see an estimated pass schedule, derived from orbital period only — no live ephemeris exists for a user-tracked satellite.
          </p>
        )}

        {passResult && (
          <div data-testid="sat-passes-result" className="space-y-2">
            <div data-testid="sat-passes-note" className="flex items-start gap-2 text-[11px] text-amber-200/80 bg-amber-500/5 rounded-lg p-2">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
              <span>{passResult.note}</span>
            </div>

            {passResult.count === 0 ? (
              <p data-testid="sat-passes-zero" className="text-xs text-zinc-400 border border-dashed border-zinc-800 rounded-lg p-4 text-center">
                Zero estimated passes for this ground station in the next {passResult.windowHours}h.
              </p>
            ) : (
              <ul data-testid="sat-passes-list" className="space-y-1.5">
                {passResult.passes.map(p => (
                  <li key={p.index} data-testid={`sat-passes-item-${p.index}`} className="flex items-center gap-3 p-2.5 bg-zinc-900 rounded-lg border border-zinc-800">
                    <div className="text-center shrink-0">
                      <p className="text-xs font-mono font-bold text-white tabular-nums">{fmtTime(p.startUtc)}</p>
                      <p className="text-[10px] text-zinc-400">start (est.)</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-zinc-300">~{p.durationMinutes} min visible window</p>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold shrink-0">est.</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
