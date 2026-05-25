'use client';

/**
 * CruisePanel — inventory cruise plotting. Forester tallies sample
 * plots (prism BAF or fixed-radius), and gets a per-acre statistical
 * summary (trees/ac, basal area/ac, board feet/ac with 95% CI).
 * Wires forestry.cruise-plot-add / cruise-plot-list / cruise-summary.
 */

import { useCallback, useEffect, useState } from 'react';
import { Ruler, Loader2, Trash2, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface TalliedTree { species: string; dbhInches: number; heightFeet: number; basalArea: number; boardFeet: number }
interface Plot {
  id: string;
  standId: string;
  method: string;
  expansionFactor: number;
  trees: TalliedTree[];
  treeCount: number;
}
interface StatBlock { mean: number; stdDev: number; stdError: number; ciPercent: number }
interface Summary {
  plots: number;
  message?: string;
  treesPerAcre?: StatBlock;
  basalAreaPerAcre?: StatBlock;
  boardFeetPerAcre?: StatBlock;
}

export function CruisePanel() {
  const [standId, setStandId] = useState('');
  const [method, setMethod] = useState<'prism_baf' | 'fixed_radius'>('prism_baf');
  const [ef, setEf] = useState('10');
  const [treeText, setTreeText] = useState('');
  const [plots, setPlots] = useState<Plot[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!standId.trim()) { setPlots([]); setSummary(null); return; }
    const lr = await lensRun<{ plots: Plot[] }>('forestry', 'cruise-plot-list', { standId: standId.trim() });
    if (lr.data?.ok && lr.data.result) setPlots(lr.data.result.plots);
    const sr = await lensRun<Summary>('forestry', 'cruise-summary', { standId: standId.trim() });
    if (sr.data?.ok && sr.data.result) setSummary(sr.data.result);
  }, [standId]);

  useEffect(() => { void load(); }, [load]);

  const addPlot = useCallback(async () => {
    if (!standId.trim()) { setErr('Stand id required.'); return; }
    const trees: { species: string; dbhInches: number; heightFeet: number }[] = [];
    for (const line of treeText.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const parts = t.split(/[,]+/).map((p) => p.trim());
      const dbh = Number(parts[1]);
      const ht = Number(parts[2]);
      if (parts[0] && Number.isFinite(dbh) && Number.isFinite(ht)) {
        trees.push({ species: parts[0], dbhInches: dbh, heightFeet: ht });
      }
    }
    if (trees.length === 0) { setErr('Enter at least one "species, dbh, height" tree.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('forestry', 'cruise-plot-add', {
      standId: standId.trim(), method, expansionFactor: Number(ef) || 10, trees,
    });
    if (r.data?.ok) { setTreeText(''); await load(); }
    else setErr(r.data?.error || 'Plot add failed.');
    setBusy(false);
  }, [standId, method, ef, treeText, load]);

  const del = useCallback(async (id: string) => {
    const r = await lensRun('forestry', 'cruise-plot-delete', { id });
    if (r.data?.ok) await load();
  }, [load]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Ruler className="w-4 h-4 text-amber-400" />
        <h3 className="text-sm font-bold text-zinc-100">Inventory Cruise</h3>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2">
        <input value={standId} onChange={(e) => setStandId(e.target.value)} placeholder="Stand id"
          className="w-32 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
        <select value={method} onChange={(e) => setMethod(e.target.value as 'prism_baf' | 'fixed_radius')}
          className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-1.5 text-xs text-zinc-200">
          <option value="prism_baf">Prism (BAF)</option>
          <option value="fixed_radius">Fixed radius (ft)</option>
        </select>
        <input value={ef} onChange={(e) => setEf(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder={method === 'prism_baf' ? 'BAF' : 'radius ft'}
          className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
      </div>
      <textarea value={treeText} onChange={(e) => setTreeText(e.target.value)} rows={3}
        placeholder={'Tallied trees, one per line — species, dbh in, height ft:\noak, 14, 70\noak, 16, 75'}
        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs font-mono text-zinc-200 mb-2" />
      <button onClick={addPlot} disabled={busy}
        className="px-3 py-1.5 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white font-semibold disabled:opacity-40 inline-flex items-center gap-1.5">
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add plot
      </button>
      {err && <p className="text-xs text-rose-400 mt-2">{err}</p>}

      {summary && summary.plots > 0 && summary.treesPerAcre && summary.basalAreaPerAcre && summary.boardFeetPerAcre && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {([
            ['Trees / ac', summary.treesPerAcre],
            ['Basal area / ac', summary.basalAreaPerAcre],
            ['Board feet / ac', summary.boardFeetPerAcre],
          ] as const).map(([label, st]) => (
            <div key={label} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-amber-300">{st.mean.toLocaleString()}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{label}</p>
              <p className="text-[9px] text-zinc-400">±{st.ciPercent}% CI</p>
            </div>
          ))}
        </div>
      )}
      {summary && summary.plots > 0 && (
        <p className="mt-2 text-[10px] text-zinc-400">
          Statistical summary over {summary.plots} sample plot{summary.plots === 1 ? '' : 's'}.
        </p>
      )}

      <div className="mt-3 space-y-1.5">
        {plots.map((p) => (
          <div key={p.id} className="flex items-center gap-2 bg-zinc-900/60 border border-zinc-800 rounded-lg px-2.5 py-1.5">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-zinc-100">
                {p.method === 'prism_baf' ? 'Prism' : 'Fixed-radius'} plot · {p.treeCount} tree{p.treeCount === 1 ? '' : 's'}
              </p>
              <p className="text-[10px] text-zinc-400">expansion factor {p.expansionFactor}</p>
            </div>
            <button onClick={() => del(p.id)} aria-label="Delete plot"
              className="p-1 text-zinc-400 hover:text-rose-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {plots.length === 0 && standId.trim() && <p className="text-xs text-zinc-400 italic">No cruise plots for this stand yet.</p>}
        {!standId.trim() && <p className="text-xs text-zinc-400 italic">Enter a stand id to view its cruise plots.</p>}
      </div>
    </div>
  );
}
