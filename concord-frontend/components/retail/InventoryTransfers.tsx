'use client';

import { useEffect, useState } from 'react';
import { Truck, Loader2, ArrowRight, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Transfer {
  id: string; fromLocation: string; toLocation: string;
  lines: Array<{ sku: string; qty: number }>;
  status: 'in_transit' | 'received';
  expectedArrival: string | null; createdAt: string;
}

export function InventoryTransfers() {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ fromLocation: '', toLocation: '', sku: '', qty: '' });
  const [pendingLines, setPendingLines] = useState<Array<{ sku: string; qty: number }>>([]);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'retail', action: 'transfers-list', input: {} });
      setTransfers((res.data?.result?.transfers || []) as Transfer[]);
    } catch (e) { console.error('[Transfers] list failed', e); }
    finally { setLoading(false); }
  }

  function addLine() {
    if (!form.sku || !form.qty) return;
    setPendingLines([...pendingLines, { sku: form.sku.trim().toUpperCase(), qty: Number(form.qty) }]);
    setForm({ ...form, sku: '', qty: '' });
  }

  async function create() {
    if (!form.fromLocation.trim() || !form.toLocation.trim() || pendingLines.length === 0) return;
    try {
      await lensRun({
        domain: 'retail', action: 'transfers-create',
        input: { fromLocation: form.fromLocation, toLocation: form.toLocation, lines: pendingLines },
      });
      setForm({ fromLocation: '', toLocation: '', sku: '', qty: '' });
      setPendingLines([]);
      await refresh();
    } catch (e) { console.error('[Transfers] create failed', e); }
  }

  async function receive(id: string) {
    try {
      await lensRun({ domain: 'retail', action: 'transfers-receive', input: { id } });
      await refresh();
    } catch (e) { console.error('[Transfers] receive failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Truck className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Inventory transfers</span>
        <span className="ml-auto text-[10px] text-gray-400">{transfers.filter(t => t.status === 'in_transit').length} in transit</span>
      </header>

      <div className="p-3 border-b border-white/10 space-y-2">
        <div className="grid grid-cols-4 gap-2">
          <input value={form.fromLocation} onChange={e => setForm({ ...form, fromLocation: e.target.value })} placeholder="From (Warehouse A)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.toLocation} onChange={e => setForm({ ...form, toLocation: e.target.value })} placeholder="To (Store 1)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value.toUpperCase() })} placeholder="SKU" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
          <input type="number" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="Qty" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
          <button onClick={addLine} className="px-3 py-1.5 text-xs rounded bg-cyan-500/30 text-cyan-300 hover:bg-cyan-500/50">+ Line</button>
        </div>
        {pendingLines.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-2 py-1 rounded bg-white/[0.03]">
            {pendingLines.map((l, i) => (
              <span key={i} className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-cyan-500/15 text-cyan-300">{l.qty}× {l.sku}</span>
            ))}
            <button onClick={create} className="ml-auto px-2 py-0.5 text-[11px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400">Create transfer</button>
          </div>
        )}
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : transfers.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Truck className="w-6 h-6 mx-auto mb-2 opacity-30" />No inventory transfers.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {transfers.map(t => (
              <li key={t.id} className={cn('px-3 py-2 hover:bg-white/[0.03]', t.status === 'received' && 'opacity-60')}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-white font-mono">{t.fromLocation}</span>
                  <ArrowRight className="w-3 h-3 text-cyan-300" />
                  <span className="text-xs text-white font-mono">{t.toLocation}</span>
                  <span className={cn('text-[9px] uppercase px-1.5 py-0.5 rounded ml-auto', t.status === 'in_transit' ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300')}>{t.status.replace('_', ' ')}</span>
                  {t.status === 'in_transit' && (
                    <button onClick={() => receive(t.id)} className="px-2 py-1 text-[10px] rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1"><Check className="w-3 h-3" />Receive</button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {t.lines.map((l, i) => (
                    <span key={i} className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-white/5 text-gray-300">{l.qty}× {l.sku}</span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default InventoryTransfers;
