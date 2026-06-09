'use client';

/**
 * MineSiteManager — a mine-operations workbench: track managed sites
 * (commodity, kind, production), log safety incidents, and view an
 * operations dashboard. Wires the mining.site-*, mining.incident-log
 * and mining.mining-dashboard macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Mountain, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Incident { id: string; severity: string; description: string; date: string }
interface Site { id: string; name: string; kind: string; commodity: string; status: string; productionTonnes: number; incidents: Incident[]; incidentCount: number }
interface Dash { sites: number; active: number; totalProduction: number; incidents: number; seriousIncidents: number }

const KINDS = ['surface', 'underground', 'placer', 'quarry', 'other'];
const SEVERITIES = ['near_miss', 'minor', 'serious', 'fatal'];

export function MineSiteManager() {
  const [sites, setSites] = useState<Site[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', kind: 'surface', commodity: '', productionTonnes: '' });
  const [incForm, setIncForm] = useState({ severity: 'minor', description: '' });

  const refresh = useCallback(async () => {
    const [sl, d] = await Promise.all([
      lensRun('mining', 'site-list', {}),
      lensRun('mining', 'mining-dashboard', {}),
    ]);
    setSites((sl.data?.result?.sites as Site[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function addSite() {
    if (!form.name.trim()) return;
    await lensRun('mining', 'site-add', {
      name: form.name.trim(), kind: form.kind, commodity: form.commodity.trim(),
      productionTonnes: form.productionTonnes ? Number(form.productionTonnes) : 0,
    });
    setForm({ name: '', kind: 'surface', commodity: '', productionTonnes: '' });
    await refresh();
  }
  async function delSite(id: string) {
    await lensRun('mining', 'site-delete', { id });
    if (active === id) setActive(null);
    await refresh();
  }
  async function logIncident(siteId: string) {
    await lensRun('mining', 'incident-log', { siteId, severity: incForm.severity, description: incForm.description.trim() });
    setIncForm({ severity: 'minor', description: '' });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Mountain className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-bold text-zinc-100">Mine Operations</h3>
      </div>

      {dash && (
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([['Sites', dash.sites], ['Active', dash.active], ['Tonnes', dash.totalProduction], ['Serious', dash.seriousIncidents]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Site name"
          className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <input value={form.commodity} onChange={e => setForm({ ...form, commodity: e.target.value })} placeholder="commodity"
          className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.productionTonnes} onChange={e => setForm({ ...form, productionTonnes: e.target.value })} placeholder="tonnes"
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={addSite} disabled={!form.name.trim()}
          className="px-2.5 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40">Add site</button>
      </div>

      <ul className="space-y-1">
        {sites.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No sites yet.</li>}
        {sites.map(st => (
          <li key={st.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="group flex items-center gap-2">
              <button onClick={() => setActive(active === st.id ? null : st.id)} className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{st.name}</p>
                <p className="text-[10px] text-zinc-400">{st.kind} · {st.commodity} · {st.status} · {st.productionTonnes.toLocaleString()} t · {st.incidentCount} incidents</p>
              </button>
              <button aria-label="Delete" onClick={() => delSite(st.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </div>
            {active === st.id && (
              <div className="mt-2 pt-2 border-t border-zinc-800">
                {st.incidents.map(a => (
                  <p key={a.id} className="text-[11px] text-zinc-400"><span className="text-amber-400">{a.severity}</span> · {a.date}{a.description ? ` — ${a.description}` : ''}</p>
                ))}
                <div className="flex gap-1 mt-1">
                  <select value={incForm.severity} onChange={e => setIncForm({ ...incForm, severity: e.target.value })}
                    className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-[11px] text-zinc-200">
                    {SEVERITIES.map(k => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
                  </select>
                  <input value={incForm.description} onChange={e => setIncForm({ ...incForm, description: e.target.value })} placeholder="description"
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                  <button onClick={() => logIncident(st.id)} className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 inline-flex items-center gap-1">
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
