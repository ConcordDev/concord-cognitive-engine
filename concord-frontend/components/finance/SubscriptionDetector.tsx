'use client';

import { useEffect, useState } from 'react';
import { Repeat, Trash2, Loader2, AlertCircle, ArrowDownAZ } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface Subscription {
  id: string;
  merchant: string;
  monthlyAmount: number;
  cadence: 'monthly' | 'annual' | 'weekly' | 'other';
  lastChargedAt: string;
  nextEstimated: string;
  category: string;
  status: 'active' | 'paused' | 'cancelled';
  insight?: string;
}

export function SubscriptionDetector() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'amount' | 'merchant' | 'recent'>('amount');

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'finance', action: 'subscriptions-detect', input: {},
      });
      setSubs((res.data?.result?.subscriptions || []) as Subscription[]);
    } catch (e) { console.error('[Subs] detect failed', e); }
    finally { setLoading(false); }
  }

  async function cancel(id: string) {
    if (!confirm('Mark as cancelled (you handle the actual cancellation off-app)?')) return;
    try {
      await api.post('/api/lens/run', {
        domain: 'finance', action: 'subscriptions-cancel', input: { id },
      });
      setSubs(prev => prev.map(s => s.id === id ? { ...s, status: 'cancelled' } : s));
    } catch (e) { console.error('[Subs] cancel failed', e); }
  }

  const sorted = [...subs].sort((a, b) => {
    if (sortBy === 'amount') return b.monthlyAmount - a.monthlyAmount;
    if (sortBy === 'merchant') return a.merchant.localeCompare(b.merchant);
    return new Date(b.lastChargedAt).getTime() - new Date(a.lastChargedAt).getTime();
  });

  const active = sorted.filter(s => s.status === 'active');
  const totalMonthly = active.reduce((s, x) => s + x.monthlyAmount, 0);
  const totalAnnual = active.reduce((s, x) => s + (x.cadence === 'annual' ? x.monthlyAmount * 12 : x.monthlyAmount * 12), 0);

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Repeat className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Subscriptions</span>
        <span className="ml-auto text-[10px] text-gray-500">{active.length} active · ${totalMonthly.toFixed(0)}/mo · ${totalAnnual.toFixed(0)}/yr</span>
        <button onClick={refresh} className="p-1 text-gray-400 hover:text-white" title="Rescan">
          <Loader2 className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
      </header>

      <div className="px-3 py-1.5 border-b border-white/5 flex items-center gap-1 text-[10px]">
        <ArrowDownAZ className="w-3 h-3 text-gray-500" />
        {(['amount', 'merchant', 'recent'] as const).map(s => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={cn('px-2 py-0.5 rounded uppercase tracking-wider',
              sortBy === s ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-500 hover:text-white'
            )}
          >{s}</button>
        ))}
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Detecting recurring charges…
          </div>
        ) : sorted.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-500">
            <Repeat className="w-6 h-6 mx-auto mb-2 opacity-30" />
            No subscriptions detected. Add transactions on the Activity tab.
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {sorted.map(s => (
              <li key={s.id} className={cn('px-3 py-2 hover:bg-white/[0.03] group flex items-start gap-3', s.status === 'cancelled' && 'opacity-50')}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-white font-medium">{s.merchant}</span>
                    <span className="text-[9px] text-gray-500 uppercase">{s.cadence}</span>
                    {s.status === 'cancelled' && <span className="text-[9px] bg-red-500/20 text-red-300 px-1.5 py-0.5 rounded">cancelled</span>}
                    {s.status === 'paused' && <span className="text-[9px] bg-gray-500/20 text-gray-300 px-1.5 py-0.5 rounded">paused</span>}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {s.category} · last {new Date(s.lastChargedAt).toLocaleDateString()} · next ~{new Date(s.nextEstimated).toLocaleDateString()}
                  </div>
                  {s.insight && (
                    <div className="text-[10px] text-yellow-300 mt-0.5 inline-flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> {s.insight}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-base font-bold text-white tabular-nums">${s.monthlyAmount.toFixed(2)}</div>
                  <div className="text-[9px] text-gray-500">/mo</div>
                </div>
                {s.status === 'active' && (
                  <button
                    onClick={() => cancel(s.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400"
                    title="Cancel"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default SubscriptionDetector;
