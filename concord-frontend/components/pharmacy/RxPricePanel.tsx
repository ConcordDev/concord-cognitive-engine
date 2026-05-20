'use client';

/**
 * RxPricePanel — GoodRx-shape prescription price comparison. Record
 * cash / coupon prices per pharmacy and compare to find the lowest.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, DollarSign, TrendingDown, Ticket } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PriceRecord {
  id: string; drugName: string; pharmacyName: string;
  cashPrice: number; couponPrice: number | null;
}
interface Quote extends PriceRecord { effectivePrice: number; rank: number; isBest: boolean }
interface Coupon { id: string; drugName: string; pharmacyName: string | null; discountedPrice: number; code: string | null }

export function RxPricePanel() {
  const [prices, setPrices] = useState<PriceRecord[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ drugName: '', pharmacyName: '', cashPrice: '', couponPrice: '' });
  const [compareDrug, setCompareDrug] = useState('');
  const [comparison, setComparison] = useState<{ quotes: Quote[]; savings: number; savingsPct: number } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [p, c] = await Promise.all([
      lensRun('pharmacy', 'price-list', {}),
      lensRun('pharmacy', 'coupon-list', {}),
    ]);
    setPrices(p.data?.result?.prices || []);
    setCoupons(c.data?.result?.coupons || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const recordPrice = async () => {
    if (!form.drugName.trim() || !form.pharmacyName.trim()) { setError('Drug and pharmacy names are required.'); return; }
    if (!(Number(form.cashPrice) > 0)) { setError('Cash price must be greater than zero.'); return; }
    const r = await lensRun('pharmacy', 'price-record', {
      drugName: form.drugName.trim(), pharmacyName: form.pharmacyName.trim(),
      cashPrice: Number(form.cashPrice), couponPrice: form.couponPrice ? Number(form.couponPrice) : undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ drugName: '', pharmacyName: '', cashPrice: '', couponPrice: '' });
    setError(null);
    await refresh();
  };

  const compare = async (drug: string) => {
    setCompareDrug(drug);
    const r = await lensRun('pharmacy', 'price-compare', { drugName: drug });
    setComparison(r.data?.ok === false ? null : (r.data?.result as { quotes: Quote[]; savings: number; savingsPct: number }));
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const drugs = [...new Set(prices.map((p) => p.drugName))];

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Record a price */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <DollarSign className="w-3.5 h-3.5 text-amber-400" /> Record a price
        </h3>
        <div className="grid grid-cols-4 gap-2">
          <input placeholder="Drug name" value={form.drugName} onChange={(e) => setForm({ ...form, drugName: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Pharmacy" value={form.pharmacyName} onChange={(e) => setForm({ ...form, pharmacyName: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Cash $" inputMode="decimal" value={form.cashPrice} onChange={(e) => setForm({ ...form, cashPrice: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Coupon $" inputMode="decimal" value={form.couponPrice} onChange={(e) => setForm({ ...form, couponPrice: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <button type="button" onClick={recordPrice}
          className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Record price
        </button>
      </section>

      {/* Compare */}
      {drugs.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-zinc-300 mb-2">Compare prices</h3>
          <div className="flex flex-wrap gap-1 mb-2">
            {drugs.map((d) => (
              <button key={d} type="button" onClick={() => compare(d)}
                className={cn('text-[11px] px-2 py-0.5 rounded-full border capitalize',
                  compareDrug === d ? 'border-amber-700/50 bg-amber-950/40 text-amber-300' : 'border-zinc-700 text-zinc-400')}>
                {d}
              </button>
            ))}
          </div>
          {comparison && comparison.quotes.length > 0 && (
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              {comparison.savings > 0 && (
                <p className="flex items-center gap-1 text-[11px] text-emerald-400 mb-2">
                  <TrendingDown className="w-3.5 h-3.5" />
                  Save ${comparison.savings} ({comparison.savingsPct}%) by choosing the cheapest pharmacy.
                </p>
              )}
              <ul className="space-y-1">
                {comparison.quotes.map((q) => (
                  <li key={q.id} className={cn('flex items-center justify-between text-xs px-2 py-1.5 rounded-lg',
                    q.isBest ? 'bg-emerald-950/40 text-emerald-200' : 'text-zinc-300')}>
                    <span>{q.rank}. {q.pharmacyName}</span>
                    <span className="font-mono">
                      ${q.effectivePrice}
                      {q.couponPrice != null && <span className="text-zinc-500 ml-1 line-through">${q.cashPrice}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Coupons */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Ticket className="w-3.5 h-3.5 text-amber-400" /> Saved coupons
        </h3>
        {coupons.length === 0 ? (
          <p className="text-[11px] text-zinc-500 italic">No coupons saved.</p>
        ) : (
          <ul className="space-y-1">
            {coupons.map((c) => (
              <li key={c.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{c.drugName}</p>
                  <p className="text-[10px] text-zinc-500">{c.pharmacyName || 'Any pharmacy'}{c.code ? ` · ${c.code}` : ''}</p>
                </div>
                <span className="text-xs font-mono text-emerald-400">${c.discountedPrice}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
