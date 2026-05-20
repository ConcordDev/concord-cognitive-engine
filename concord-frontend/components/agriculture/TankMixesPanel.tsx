'use client';

import { useEffect, useState } from 'react';
import { Beaker, Plus, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Mix { id: string; name: string; components: Array<{ product: string; ratePerAcre: number; costPerAcre: number }>; carrierGalPerAcre: number; totalCostPerAcre: number; compatible: boolean }

export function TankMixesPanel() {
  const [mixes, setMixes] = useState<Mix[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [carrier, setCarrier] = useState('15');
  const [components, setComponents] = useState<Array<{ product: string; ratePerAcre: number; costPerAcre: number }>>([{ product: '', ratePerAcre: 0, costPerAcre: 0 }]);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'agriculture', action: 'tank-mixes-list', input: {} });
      setMixes((res.data?.result?.mixes || []) as Mix[]);
    } catch (e) { console.error('[Mixes] failed', e); }
    finally { setLoading(false); }
  }

  async function create() {
    const valid = components.filter(c => c.product.trim());
    if (!name.trim() || valid.length === 0) return;
    try {
      await lensRun({
        domain: 'agriculture', action: 'tank-mix-create',
        input: { name, components: valid, carrierGalPerAcre: Number(carrier) || 10 },
      });
      setName(''); setCarrier('15');
      setComponents([{ product: '', ratePerAcre: 0, costPerAcre: 0 }]);
      await refresh();
    } catch (e) { console.error('[Mixes] create', e); }
  }

  function setComp(i: number, key: string, val: string | number) {
    setComponents(prev => prev.map((c, idx) => idx === i ? { ...c, [key]: val } : c));
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Beaker className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Tank mix builder</span>
        <span className="ml-auto text-[10px] text-gray-500">{mixes.length}</span>
      </header>
      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="grid grid-cols-4 gap-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Mix name" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input type="number" value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="Carrier gal/ac" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={create} className="px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Create mix</button>
        </div>
        {components.map((c, i) => (
          <div key={i} className="grid grid-cols-5 gap-2">
            <input value={c.product} onChange={e => setComp(i, 'product', e.target.value)} placeholder="Product" className="col-span-2 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={c.ratePerAcre || ''} onChange={e => setComp(i, 'ratePerAcre', Number(e.target.value))} placeholder="Rate/ac" className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <input type="number" value={c.costPerAcre || ''} onChange={e => setComp(i, 'costPerAcre', Number(e.target.value))} placeholder="Cost/ac" className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
            <button onClick={() => setComponents(prev => prev.filter((_, idx) => idx !== i))} className="text-rose-400 hover:text-rose-300 text-xs">×</button>
          </div>
        ))}
        <button onClick={() => setComponents(prev => [...prev, { product: '', ratePerAcre: 0, costPerAcre: 0 }])} className="text-[11px] text-violet-300 hover:text-violet-200">+ Add component</button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : mixes.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><Beaker className="w-6 h-6 mx-auto mb-2 opacity-30" />No tank mixes yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {mixes.map(m => (
              <li key={m.id} className="px-3 py-2 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <Beaker className="w-3.5 h-3.5 text-violet-300" />
                  <span className="text-sm text-white">{m.name}</span>
                  {m.compatible ? <CheckCircle className="w-3 h-3 text-emerald-300" /> : <AlertTriangle className="w-3 h-3 text-amber-300" />}
                  <span className="ml-auto font-mono text-xs text-violet-300">${m.totalCostPerAcre.toFixed(2)}/ac</span>
                </div>
                <div className="text-[10px] text-gray-500 ml-5">{m.carrierGalPerAcre}gal carrier · {m.components.map(c => c.product).join(' + ')}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TankMixesPanel;
