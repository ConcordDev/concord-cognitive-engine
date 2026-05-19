'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Bill {
  id: string; number: string; vendorName: string;
  total: number; dueAt: string; daysPastDue: number;
}
interface Bucket { key: string; label: string; total: number; bills: Bill[] }

export function APAgingPanel() {
  const [data, setData] = useState<{ buckets: Bucket[]; totalOpen: number; asOf: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const r = await api.post('/api/lens/run', { domain: 'accounting', action: 'aging-ap', input: {} });
      const result = r.data?.result;
      if (result) setData({ buckets: result.buckets as Bucket[], totalOpen: result.totalOpen, asOf: result.asOf });
    } catch (e) { console.error('[APAging] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/15 rounded-lg overflow-hidden">
      <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-amber-400" />
        <span className="text-sm font-semibold text-gray-200">A/P aging</span>
        {data && <span className="text-[10px] text-gray-500">as of {data.asOf} · ${data.totalOpen.toFixed(0)} open</span>}
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !data ? (
        <div className="p-10 text-center text-xs text-gray-500">No data.</div>
      ) : (
        <div className="p-4 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {data.buckets.map(b => (
              <div key={b.key} className={cn(
                'rounded border p-3',
                b.key === 'd90plus' ? 'border-rose-500/40 bg-rose-500/5' : b.key === 'd60' ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/10 bg-black/30',
              )}>
                <div className="text-[10px] uppercase tracking-wider text-gray-500">{b.label}</div>
                <div className="text-xl font-mono tabular-nums text-amber-200 mt-1">${b.total.toFixed(0)}</div>
                <div className="text-[10px] text-gray-500">{b.bills.length} bill{b.bills.length === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>
          {data.buckets.flatMap(b => b.bills).length > 0 && (
            <ul className="divide-y divide-white/5 max-h-80 overflow-y-auto bg-black/30 rounded border border-white/10">
              {data.buckets.flatMap(b => b.bills.map(bill => ({ ...bill, bucketLabel: b.label, bucketKey: b.key })))
                .sort((a, b) => b.daysPastDue - a.daysPastDue)
                .map(b => (
                  <li key={b.id} className="px-3 py-2 flex items-center gap-2 text-xs">
                    <span className={cn(
                      'text-[9px] uppercase px-1.5 py-0.5 rounded font-mono',
                      b.bucketKey === 'd90plus' ? 'bg-rose-500/25 text-rose-200' : b.bucketKey === 'd60' ? 'bg-amber-500/25 text-amber-200' : 'bg-white/5 text-gray-400',
                    )}>{b.daysPastDue}d</span>
                    <span className="font-mono text-[10px] text-gray-500">{b.number}</span>
                    <span className="flex-1 truncate text-white">{b.vendorName}</span>
                    <span className="text-[10px] text-gray-500">due {b.dueAt}</span>
                    <span className="font-mono tabular-nums text-rose-300 w-20 text-right">${b.total.toFixed(2)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default APAgingPanel;
