'use client';

/**
 * SpotLog — a surf / dive / fishing spot tracker: save ocean spots and
 * log sessions with wave height, water temp and a rating. Wires the
 * ocean.spot-* and ocean.session-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Waves, Plus, Trash2, Loader2, Star } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import { cn } from '@/lib/utils';

interface Spot { id: string; name: string; kind: string; notes: string; sessionCount: number; lat: number | null; lon: number | null }
interface Session { id: string; spotId: string; spotName: string; date: string; waveHeightM: number | null; waterTempC: number | null; conditions: string | null; rating: number | null; notes: string }
interface Dash { spots: number; sessions: number; avgRating: number | null; byKind: Record<string, number> }

const KINDS = ['surf', 'dive', 'fishing', 'swim', 'other'];

export function SpotLog() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [spotForm, setSpotForm] = useState({ name: '', kind: 'surf', lat: '', lon: '' });
  const [editSpotId, setEditSpotId] = useState<string | null>(null);
  const [editSpotForm, setEditSpotForm] = useState({ name: '', kind: 'surf', notes: '' });
  const [sesForm, setSesForm] = useState({ waveHeightM: '', waterTempC: '', conditions: '', rating: '4' });

  const refresh = useCallback(async () => {
    const [sl, se, d] = await Promise.all([
      lensRun('ocean', 'spot-list', {}),
      lensRun('ocean', 'session-list', {}),
      lensRun('ocean', 'ocean-dashboard', {}),
    ]);
    setSpots((sl.data?.result?.spots as Spot[]) || []);
    setSessions((se.data?.result?.sessions as Session[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const [spotError, setSpotError] = useState<string | null>(null);
  async function addSpot() {
    if (!spotForm.name.trim()) { setSpotError('Spot name is required.'); return; }
    if (spotForm.name.trim().length > 160) { setSpotError('Spot name must be 160 characters or fewer.'); return; }
    setSpotError(null);
    const res = await lensRun('ocean', 'spot-add', {
      name: spotForm.name.trim(),
      kind: spotForm.kind,
      lat: spotForm.lat.trim() ? Number(spotForm.lat) : undefined,
      lon: spotForm.lon.trim() ? Number(spotForm.lon) : undefined,
    });
    if (res.data?.ok === false) { setSpotError(res.data?.message || res.data?.error || 'Could not save that spot.'); return; }
    setSpotForm({ name: '', kind: 'surf', lat: '', lon: '' });
    await refresh();
  }
  async function saveSpotEdit(id: string) {
    if (!editSpotForm.name.trim()) return;
    const res = await lensRun('ocean', 'spot-update', {
      id, name: editSpotForm.name.trim(), kind: editSpotForm.kind, notes: editSpotForm.notes.trim(),
    });
    if (res.data?.ok === false) return;
    setEditSpotId(null);
    await refresh();
  }
  async function delSpot(id: string) {
    await lensRun('ocean', 'spot-delete', { id });
    if (active === id) setActive(null);
    await refresh();
  }
  async function logSession() {
    if (!active) return;
    await lensRun('ocean', 'session-log', {
      spotId: active,
      waveHeightM: sesForm.waveHeightM ? Number(sesForm.waveHeightM) : undefined,
      waterTempC: sesForm.waterTempC ? Number(sesForm.waterTempC) : undefined,
      conditions: sesForm.conditions.trim(), rating: Number(sesForm.rating),
    });
    setSesForm({ waveHeightM: '', waterTempC: '', conditions: '', rating: '4' });
    await refresh();
  }
  async function delSession(id: string) {
    await lensRun('ocean', 'session-delete', { id });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  const shown = active ? sessions.filter(s => s.spotId === active) : sessions;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Waves className="w-4 h-4 text-cyan-400" />
        <h3 className="text-sm font-bold text-zinc-100">Spot Log</h3>
        {dash && <span className="ml-auto text-[10px] text-zinc-400">{dash.spots} spots · {dash.sessions} sessions{dash.avgRating != null ? ` · avg ${dash.avgRating}★` : ''}</span>}
      </div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5">
        <input value={spotForm.name} onChange={e => setSpotForm({ ...spotForm, name: e.target.value })} placeholder="Spot name"
          className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={spotForm.kind} onChange={e => setSpotForm({ ...spotForm, kind: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200 capitalize">
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <input value={spotForm.lat} onChange={e => setSpotForm({ ...spotForm, lat: e.target.value })} placeholder="lat"
          className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={spotForm.lon} onChange={e => setSpotForm({ ...spotForm, lon: e.target.value })} placeholder="lon"
          className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        {spotError && <p role="alert" className="w-full text-xs text-rose-300">{spotError}</p>}
        <button onClick={addSpot} disabled={!spotForm.name.trim()}
          className="px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" />Spot
        </button>
      </div>

      <div className="grid sm:grid-cols-[180px_1fr] gap-3">
        <ul className="space-y-1">
          <li>
            <button onClick={() => setActive(null)}
              className={cn('w-full text-left rounded-lg px-2.5 py-1.5 text-xs', !active ? 'bg-cyan-600/15 text-cyan-200' : 'text-zinc-400 hover:bg-zinc-900')}>
              All sessions
            </button>
          </li>
          {spots.map(sp => (
            <li key={sp.id} className="group">
              <div className="flex items-center gap-1">
                <button onClick={() => setActive(sp.id)}
                  className={cn('flex-1 text-left rounded-lg px-2.5 py-1.5 border', active === sp.id ? 'bg-cyan-600/15 border-cyan-700/50' : 'bg-zinc-900/60 border-zinc-800 hover:border-zinc-700')}>
                  <p className="text-xs font-semibold text-zinc-100 truncate">{sp.name}</p>
                  <p className="text-[10px] text-zinc-400 capitalize">
                    {sp.kind} · {sp.sessionCount} sessions{sp.lat != null && sp.lon != null ? ' · geo' : ''}
                  </p>
                </button>
                <button type="button" aria-label={`Edit ${sp.name}`}
                  onClick={() => { setEditSpotId(editSpotId === sp.id ? null : sp.id); setEditSpotForm({ name: sp.name, kind: sp.kind, notes: sp.notes || '' }); }}
                  className="text-[10px] font-semibold text-zinc-400 hover:text-cyan-300">Edit</button>
                <StickyDeleteConfirm onConfirm={() => delSpot(sp.id)} armAriaLabel={`Delete ${sp.name}`} confirmAriaLabel={`Confirm delete ${sp.name}`} className="text-rose-400" armLabel={<Trash2 className="w-3 h-3" />} />
              </div>
              {editSpotId === sp.id && (
                <div className="mt-1 space-y-1 rounded-lg border border-cyan-800/50 bg-zinc-900/60 p-2">
                  <input aria-label={`Spot name for ${sp.name}`} value={editSpotForm.name} onChange={e => setEditSpotForm({ ...editSpotForm, name: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                  <div className="flex gap-1.5">
                    <select aria-label="Spot kind" value={editSpotForm.kind} onChange={e => setEditSpotForm({ ...editSpotForm, kind: e.target.value })}
                      className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200 capitalize">
                      {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <input aria-label="Spot notes" value={editSpotForm.notes} onChange={e => setEditSpotForm({ ...editSpotForm, notes: e.target.value })} placeholder="Notes"
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => void saveSpotEdit(sp.id)} disabled={!editSpotForm.name.trim()}
                      className="px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold disabled:opacity-40">Save</button>
                    <button onClick={() => setEditSpotId(null)} className="px-2.5 py-1 text-xs rounded bg-zinc-800 text-zinc-300">Cancel</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div>
          {active && (
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-2 flex flex-wrap gap-1.5">
              <input value={sesForm.waveHeightM} onChange={e => setSesForm({ ...sesForm, waveHeightM: e.target.value })} placeholder="wave m"
                className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <input value={sesForm.waterTempC} onChange={e => setSesForm({ ...sesForm, waterTempC: e.target.value })} placeholder="temp °C"
                className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <input value={sesForm.conditions} onChange={e => setSesForm({ ...sesForm, conditions: e.target.value })} placeholder="conditions"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
              <select value={sesForm.rating} onChange={e => setSesForm({ ...sesForm, rating: e.target.value })}
                className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}★</option>)}
              </select>
              <button onClick={logSession} className="px-2.5 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold">Log session</button>
            </div>
          )}
          <ul className="space-y-1 max-h-72 overflow-y-auto">
            {shown.length === 0 ? (
              <li className="text-xs text-zinc-400 italic py-4 text-center">{active ? 'No sessions at this spot.' : 'No sessions logged.'}</li>
            ) : shown.map(se => (
              <li key={se.id} className="group flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-[10px] font-mono text-zinc-400">{se.date}</span>
                <span className="text-xs text-zinc-200 truncate flex-1">{se.spotName}{se.conditions ? ` · ${se.conditions}` : ''}</span>
                {se.waveHeightM != null && <span className="text-[10px] text-cyan-400">{se.waveHeightM}m</span>}
                {se.rating != null && (
                  <span className="flex">
                    {[1, 2, 3, 4, 5].map(n => <Star key={n} className={cn('w-2.5 h-2.5', se.rating! >= n ? 'text-amber-400' : 'text-zinc-700')} fill={se.rating! >= n ? 'currentColor' : 'none'} />)}
                  </span>
                )}
                <StickyDeleteConfirm onConfirm={() => delSession(se.id)} armAriaLabel={`Delete session ${se.date}`} confirmAriaLabel={`Confirm delete session ${se.date}`} className="text-rose-400" armLabel={<Trash2 className="w-3 h-3" />} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
