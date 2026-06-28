'use client';

/**
 * StandManager — a forest stand-management workbench: track managed
 * stands (species, acreage, density), log silviculture activities, and
 * pull a live wildfire feed. Wires the forestry.stand-*,
 * forestry.activity-log, forestry.forestry-dashboard + forestry.feed macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Trees, Plus, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { LensFeedButton } from '@/components/lens/LensFeedButton';

interface Activity { id: string; kind: string; date: string; notes: string }
interface Stand { id: string; name: string; species: string; acres: number; ageYears: number; treesPerAcre: number; estimatedTrees: number; activities: Activity[]; activityCount: number }
interface Dash { stands: number; totalAcres: number; activities: number; bySpecies: Record<string, number> }

const SPECIES = ['douglas_fir', 'ponderosa_pine', 'loblolly_pine', 'oak', 'maple', 'spruce', 'mixed', 'other'];
const ACTIVITIES = ['planting', 'thinning', 'harvest', 'prescribed_burn', 'survey', 'treatment'];

export function StandManager() {
  const [stands, setStands] = useState<Stand[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', species: 'mixed', acres: '', treesPerAcre: '' });
  const [actForm, setActForm] = useState({ kind: 'survey', notes: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [sl, d] = await Promise.all([
        lensRun('forestry', 'stand-list', {}),
        lensRun('forestry', 'forestry-dashboard', {}),
      ]);
      // Distinguish a backend failure ({ ok:false } OR a thrown/empty response)
      // from a genuinely-empty stand list — the swallowed-fetch silent-empty bug.
      if (sl.data?.ok === false || !sl.data) {
        setLoadError(sl.data?.error || 'Could not reach the forestry service.');
        return;
      }
      setStands((sl.data?.result?.stands as Stand[]) || []);
      setDash((d.data?.ok ? (d.data.result as Dash) : null) || null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not reach the forestry service.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function addStand() {
    if (!form.name.trim()) return;
    await lensRun('forestry', 'stand-add', {
      name: form.name.trim(), species: form.species,
      acres: form.acres ? Number(form.acres) : 0, treesPerAcre: form.treesPerAcre ? Number(form.treesPerAcre) : 0,
    });
    setForm({ name: '', species: 'mixed', acres: '', treesPerAcre: '' });
    await refresh();
  }
  async function delStand(id: string) {
    await lensRun('forestry', 'stand-delete', { id });
    if (active === id) setActive(null);
    await refresh();
  }
  async function logActivity(standId: string) {
    await lensRun('forestry', 'activity-log', { standId, kind: actForm.kind, notes: actForm.notes.trim() });
    setActForm({ kind: 'survey', notes: '' });
    await refresh();
  }

  if (loading) return (
    <div role="status" aria-busy="true" className="flex items-center justify-center gap-2 py-6 text-zinc-400">
      <Loader2 className="w-4 h-4 animate-spin" /> <span className="text-xs">Loading stands…</span>
    </div>
  );

  if (loadError) return (
    <div role="alert" className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 text-center">
      <AlertTriangle className="w-5 h-5 mx-auto mb-2 text-rose-400" />
      <p className="text-xs text-rose-300 mb-3">Could not reach the forestry service. {loadError}</p>
      <button onClick={() => void refresh()}
        className="px-3 py-1.5 text-xs rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold">
        Try again
      </button>
    </div>
  );

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Trees className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-bold text-zinc-100">Stand Manager</h3>
      </div>

      {dash && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {([['Stands', dash.stands], ['Acres', dash.totalAcres], ['Activities', dash.activities]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-3"><LensFeedButton domain="forestry" label="Live wildfire feed (InciWeb)" /></div>

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Stand name"
          className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={form.species} onChange={e => setForm({ ...form, species: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
          {SPECIES.map(sp => <option key={sp} value={sp}>{sp.replace(/_/g, ' ')}</option>)}
        </select>
        <input value={form.acres} onChange={e => setForm({ ...form, acres: e.target.value })} placeholder="acres"
          className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.treesPerAcre} onChange={e => setForm({ ...form, treesPerAcre: e.target.value })} placeholder="trees/ac"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={addStand} disabled={!form.name.trim()}
          className="px-2.5 py-1 text-xs rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-40">Add stand</button>
      </div>

      <ul className="space-y-1">
        {stands.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No stands yet.</li>}
        {stands.map(st => (
          <li key={st.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="group flex items-center gap-2">
              <button onClick={() => setActive(active === st.id ? null : st.id)} className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{st.name}</p>
                <p className="text-[10px] text-zinc-400">{st.species.replace(/_/g, ' ')} · {st.acres} ac · ~{st.estimatedTrees.toLocaleString()} trees · {st.activityCount} activities</p>
              </button>
              <button aria-label="Delete" onClick={() => delStand(st.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </div>
            {active === st.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800">
                {st.activities.map(a => (
                  <p key={a.id} className="text-[11px] text-zinc-400"><span className="text-emerald-400">{a.kind}</span> · {a.date}{a.notes ? ` — ${a.notes}` : ''}</p>
                ))}
                <div className="flex gap-1 mt-1">
                  <select value={actForm.kind} onChange={e => setActForm({ ...actForm, kind: e.target.value })}
                    className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-200">
                    {ACTIVITIES.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
                  </select>
                  <input value={actForm.notes} onChange={e => setActForm({ ...actForm, notes: e.target.value })} placeholder="notes"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                  <button onClick={() => logActivity(st.id)} className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 inline-flex items-center gap-1">
                    <Plus className="w-3 h-3" />Log
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
