'use client';

/**
 * FieldLog — Mindat / field-geology-shape observation journal: record
 * rock / mineral / fossil / outcrop finds with location, formation
 * and notes. Wires the geology.observation-* + field-dashboard macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Mountain, Plus, Trash2, MapPin, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Observation {
  id: string; name: string; kind: string; lat: number | null; lon: number | null;
  locationName: string | null; formation: string | null; notes: string;
  tags: string[]; collectedAt: string;
}
interface Dash { totalObservations: number; byKind: Record<string, number>; geotagged: number; formations: number }

const KINDS = ['rock', 'mineral', 'fossil', 'outcrop', 'structure', 'other'];
const KIND_COLOR: Record<string, string> = {
  rock: 'bg-stone-700 text-stone-200', mineral: 'bg-cyan-900/60 text-cyan-300',
  fossil: 'bg-amber-900/60 text-amber-300', outcrop: 'bg-emerald-900/60 text-emerald-300',
  structure: 'bg-violet-900/60 text-violet-300', other: 'bg-zinc-800 text-zinc-400',
};

export function FieldLog() {
  const [obs, setObs] = useState<Observation[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', kind: 'rock', locationName: '', formation: '', notes: '' });

  const refresh = useCallback(async () => {
    const [ol, d] = await Promise.all([
      lensRun('geology', 'observation-list', filter ? { kind: filter } : {}),
      lensRun('geology', 'field-dashboard', {}),
    ]);
    setObs((ol.data?.result?.observations as Observation[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, [filter]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function log() {
    if (!form.name.trim()) return;
    await lensRun('geology', 'observation-log', {
      name: form.name.trim(), kind: form.kind,
      locationName: form.locationName.trim(), formation: form.formation.trim(), notes: form.notes.trim(),
    });
    setForm({ name: '', kind: 'rock', locationName: '', formation: '', notes: '' });
    await refresh();
  }
  async function del(id: string) {
    await lensRun('geology', 'observation-delete', { id });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Mountain className="w-4 h-4 text-amber-500" />
        <h3 className="text-sm font-bold text-zinc-100">Field Observation Log</h3>
        <span className="text-[11px] text-zinc-400">Mindat shape</span>
      </div>

      {dash && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {([['Observations', dash.totalObservations], ['Geotagged', dash.geotagged], ['Formations', dash.formations]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 space-y-1.5">
        <div className="flex gap-1.5">
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Sample / outcrop name"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200 capitalize">
            {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <div className="flex gap-1.5">
          <input value={form.locationName} onChange={e => setForm({ ...form, locationName: e.target.value })} placeholder="Location"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <input value={form.formation} onChange={e => setForm({ ...form, formation: e.target.value })} placeholder="Formation"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        </div>
        <div className="flex gap-1.5">
          <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Field notes"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
          <button onClick={log} disabled={!form.name.trim()}
            className="px-3 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />Log
          </button>
        </div>
      </div>

      <div className="flex gap-1 mb-2">
        <button onClick={() => setFilter('')} className={cn('px-2 py-0.5 text-[11px] rounded', !filter ? 'bg-amber-600 text-white' : 'text-zinc-400')}>All</button>
        {KINDS.map(k => (
          <button key={k} onClick={() => setFilter(k)} className={cn('px-2 py-0.5 text-[11px] rounded capitalize', filter === k ? 'bg-amber-600 text-white' : 'text-zinc-400')}>{k}</button>
        ))}
      </div>

      {obs.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No observations logged yet.</p>
      ) : (
        <ul className="space-y-1 max-h-72 overflow-y-auto">
          {obs.map(o => (
            <li key={o.id} className="group bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={cn('text-[9px] px-1.5 py-0.5 rounded capitalize', KIND_COLOR[o.kind] || KIND_COLOR.other)}>{o.kind}</span>
                <span className="text-xs font-semibold text-zinc-100 flex-1 truncate">{o.name}</span>
                <span className="text-[10px] text-zinc-400">{o.collectedAt}</span>
                <button aria-label="Delete" onClick={() => del(o.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
              </div>
              {(o.locationName || o.formation || o.notes) && (
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  {o.locationName && <span className="inline-flex items-center gap-0.5"><MapPin className="w-2.5 h-2.5" />{o.locationName} · </span>}
                  {o.formation && <span>{o.formation} · </span>}
                  {o.notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
