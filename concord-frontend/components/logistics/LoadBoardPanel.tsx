'use client';

import { useEffect, useState } from 'react';
import { Layers, Plus, Loader2, ArrowRight, Gavel } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Load { id: string; origin: string; destination: string; ratePerMile: number; weightLbs: number; equipment: string; pickupDate: string | null; commodity: string; status: 'available' | 'booked'; bids: Array<{ carrierId: string; amount: number; bidAt: string }>; bookedAmount?: number }

export function LoadBoardPanel() {
  const [loads, setLoads] = useState<Load[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ origin: '', destination: '', ratePerMile: '', weightLbs: '', equipment: 'dry_van', pickupDate: '' });
  const [bidFor, setBidFor] = useState<string | null>(null);
  const [bidAmt, setBidAmt] = useState('');
  const [bidCarrier, setBidCarrier] = useState('');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'logistics', action: 'loads-list', input: {} });
      setLoads((res.data?.result?.loads || []) as Load[]);
    } catch (e) { console.error('[Loads] failed', e); }
    finally { setLoading(false); }
  }

  async function post() {
    if (!form.origin.trim() || !form.destination.trim() || !form.ratePerMile) return;
    try {
      await lensRun({
        domain: 'logistics', action: 'loads-post',
        input: { ...form, ratePerMile: Number(form.ratePerMile), weightLbs: Number(form.weightLbs) || 0 },
      });
      setForm({ origin: '', destination: '', ratePerMile: '', weightLbs: '', equipment: 'dry_van', pickupDate: '' });
      await refresh();
    } catch (e) { console.error('[Loads] post', e); }
  }

  async function bid(loadId: string) {
    if (!bidAmt || !bidCarrier.trim()) return;
    try {
      await lensRun({ domain: 'logistics', action: 'loads-bid', input: { id: loadId, carrierId: bidCarrier, amount: Number(bidAmt) } });
      setBidFor(null); setBidAmt(''); setBidCarrier('');
      await refresh();
    } catch (e) { console.error('[Loads] bid', e); }
  }

  async function accept(loadId: string, carrierId: string) {
    try {
      await lensRun({ domain: 'logistics', action: 'loads-accept-bid', input: { id: loadId, carrierId } });
      await refresh();
    } catch (e) { console.error('[Loads] accept', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-violet-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Layers className="w-4 h-4 text-violet-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Load board</span>
        <span className="ml-auto text-[10px] text-gray-400">{loads.filter(l => l.status === 'available').length} available · {loads.filter(l => l.status === 'booked').length} booked</span>
      </header>

      <div className="p-3 border-b border-white/10 grid grid-cols-6 gap-2">
        <input value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} placeholder="Origin" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} placeholder="Destination" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" step="0.01" value={form.ratePerMile} onChange={e => setForm({ ...form, ratePerMile: e.target.value })} placeholder="$/mile" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.weightLbs} onChange={e => setForm({ ...form, weightLbs: e.target.value })} placeholder="Weight" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.equipment} onChange={e => setForm({ ...form, equipment: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="dry_van">Dry van</option><option value="reefer">Reefer</option><option value="flatbed">Flatbed</option><option value="step_deck">Step deck</option><option value="tanker">Tanker</option>
        </select>
        <input type="date" value={form.pickupDate} onChange={e => setForm({ ...form, pickupDate: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={post} className="col-span-4 px-3 py-1.5 text-xs rounded bg-violet-500 text-white font-bold hover:bg-violet-400 inline-flex items-center justify-center gap-1"><Plus className="w-3 h-3" />Post load</button>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : loads.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Layers className="w-6 h-6 mx-auto mb-2 opacity-30" />No loads posted yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {loads.map(l => (
              <li key={l.id} className={cn('px-3 py-2 hover:bg-white/[0.03]', l.status === 'booked' && 'bg-emerald-500/5')}>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white truncate flex-1">{l.origin}</span>
                  <ArrowRight className="w-3 h-3 text-gray-400" />
                  <span className="text-xs text-white truncate flex-1">{l.destination}</span>
                  <span className="font-mono text-sm tabular-nums text-violet-300">${l.ratePerMile.toFixed(2)}/mi</span>
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded', l.status === 'available' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300')}>{l.status}</span>
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">{l.equipment.replace('_', ' ')} · {l.weightLbs}lbs {l.pickupDate ? `· pickup ${l.pickupDate}` : ''}</div>
                {l.status === 'available' && (
                  <div className="mt-1">
                    {bidFor === l.id ? (
                      <div className="flex items-center gap-1.5">
                        <input value={bidCarrier} onChange={e => setBidCarrier(e.target.value)} placeholder="Carrier ID" className="flex-1 px-2 py-0.5 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
                        <input type="number" value={bidAmt} onChange={e => setBidAmt(e.target.value)} placeholder="Bid $" className="w-24 px-2 py-0.5 text-[11px] bg-lattice-deep border border-lattice-border rounded text-white" />
                        <button onClick={() => bid(l.id)} className="px-2 py-0.5 text-[11px] rounded bg-violet-500 text-white font-bold hover:bg-violet-400">Bid</button>
                        <button onClick={() => setBidFor(null)} className="px-2 py-0.5 text-[11px] text-gray-400">×</button>
                      </div>
                    ) : (
                      <button onClick={() => setBidFor(l.id)} className="text-[11px] text-violet-300 hover:text-violet-200 inline-flex items-center gap-0.5"><Gavel className="w-2.5 h-2.5" />Bid ({l.bids.length} so far)</button>
                    )}
                  </div>
                )}
                {l.bids.length > 0 && l.status === 'available' && (
                  <ul className="mt-1 ml-3 space-y-0.5">
                    {l.bids.sort((a, b) => a.amount - b.amount).map((b, i) => (
                      <li key={i} className="flex items-center gap-2 text-[10px]">
                        <span className="text-gray-400 font-mono">{b.carrierId}</span>
                        <span className="font-mono text-emerald-300">${b.amount}</span>
                        <button onClick={() => accept(l.id, b.carrierId)} className="ml-auto px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 text-[9px] uppercase">Accept</button>
                      </li>
                    ))}
                  </ul>
                )}
                {l.status === 'booked' && l.bookedAmount && <div className="text-[10px] text-emerald-300 ml-1">Booked at ${l.bookedAmount}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default LoadBoardPanel;
