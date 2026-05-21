'use client';

import { useEffect, useState } from 'react';
import { Warehouse, Loader2, AlertTriangle, Search } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  quantity: number;
  reorderPoint: number;
  bin: string;
  category: string;
  weeklyVelocity: number;
  daysOfStock: number;
}

export function WarehouseInventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'low' | 'out'>('all');

  useEffect(() => { refresh(); }, []);
  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'logistics', action: 'inventory-list', input: {} });
      setItems((res.data?.result?.items || []) as InventoryItem[]);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }

  const filtered = items.filter(i => {
    if (filter === 'low' && i.quantity > i.reorderPoint) return false;
    if (filter === 'out' && i.quantity > 0) return false;
    if (query.trim()) {
      const q = query.toLowerCase();
      if (!i.name.toLowerCase().includes(q) && !i.sku.toLowerCase().includes(q) && !i.bin.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const lowCount = items.filter(i => i.quantity <= i.reorderPoint).length;
  const outCount = items.filter(i => i.quantity === 0).length;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Warehouse className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Warehouse inventory</span>
        <span className="ml-auto text-[10px] text-gray-500">{items.length} SKUs · {lowCount} low · {outCount} OOS</span>
      </header>
      <div className="p-2 border-b border-white/10 flex items-center gap-2 text-xs">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search SKU / name / bin" className="w-full pl-7 pr-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
        </div>
        {(['all', 'low', 'out'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} className={cn('px-2 py-0.5 text-[10px] uppercase tracking-wider rounded',
            filter === f ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-500 hover:text-white'
          )}>{f}</button>
        ))}
      </div>
      <div className="max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#0d1117]">
              <tr className="border-b border-white/10">
                <th className="px-3 py-2 text-left text-[10px] uppercase text-gray-500">SKU / Name</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase text-gray-500">Bin</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase text-gray-500">Qty</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase text-gray-500">Reorder</th>
                <th className="px-3 py-2 text-right text-[10px] uppercase text-gray-500">Days</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(i => (
                <tr key={i.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                  <td className="px-3 py-1.5">
                    <div className="text-white">{i.name}</div>
                    <div className="text-[9px] text-gray-500 font-mono">{i.sku} · {i.category}</div>
                  </td>
                  <td className="px-3 py-1.5 text-gray-400 font-mono">{i.bin}</td>
                  <td className="px-3 py-1.5 text-right">
                    <span className={cn('font-mono tabular-nums', i.quantity === 0 ? 'text-red-300 font-bold' : i.quantity <= i.reorderPoint ? 'text-yellow-300' : 'text-white')}>{i.quantity}</span>
                    {i.quantity <= i.reorderPoint && i.quantity > 0 && <AlertTriangle className="w-3 h-3 text-yellow-400 inline ml-1" />}
                  </td>
                  <td className="px-3 py-1.5 text-right text-gray-500 font-mono tabular-nums">{i.reorderPoint}</td>
                  <td className="px-3 py-1.5 text-right text-[10px] text-gray-400 tabular-nums">{Math.round(i.daysOfStock)}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
export default WarehouseInventory;
