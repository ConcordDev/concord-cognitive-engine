'use client';

/** Low stock — retail.low-stock at a merchant-chosen reorder point. */

import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { retail, money, type Product } from './retailApi';

export function LowStockView({ onEditCatalog }: { onEditCatalog: () => void }) {
  const [threshold, setThreshold] = useState(5);
  const [items, setItems] = useState<(Product & { atThreshold?: boolean })[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (t: number) => {
    setItems(null);
    const r = await retail<{ lowStock: (Product & { atThreshold?: boolean })[] }>('low-stock', { threshold: t });
    if (r.ok && r.result) { setItems(r.result.lowStock); setErr(null); } else { setItems([]); setErr(r.error || 'Could not read stock.'); }
  }, []);
  useEffect(() => { load(threshold); }, [load, threshold]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-[color:var(--stall-chalk-dim)]">
          Reorder point
          <input type="number" min={1} max={999} value={threshold} onChange={(e) => setThreshold(Math.max(1, Math.min(999, Math.floor(Number(e.target.value) || 1))))}
            className="h-8 w-20 rounded-md border border-[color:var(--stall-line)] bg-transparent px-2 font-mono text-[13px] text-[color:var(--stall-chalk)] focus:border-[color:var(--stall-brass)] focus:outline-none" />
        </label>
        <span className="text-[12px] text-[color:var(--stall-chalk-faint)]">{items ? `${items.length} product${items.length === 1 ? '' : 's'} at or below` : ''}</span>
        <button type="button" onClick={onEditCatalog} className="ml-auto h-8 rounded-md px-3 text-[12px] text-[color:var(--stall-chalk-dim)] hover:bg-white/5">Edit stock in Catalog →</button>
      </div>
      {err && <div role="alert" className="mt-4 rounded-md bg-[color:var(--stall-tomato-dim)] px-3 py-2 text-[12px] text-[color:var(--stall-tomato)]">{err}</div>}
      <div className="mt-4" aria-busy={items === null}>
        {items === null ? (
          <div className="space-y-1">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 animate-pulse rounded bg-white/[0.03]" />)}</div>
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-[color:var(--stall-chalk-faint)]">Everything is stocked above {threshold}.</p>
        ) : (
          <table className="w-full max-w-3xl text-[13px] tabular-nums">
            <thead className="text-left text-[11px] text-[color:var(--stall-chalk-faint)]"><tr><th className="py-1.5 font-normal">Product</th><th className="py-1.5 font-normal">SKU</th><th className="py-1.5 text-right font-normal">Price</th><th className="py-1.5 text-right font-normal">On hand</th></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.sku} className="border-t border-[color:var(--stall-line)]">
                  <td className="py-2 text-[color:var(--stall-chalk)]">{p.name}</td>
                  <td className="py-2 font-mono text-[12px] text-[color:var(--stall-chalk-faint)]">{p.sku}</td>
                  <td className="py-2 text-right font-mono text-[color:var(--stall-chalk-dim)]">{money(p.price)}</td>
                  <td className={cn('py-2 text-right font-mono', p.stock <= 0 ? 'text-[color:var(--stall-tomato)]' : p.atThreshold ? 'text-[color:var(--stall-chalk-dim)]' : 'text-[color:var(--stall-brass)]')}>{p.stock <= 0 ? 'out' : p.stock}{p.atThreshold ? ' · at point' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default LowStockView;
