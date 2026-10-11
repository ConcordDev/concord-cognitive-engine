'use client';

import { useState } from 'react';
import { DollarSign, Loader2, Clock, Shield } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Quote {
  carrierId: string;
  carrierName: string;
  carrierCode: string;
  rateUsd: number | null;
  transitDays: number | null;
  serviceLevel: string | null;
  guaranteed: boolean;
  estimate?: boolean;
  label?: string;
}

function formatQuoteError(code: string | null | undefined): string {
  if (!code) return 'Quote failed';
  if (code === 'carrier_rates_not_configured') {
    return 'Carrier rates are not configured. Set SHIPENGINE_API_KEY or EASYPOST_API_KEY on the server. Concord does not invent shipping prices.';
  }
  return code;
}

export function RateQuoter() {
  const [form, setForm] = useState({ origin: '', destination: '', weightLbs: '5', mode: 'parcel' });
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState(false);
  const [distanceMi, setDistanceMi] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function quote() {
    if (!form.origin.trim() || !form.destination.trim()) return;
    setLoading(true);
    setError(null);
    setQuotes([]);
    setEstimate(false);
    setDistanceMi(null);
    setNote(null);
    setSearched(true);
    try {
      const res = await lensRun({ domain: 'logistics', action: 'rates-quote', input: { ...form, weightLbs: Number(form.weightLbs) || 1 } });
      if (res.data?.ok === false) {
        setError(formatQuoteError(res.data?.error));
      } else {
        const result = res.data?.result as {
          quotes?: Quote[];
          estimate?: boolean;
          distanceMi?: number;
          note?: string;
        } | null;
        const isEstimate = result?.estimate === true;
        setEstimate(isEstimate);
        setDistanceMi(typeof result?.distanceMi === 'number' ? result.distanceMi : null);
        setNote(typeof result?.note === 'string' ? result.note : null);
        setQuotes((result?.quotes || []) as Quote[]);
      }
    } catch (e) { console.error('[Rates]', e); setError(e instanceof Error ? e.message : 'failed'); }
    finally { setLoading(false); }
  }

  const showPrices = !estimate && quotes.some((q) => q.rateUsd != null);

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Rate quoter · multi-carrier compare</span>
      </header>

      <form onSubmit={(e) => { e.preventDefault(); quote(); }} className="p-3 border-b border-white/10 grid grid-cols-5 gap-2">
        <input value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })} placeholder="Origin (Austin, TX 78701)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} placeholder="Destination (Boston, MA 02101)" className="col-span-2 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <input type="number" value={form.weightLbs} onChange={e => setForm({ ...form, weightLbs: e.target.value })} placeholder="Weight lbs" className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white" />
        <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white">
          <option value="parcel">Parcel</option><option value="ltl">LTL</option><option value="ftl">FTL</option>
        </select>
        <button type="submit" disabled={loading} className="col-span-4 px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <DollarSign className="w-3 h-3" />} Compare rates
        </button>
      </form>

      <div className="max-h-80 overflow-y-auto">
        {estimate && (
          <div className="px-3 py-2 text-[11px] text-amber-100 bg-amber-500/10 border-b border-amber-500/30">
            <span className="uppercase tracking-wider font-semibold">Estimate</span>
            <span> · not a carrier quote</span>
            {distanceMi != null && (
              <span> · {distanceMi.toFixed(distanceMi < 10 ? 2 : 1)} mi straight-line</span>
            )}
          </div>
        )}
        {error && <div className="px-3 py-4 text-center text-xs text-rose-300">{error}</div>}
        {!loading && !error && !searched && quotes.length === 0 && (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><DollarSign className="w-6 h-6 mx-auto mb-2 opacity-30" />Enter origin + destination above to compare carriers.</div>
        )}
        {!loading && !error && searched && quotes.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-gray-400">{note || 'No carrier rates matched the carriers on this account.'}</div>
        )}
        {quotes.length > 0 && (
          <ul className="divide-y divide-white/5">
            {quotes.map((q, i) => (
              <li key={`${q.carrierId}-${q.serviceLevel || 'svc'}-${i}`} className={cn('px-3 py-3 hover:bg-white/[0.03]', showPrices && i === 0 && 'bg-emerald-500/5 border-l-2 border-emerald-400')}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded bg-cyan-500/15 text-cyan-300 flex items-center justify-center text-[10px] font-mono font-bold">{q.carrierCode}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{q.carrierName}</span>
                      {q.serviceLevel && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{q.serviceLevel.replace(/_/g, ' ')}</span>}
                      {!estimate && q.guaranteed === true && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 inline-flex items-center gap-0.5"><Shield className="w-2.5 h-2.5" />Guaranteed</span>}
                      {showPrices && i === 0 && <span className="text-[10px] uppercase tracking-wider text-emerald-300">Best price</span>}
                    </div>
                    <div className="text-[11px] text-gray-400 inline-flex items-center gap-2 mt-0.5">
                      {q.transitDays != null && (
                        <>
                          <Clock className="w-3 h-3" />
                          <span>{q.transitDays} day{q.transitDays === 1 ? '' : 's'} transit</span>
                        </>
                      )}
                      {estimate && q.transitDays == null && <span>not a carrier quote</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    {showPrices && q.rateUsd != null ? (
                      <div className="text-xl font-mono tabular-nums text-emerald-300">${Number(q.rateUsd).toFixed(2)}</div>
                    ) : (
                      <div className="text-[10px] uppercase tracking-wider text-amber-200">Not a carrier quote</div>
                    )}
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
