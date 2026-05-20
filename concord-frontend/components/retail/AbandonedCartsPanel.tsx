'use client';

import { useEffect, useState } from 'react';
import { ShoppingCart, AlertTriangle, Loader2, Send } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface AbCart {
  id: string; openedAt: string; ageHours: number;
  lineCount: number; itemCount: number; subtotal: number;
  lines: Array<{ sku: string; name: string; qty: number; unitPrice: number }>;
}

export function AbandonedCartsPanel() {
  const [carts, setCarts] = useState<AbCart[]>([]);
  const [totalLost, setTotalLost] = useState(0);
  const [thresholdHours, setThresholdHours] = useState('1');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({
        domain: 'retail', action: 'abandoned-carts-list',
        input: { thresholdHours: Number(thresholdHours) || 1 },
      });
      setCarts((res.data?.result?.carts || []) as AbCart[]);
      setTotalLost(res.data?.result?.totalLostValue || 0);
    } catch (e) { console.error('[Abandoned] list failed', e); }
    finally { setLoading(false); }
  }

  async function recover(cartId: string) {
    try {
      const res = await lensRun({
        domain: 'retail', action: 'abandoned-cart-recover',
        input: { cartId, discountCode: recoveryCode.trim().toUpperCase() || undefined },
      });
      const link = res.data?.result?.recovery?.shareableLink;
      if (link) {
        navigator.clipboard?.writeText(window.location.origin + link).catch(() => {});
        alert(`Recovery link copied:\n${link}`);
      }
    } catch (e) { console.error('[Abandoned] recover failed', e); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ShoppingCart className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Abandoned carts</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-rose-300"><AlertTriangle className="w-3 h-3" />${totalLost.toFixed(0)} lost value</span>
      </header>
      <div className="px-3 py-2 border-b border-white/10 grid grid-cols-4 gap-2 text-xs">
        <label className="space-y-1"><span className="text-gray-400">Threshold (hours)</span><input type="number" value={thresholdHours} onChange={e => setThresholdHours(e.target.value)} onBlur={refresh} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" /></label>
        <label className="col-span-2 space-y-1"><span className="text-gray-400">Recovery discount code (optional)</span><input value={recoveryCode} onChange={e => setRecoveryCode(e.target.value.toUpperCase())} placeholder="WIN10" className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white font-mono" /></label>
        <button onClick={refresh} className="self-end px-3 py-1 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400">Refresh</button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : carts.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><ShoppingCart className="w-6 h-6 mx-auto mb-2 opacity-30" />No abandoned carts.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {carts.map(c => (
              <li key={c.id} className="px-3 py-2 hover:bg-white/[0.03] group">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-mono">{c.id.slice(0, 16)}…</div>
                    <div className="text-[10px] text-gray-500">{c.ageHours}h ago · {c.itemCount} items</div>
                  </div>
                  <span className="font-mono text-sm text-amber-300 tabular-nums">${c.subtotal.toFixed(2)}</span>
                  <button onClick={() => recover(c.id)} className="px-2 py-1 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 inline-flex items-center gap-1"><Send className="w-3 h-3" />Recover</button>
                </div>
                <div className="mt-1 text-[10px] text-gray-500 truncate">{c.lines.map(l => `${l.qty}× ${l.name}`).join(' · ')}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default AbandonedCartsPanel;
