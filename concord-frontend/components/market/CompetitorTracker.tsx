'use client';

/**
 * CompetitorTracker — a market-research workbench: track competitors
 * by segment with market share, threat level, and SWOT notes, and view
 * a competitive-landscape dashboard. Wires the market.competitor-* and
 * market.market-dashboard macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Swords, Plus, Trash2, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Competitor { id: string; name: string; segment: string; marketSharePct: number | null; pricing: string | null; strengths: string; weaknesses: string; threatLevel: string }
interface Dash { competitors: number; highThreat: number; trackedSharePct: number; segments: Record<string, number> }

const THREATS = ['low', 'medium', 'high'];
const THREAT_COLOR: Record<string, string> = { low: 'text-emerald-400', medium: 'text-amber-400', high: 'text-rose-400' };

export function CompetitorTracker() {
  const [comps, setComps] = useState<Competitor[]>([]);
  const [dash, setDash] = useState<Dash | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', segment: '', marketSharePct: '', threatLevel: 'medium' });

  const refresh = useCallback(async () => {
    const [cl, d] = await Promise.all([
      lensRun('market', 'competitor-list', {}),
      lensRun('market', 'market-dashboard', {}),
    ]);
    setComps((cl.data?.result?.competitors as Competitor[]) || []);
    setDash((d.data?.result as Dash) || null);
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function addComp() {
    if (!form.name.trim()) return;
    await lensRun('market', 'competitor-add', {
      name: form.name.trim(), segment: form.segment.trim(),
      marketSharePct: form.marketSharePct ? Number(form.marketSharePct) : null, threatLevel: form.threatLevel,
    });
    setForm({ name: '', segment: '', marketSharePct: '', threatLevel: 'medium' });
    await refresh();
  }
  async function delComp(id: string) {
    await lensRun('market', 'competitor-delete', { id });
    if (active === id) setActive(null);
    await refresh();
  }
  async function saveSwot(id: string, strengths: string, weaknesses: string) {
    await lensRun('market', 'competitor-update', { id, strengths, weaknesses });
    await refresh();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Swords className="w-4 h-4 text-sky-400" />
        <h3 className="text-sm font-bold text-zinc-100">Competitor Tracker</h3>
      </div>

      {dash && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {([['Competitors', dash.competitors], ['High threat', dash.highThreat], ['Tracked share', `${dash.trackedSharePct}%`]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 mb-3 flex flex-wrap gap-1.5">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Competitor"
          className="flex-1 min-w-[120px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.segment} onChange={e => setForm({ ...form, segment: e.target.value })} placeholder="segment"
          className="w-24 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <input value={form.marketSharePct} onChange={e => setForm({ ...form, marketSharePct: e.target.value })} placeholder="share %"
          className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <select value={form.threatLevel} onChange={e => setForm({ ...form, threatLevel: e.target.value })}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1 text-xs text-zinc-200">
          {THREATS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={addComp} disabled={!form.name.trim()}
          className="px-2.5 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold disabled:opacity-40">Add</button>
      </div>

      <ul className="space-y-1">
        {comps.length === 0 && <li className="text-xs text-zinc-400 italic py-3 text-center">No competitors tracked.</li>}
        {comps.map(c => (
          <li key={c.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-3 py-2">
            <div className="group flex items-center gap-2">
              <button onClick={() => setActive(active === c.id ? null : c.id)} className="text-left min-w-0 flex-1">
                <p className="text-xs font-semibold text-zinc-100 truncate">{c.name}</p>
                <p className="text-[10px] text-zinc-400">{c.segment} · {c.marketSharePct != null ? `${c.marketSharePct}% share` : 'share n/a'} · <span className={THREAT_COLOR[c.threatLevel]}>{c.threatLevel} threat</span></p>
              </button>
              <button aria-label="Delete" onClick={() => delComp(c.id)} className="opacity-0 group-hover:opacity-100 text-rose-400"><Trash2 className="w-3 h-3" /></button>
            </div>
            {active === c.id && <SwotEditor comp={c} onSave={saveSwot} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SwotEditor({ comp, onSave }: { comp: Competitor; onSave: (id: string, s: string, w: string) => void }) {
  const [strengths, setStrengths] = useState(comp.strengths);
  const [weaknesses, setWeaknesses] = useState(comp.weaknesses);
  return (
    <div className="mt-2 pt-2 border-t border-zinc-800 space-y-1">
      <textarea value={strengths} onChange={e => setStrengths(e.target.value)} placeholder="strengths"
        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 resize-none" rows={2} />
      <textarea value={weaknesses} onChange={e => setWeaknesses(e.target.value)} placeholder="weaknesses"
        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200 resize-none" rows={2} />
      <button onClick={() => onSave(comp.id, strengths, weaknesses)}
        className="px-2 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 inline-flex items-center gap-1">
        <Plus className="w-3 h-3" />Save SWOT
      </button>
    </div>
  );
}
