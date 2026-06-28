'use client';

/**
 * StructuralCompass — digital strike/dip recorder (Strabo-shape).
 * Records planar structural measurements with a live compass-rose
 * preview and a stereonet-style mean-strike summary. Wires
 * geology.measurement-record / -list / -delete. No seed data.
 */

import { useCallback, useEffect, useState } from 'react';
import { Compass, Plus, Trash2, Loader2, Crosshair } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Measurement {
  id: string; planeKind: string; strike: number; dip: number;
  dipDirection: number; lat: number | null; lon: number | null;
  locationName: string | null; notes: string; recordedAt: string;
}

const PLANE_KINDS = ['bedding', 'foliation', 'joint', 'fault', 'cleavage', 'vein', 'contact', 'other'];

export function StructuralCompass() {
  const [rows, setRows] = useState<Measurement[]>([]);
  const [byKind, setByKind] = useState<Record<string, number>>({});
  const [meanStrike, setMeanStrike] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ planeKind: 'bedding', strike: '', dip: '', locationName: '', notes: '', lat: '', lon: '' });

  const refresh = useCallback(async () => {
    const r = await lensRun('geology', 'measurement-list', {});
    if (r.data?.ok) {
      setRows((r.data.result?.measurements as Measurement[]) || []);
      setByKind((r.data.result?.byKind as Record<string, number>) || {});
      setMeanStrike((r.data.result?.meanStrike as number | null) ?? null);
    }
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const useGps = useCallback(() => {
    if (!navigator.geolocation) { setError('Geolocation unavailable'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setForm((f) => ({ ...f, lat: p.coords.latitude.toFixed(5), lon: p.coords.longitude.toFixed(5) })),
      () => setError('Could not read GPS location'),
    );
  }, []);

  const record = useCallback(async () => {
    const strike = Number(form.strike), dip = Number(form.dip);
    if (!Number.isFinite(strike) || !Number.isFinite(dip)) { setError('Enter strike and dip'); return; }
    setError(null);
    const r = await lensRun('geology', 'measurement-record', {
      planeKind: form.planeKind, strike, dip,
      locationName: form.locationName.trim(), notes: form.notes.trim(),
      lat: form.lat ? Number(form.lat) : undefined,
      lon: form.lon ? Number(form.lon) : undefined,
    });
    // The /api/lens/run dispatch unwraps ONE { ok, result } layer, so a
    // handler that rejects with { ok:false, error } surfaces as
    // r.data.result.ok === false (r.data.ok is the always-true transport flag).
    const inner = r.data?.result as { ok?: boolean; error?: string } | undefined;
    if (r.data?.ok && inner?.ok !== false) {
      setForm({ planeKind: 'bedding', strike: '', dip: '', locationName: '', notes: '', lat: '', lon: '' });
      await refresh();
    } else {
      setError(inner?.error || r.data?.error || 'Could not record measurement');
    }
  }, [form, refresh]);

  const del = useCallback(async (id: string) => {
    await lensRun('geology', 'measurement-delete', { id });
    await refresh();
  }, [refresh]);

  const strikeNum = Number(form.strike);
  const previewStrike = Number.isFinite(strikeNum) ? ((strikeNum % 360) + 360) % 360 : 0;

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Compass className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-bold text-zinc-100">Strike &amp; Dip — Structural Measurements</h3>
        <span className="text-[11px] text-zinc-400">Strabo shape</span>
      </div>

      <div className="flex gap-3 mb-3">
        {/* Compass rose preview */}
        <svg viewBox="0 0 100 100" className="w-24 h-24 shrink-0">
          <circle cx="50" cy="50" r="46" fill="none" stroke="#3f3f46" strokeWidth="1.5" />
          {[0, 90, 180, 270].map((a) => {
            const rad = (a * Math.PI) / 180;
            return (
              <text key={a} x={50 + 40 * Math.sin(rad)} y={50 - 40 * Math.cos(rad) + 3}
                textAnchor="middle" fontSize="8" fill="#71717a">
                {a === 0 ? 'N' : a === 90 ? 'E' : a === 180 ? 'S' : 'W'}
              </text>
            );
          })}
          {/* Strike line */}
          {Number.isFinite(strikeNum) && (
            <line
              x1={50 - 42 * Math.sin((previewStrike * Math.PI) / 180)}
              y1={50 + 42 * Math.cos((previewStrike * Math.PI) / 180)}
              x2={50 + 42 * Math.sin((previewStrike * Math.PI) / 180)}
              y2={50 - 42 * Math.cos((previewStrike * Math.PI) / 180)}
              stroke="#38bdf8" strokeWidth="2.5" />
          )}
          {/* Dip-direction tick (90° CW of strike) */}
          {Number.isFinite(strikeNum) && (
            <line
              x1="50" y1="50"
              x2={50 + 22 * Math.sin(((previewStrike + 90) * Math.PI) / 180)}
              y2={50 - 22 * Math.cos(((previewStrike + 90) * Math.PI) / 180)}
              stroke="#f59e0b" strokeWidth="2" markerEnd="" />
          )}
        </svg>

        <div className="flex-1 space-y-1.5">
          <div className="flex gap-1.5">
            <select value={form.planeKind} onChange={(e) => setForm({ ...form, planeKind: e.target.value })}
              className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200 capitalize">
              {PLANE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <input value={form.strike} onChange={(e) => setForm({ ...form, strike: e.target.value })}
              placeholder="Strike°" type="number"
              className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <input value={form.dip} onChange={(e) => setForm({ ...form, dip: e.target.value })}
              placeholder="Dip°" type="number"
              className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          </div>
          <div className="flex gap-1.5">
            <input value={form.locationName} onChange={(e) => setForm({ ...form, locationName: e.target.value })}
              placeholder="Location" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <button onClick={useGps}
              className="px-2 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 inline-flex items-center gap-1">
              <Crosshair className="w-3 h-3" />{form.lat ? 'GPS✓' : 'GPS'}
            </button>
          </div>
          <div className="flex gap-1.5">
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Notes" className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
            <button onClick={record}
              className="px-3 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold inline-flex items-center gap-1">
              <Plus className="w-3 h-3" />Record
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-rose-400 mb-2">{error}</p>}

      {rows.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2 text-[10px] text-zinc-400">
          {meanStrike != null && <span className="text-sky-300">Mean strike: {meanStrike}°</span>}
          {Object.entries(byKind).map(([k, n]) => <span key={k} className="capitalize">{k}: {n}</span>)}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No structural measurements recorded yet.</p>
      ) : (
        <ul className="space-y-1 max-h-64 overflow-y-auto">
          {rows.map((m) => (
            <li key={m.id} className="group bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-900/60 text-sky-300 capitalize">{m.planeKind}</span>
                <span className="text-xs font-mono text-zinc-100">{m.strike}° / {m.dip}°</span>
                <span className="text-[10px] text-zinc-400">dip→{m.dipDirection}°</span>
                {m.locationName && <span className="text-[10px] text-zinc-400 truncate flex-1">{m.locationName}</span>}
                <button aria-label="Delete" onClick={() => del(m.id)} className={cn('text-rose-400 ml-auto', 'opacity-0 group-hover:opacity-100')}>
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              {m.notes && <p className="text-[11px] text-zinc-400 mt-0.5">{m.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
