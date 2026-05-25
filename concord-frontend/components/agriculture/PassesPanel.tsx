'use client';

import { useEffect, useState } from 'react';
import { Sprout, Wheat, Plus, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PlantingPass { id: string; fieldId: string; crop: string; variety: string; seedingRate: number; depthInches: number; acresPlanted: number; plantedAt: string }
interface HarvestPass { id: string; fieldId: string; crop: string; acresHarvested: number; yieldBushels: number; yieldPerAcre: number; moisturePct: number | null; ticketNumber: string; harvestedAt: string }

export function PassesPanel() {
  const [tab, setTab] = useState<'planting' | 'harvest'>('planting');
  const [planting, setPlanting] = useState<PlantingPass[]>([]);
  const [harvest, setHarvest] = useState<HarvestPass[]>([]);
  const [loading, setLoading] = useState(true);
  const [pForm, setPForm] = useState({ fieldId: '', crop: '', variety: '', seedingRate: '', depthInches: '2', acresPlanted: '' });
  const [hForm, setHForm] = useState({ fieldId: '', crop: '', acresHarvested: '', yieldBushels: '', moisturePct: '' });

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [p, h] = await Promise.all([
        lensRun({ domain: 'agriculture', action: 'planting-passes', input: {} }),
        lensRun({ domain: 'agriculture', action: 'harvest-passes', input: {} }),
      ]);
      setPlanting((p.data?.result?.passes || []) as PlantingPass[]);
      setHarvest((h.data?.result?.passes || []) as HarvestPass[]);
    } catch (e) { console.error('[Passes] failed', e); }
    finally { setLoading(false); }
  }

  async function logPlanting() {
    if (!pForm.fieldId.trim() || !pForm.crop.trim()) return;
    try {
      await lensRun({
        domain: 'agriculture', action: 'planting-log',
        input: { ...pForm, seedingRate: Number(pForm.seedingRate), depthInches: Number(pForm.depthInches), acresPlanted: Number(pForm.acresPlanted) },
      });
      setPForm({ fieldId: '', crop: '', variety: '', seedingRate: '', depthInches: '2', acresPlanted: '' });
      await refresh();
    } catch (e) { console.error('[Passes] planting', e); }
  }

  async function logHarvest() {
    if (!hForm.fieldId.trim() || !hForm.crop.trim() || !hForm.acresHarvested) return;
    try {
      await lensRun({
        domain: 'agriculture', action: 'harvest-log',
        input: { ...hForm, acresHarvested: Number(hForm.acresHarvested), yieldBushels: Number(hForm.yieldBushels), moisturePct: Number(hForm.moisturePct) || undefined },
      });
      setHForm({ fieldId: '', crop: '', acresHarvested: '', yieldBushels: '', moisturePct: '' });
      await refresh();
    } catch (e) { console.error('[Passes] harvest', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Sprout className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Field operations · passes</span>
      </header>
      <div className="flex border-b border-white/10 text-[11px]">
        {(['planting', 'harvest'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={cn('px-4 py-1.5 transition inline-flex items-center gap-1.5', tab === t ? 'text-emerald-300 border-b-2 border-emerald-400' : 'text-gray-400 hover:text-gray-300')}>
            {t === 'planting' ? <Sprout className="w-3 h-3" /> : <Wheat className="w-3 h-3" />}
            {t === 'planting' ? 'Planting' : 'Harvest'}
            <span className="text-[10px] text-gray-400">({t === 'planting' ? planting.length : harvest.length})</span>
          </button>
        ))}
      </div>

      {tab === 'planting' ? (
        <>
          <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
            <input value={pForm.fieldId} onChange={e => setPForm({ ...pForm, fieldId: e.target.value })} placeholder="Field ID" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <input value={pForm.crop} onChange={e => setPForm({ ...pForm, crop: e.target.value })} placeholder="Crop" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input value={pForm.variety} onChange={e => setPForm({ ...pForm, variety: e.target.value })} placeholder="Variety" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={pForm.seedingRate} onChange={e => setPForm({ ...pForm, seedingRate: e.target.value })} placeholder="Seeds/ac" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" step="0.1" value={pForm.depthInches} onChange={e => setPForm({ ...pForm, depthInches: e.target.value })} placeholder="Depth in" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={pForm.acresPlanted} onChange={e => setPForm({ ...pForm, acresPlanted: e.target.value })} placeholder="Acres" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <button onClick={logPlanting} className="col-span-6 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Log planting pass</button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
            ) : planting.length === 0 ? (
              <div className="px-3 py-10 text-center text-xs text-gray-400"><Sprout className="w-6 h-6 mx-auto mb-2 opacity-30" />No planting passes yet.</div>
            ) : (
              <ul className="divide-y divide-white/5">
                {planting.map(p => (
                  <li key={p.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                    <Sprout className="w-3.5 h-3.5 text-emerald-300" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white">{p.crop} <span className="text-gray-400">{p.variety}</span></div>
                      <div className="text-[10px] text-gray-400">Field {p.fieldId.slice(0, 10)} · {p.seedingRate.toLocaleString()} seeds/ac · {p.depthInches}" deep · {p.acresPlanted}ac</div>
                    </div>
                    <span className="text-[10px] text-gray-400">{new Date(p.plantedAt).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
            <input value={hForm.fieldId} onChange={e => setHForm({ ...hForm, fieldId: e.target.value })} placeholder="Field ID" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
            <input value={hForm.crop} onChange={e => setHForm({ ...hForm, crop: e.target.value })} placeholder="Crop" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={hForm.acresHarvested} onChange={e => setHForm({ ...hForm, acresHarvested: e.target.value })} placeholder="Acres" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={hForm.yieldBushels} onChange={e => setHForm({ ...hForm, yieldBushels: e.target.value })} placeholder="Bushels" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" step="0.1" value={hForm.moisturePct} onChange={e => setHForm({ ...hForm, moisturePct: e.target.value })} placeholder="Moisture %" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <button onClick={logHarvest} className="col-span-5 px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Log harvest pass</button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
            ) : harvest.length === 0 ? (
              <div className="px-3 py-10 text-center text-xs text-gray-400"><Wheat className="w-6 h-6 mx-auto mb-2 opacity-30" />No harvest passes yet.</div>
            ) : (
              <ul className="divide-y divide-white/5">
                {harvest.map(h => (
                  <li key={h.id} className="px-3 py-2 hover:bg-white/[0.03] flex items-center gap-3">
                    <Wheat className="w-3.5 h-3.5 text-amber-300" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white">{h.crop} <span className="text-[10px] text-amber-300 font-mono">{h.ticketNumber}</span></div>
                      <div className="text-[10px] text-gray-400">Field {h.fieldId.slice(0, 10)} · {h.acresHarvested}ac · {h.yieldBushels.toLocaleString()}bu @ {h.moisturePct ?? '—'}% moisture</div>
                    </div>
                    <span className="font-mono text-sm tabular-nums text-amber-300">{h.yieldPerAcre} bu/ac</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default PassesPanel;
