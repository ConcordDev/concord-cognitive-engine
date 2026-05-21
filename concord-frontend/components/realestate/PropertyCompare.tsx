'use client';

import { useEffect, useState } from 'react';
import { Columns3, Loader2, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Listing {
  id: string; address: string; price: number;
}
interface Row { field: string; values: (number | string | null)[] }

export function PropertyCompare({ ids, onClear, onRemove }: { ids: string[]; onClear?: () => void; onRemove?: (id: string) => void }) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idsKey = ids.join('|');
  useEffect(() => {
    if (ids.length < 2) { setListings([]); setRows([]); setError(null); return; }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey]);

  async function refresh() {
    setLoading(true); setError(null);
    try {
      const res = await lensRun({ domain: 'realestate', action: 'compare', input: { ids } });
      if (res.data?.ok === false) {
        setError((res.data?.error as string) || 'compare failed');
        setListings([]); setRows([]);
      } else {
        setListings((res.data?.result?.listings || []) as Listing[]);
        setRows((res.data?.result?.rows || []) as Row[]);
      }
    } catch (e) { console.error('[Compare] failed', e); setError(e instanceof Error ? e.message : 'failed'); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Columns3 className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Side-by-side compare</span>
        <span className="ml-auto text-[10px] text-gray-500">{ids.length} picked</span>
        {ids.length > 0 && <button onClick={onClear} className="text-[10px] text-gray-400 hover:text-rose-300">Clear</button>}
      </header>
      <div className="p-3">
        {ids.length < 2 ? (
          <div className="px-3 py-8 text-center text-xs text-gray-500"><Columns3 className="w-6 h-6 mx-auto mb-2 opacity-30" />Pick at least 2 listings from the browser to compare.</div>
        ) : loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : error ? (
          <div className="px-3 py-4 text-center text-xs text-rose-300">{error}</div>
        ) : (
          <table className="w-full text-xs">
            <thead className="border-b border-white/10">
              <tr>
                <th className="text-left text-[10px] uppercase tracking-wider text-gray-500 px-2 py-2">Field</th>
                {listings.map(l => (
                  <th key={l.id} className="text-left text-[10px] px-2 py-2 min-w-[140px]">
                    <div className="text-white truncate">{l.address}</div>
                    <button onClick={() => onRemove?.(l.id)} className="text-rose-400 hover:text-rose-300 mt-0.5 inline-flex items-center gap-1 text-[10px]"><X className="w-2.5 h-2.5" />remove</button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map(r => {
                const numericValues = r.values.filter(v => typeof v === 'number') as number[];
                const minV = numericValues.length > 0 ? Math.min(...numericValues) : null;
                const maxV = numericValues.length > 0 ? Math.max(...numericValues) : null;
                return (
                  <tr key={r.field} className="hover:bg-white/[0.03]">
                    <td className="px-2 py-2 text-gray-400">{r.field}</td>
                    {r.values.map((v, i) => {
                      const isNum = typeof v === 'number';
                      const isMin = isNum && v === minV && minV !== maxV;
                      const isMax = isNum && v === maxV && minV !== maxV;
                      return (
                        <td key={i} className={cn('px-2 py-2 font-mono tabular-nums', isMin && 'text-emerald-300', isMax && 'text-amber-300', !isMin && !isMax && 'text-white')}>
                          {v == null ? '—' : isNum ? v.toLocaleString() : v}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default PropertyCompare;
