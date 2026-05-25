'use client';

import { useEffect, useState } from 'react';
import { Zap, Plus, Loader2, Award } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface REC { id: string; mwh: number; tech: string; vintage: string; registry: string; certificateNumber: string; pricePerMwhUsd: number; status: 'purchased' | 'retired'; retiredAt: string | null; retirementReason?: string; purchasedAt: string }

export function RECsLedger() {
  const [recs, setRecs] = useState<REC[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ mwh: '', tech: 'solar', vintage: String(new Date().getFullYear()), registry: 'WREGIS', pricePerMwhUsd: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'environment', action: 'recs-list', input: {} });
      setRecs((r.data?.result?.recs || []) as REC[]);
    } catch (e) { console.error('[RECs] failed', e); }
    finally { setLoading(false); }
  }

  async function purchase() {
    if (!form.mwh) return;
    try {
      await lensRun({ domain: 'environment', action: 'recs-purchase', input: { ...form, mwh: Number(form.mwh), pricePerMwhUsd: Number(form.pricePerMwhUsd) || 0 } });
      setForm({ ...form, mwh: '', pricePerMwhUsd: '' });
      await refresh();
    } catch (e) { console.error('[RECs] purchase', e); }
  }

  async function retire(id: string) {
    const reason = prompt('Retirement reason (e.g. Scope 2 market-based)?') || 'voluntary';
    try {
      const r = await lensRun({ domain: 'environment', action: 'recs-retire', input: { id, reason } });
      if (r.data?.ok === false) alert(r.data?.error);
      await refresh();
    } catch (e) { console.error('[RECs] retire', e); }
  }

  const totalMwh = recs.reduce((s, r) => s + r.mwh, 0);
  const retiredMwh = recs.filter(r => r.status === 'retired').reduce((s, r) => s + r.mwh, 0);

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Zap className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Renewable Energy Certificates (RECs)</span>
        <span className="ml-auto text-[10px] text-gray-400">{retiredMwh.toFixed(0)} / {totalMwh.toFixed(0)} MWh retired</span>
      </header>
      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <input type="number" value={form.mwh} onChange={e => setForm({ ...form, mwh: e.target.value })} placeholder="MWh" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.tech} onChange={e => setForm({ ...form, tech: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option>solar</option><option>wind</option><option>hydro</option><option>biomass</option><option>geothermal</option>
        </select>
        <input value={form.vintage} onChange={e => setForm({ ...form, vintage: e.target.value })} placeholder="Vintage" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.registry} onChange={e => setForm({ ...form, registry: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option>WREGIS</option><option>M-RETS</option><option>PJM-GATS</option><option>NEPOOL-GIS</option><option>ERCOT</option><option>NAR</option>
        </select>
        <input type="number" step="0.01" value={form.pricePerMwhUsd} onChange={e => setForm({ ...form, pricePerMwhUsd: e.target.value })} placeholder="$/MWh" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={purchase} className="px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Purchase</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : recs.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Zap className="w-6 h-6 mx-auto mb-2 opacity-30" />No RECs yet. Buy and retire RECs to reduce market-based Scope 2 emissions.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {recs.map(r => (
              <li key={r.id} className={cn('px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3', r.status === 'retired' && 'opacity-70')}>
                <Award className={cn('w-3.5 h-3.5', r.status === 'retired' ? 'text-emerald-300' : 'text-amber-300')} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-amber-300">{r.certificateNumber}</div>
                  <div className="text-[10px] text-gray-400">{r.mwh.toFixed(0)} MWh · {r.tech} · {r.registry} · vintage {r.vintage}{r.retirementReason && ` · ${r.retirementReason}`}</div>
                </div>
                {r.pricePerMwhUsd > 0 && <span className="text-[10px] text-gray-400 font-mono">${(r.mwh * r.pricePerMwhUsd).toFixed(0)}</span>}
                {r.status === 'purchased' ? (
                  <button onClick={() => retire(r.id)} className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/30 text-emerald-300 hover:bg-emerald-500/50">Retire</button>
                ) : (
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">retired</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RECsLedger;
