'use client';

import { useState } from 'react';
import { DollarSign, Loader2, Clock, Shield } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Quote {
  carrierId: string; carrierName: string; carrierCode: string;
  rateUsd: number; transitDays: number; serviceLevel: string; guaranteed: boolean;
}

export function RateQuoter() {
  const [form, setForm] = useState({ origin: '', destination: '', weightLbs: '5', mode: 'parcel' });
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function quote() {
    if (!form.origin.trim() || !form.destination.trim()) return;
    setLoading(true); setError(null); setQuotes([]);
    try {
      const res = await api.post('/api/lens/run', { domain: 'logistics', action: 'rates-quote', input: { ...form, weightLbs: Number(form.weightLbs) || 1 } });
      if (res.data?.ok === false) setError((res.data?.error as string) || 'Quote failed');
      else setQuotes((res.data?.result?.quotes || []) as Quote[]);
    } catch (e) { console.error('[Rates]', e); setError(e instanceof Error ? e.message : 'failed'); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Rate quoter · multi-carrier compare</span>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); quote(); }} className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} placeholder="Origin (Austin, TX)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} placeholder="Destination (Boston, MA)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.weightLbs} onChange={e => setForm({ ...form, weightLbs: e.target.value })} placeholder="Weight lbs" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="parcel">Parcel</option><option value="ltl">LTL</option><option value="ftl">FTL</option>
        </select>
        <button type="submit" disabled={loading} className="col-span-4 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />} Compare rates
        </button>
      </form>

      <div className="max-h-80 overflow-y-auto">
        {error && <div className="px-3 py-4 text-center text-xs text-rose-300">{error}</div>}
        {!loading && !error && quotes.length === 0 && (
          <div className="px-3 py-10 text-center text-xs text-gray-500"><DollarSign className="w-6 h-6 mx-auto mb-2 opacity-30" />Enter origin + destination above to compare carriers.</div>
        )}
        {quotes.length > 0 && (
          <ul className="divide-y divide-white/5">
            {quotes.map((q, i) => (
              <li key={q.carrierId} className={cn('px-3 py-3 hover:bg-white/[0.03]', i === 0 && 'bg-emerald-500/5 border-l-2 border-emerald-400')}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-cyan-500/15 text-cyan-300 flex items-center justify-center text-[10px] font-mono font-bold">{q.carrierCode}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{q.carrierName}</span>
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{q.serviceLevel.replace('_', ' ')}</span>
                      {q.guaranteed && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-0.5"><Shield className="w-2.5 h-2.5" />Guaranteed</span>}
                      {i === 0 && <span className="text-[10px] uppercase tracking-wider text-emerald-300">Best price</span>}
                    </div>
                    <div className="text-[11px] text-gray-500 inline-flex items-center gap-2 mt-0.5">
                      <Clock className="w-3 h-3" />
                      <span>{q.transitDays} day{q.transitDays === 1 ? '' : 's'} transit</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-mono tabular-nums text-emerald-300">${q.rateUsd.toFixed(2)}</div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RateQuoter;
