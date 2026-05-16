'use client';

import { useState } from 'react';
import { DollarSign, Loader2, Search, MapPin } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface PharmacyPrice {
  pharmacy: string;
  address: string;
  distanceMi: number;
  cashPrice: number;
  withInsuranceCopay?: number;
  couponCode?: string;
  inStock: boolean;
}

export function RxPriceCompare() {
  const [drug, setDrug] = useState('Atorvastatin 20mg');
  const [zip, setZip] = useState('');
  const [prices, setPrices] = useState<PharmacyPrice[]>([]);
  const [loading, setLoading] = useState(false);

  async function compare() {
    if (!drug.trim()) return;
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'healthcare', action: 'rx-price-compare',
        input: { drug: drug.trim(), zip: zip || undefined },
      });
      setPrices((res.data?.result?.prices || []) as PharmacyPrice[]);
    } catch (e) { console.error('[Rx] price compare failed', e); }
    finally { setLoading(false); }
  }

  const sorted = [...prices].sort((a, b) => a.cashPrice - b.cashPrice);
  const cheapest = sorted[0]?.cashPrice || 0;
  const mostExpensive = sorted[sorted.length - 1]?.cashPrice || 0;
  const savings = mostExpensive - cheapest;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <DollarSign className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Rx price compare</span>
        <span className="ml-auto text-[10px] text-gray-500">GoodRx-style</span>
      </header>
      <div className="p-3 border-b border-white/10 flex items-center gap-2 text-xs">
        <input value={drug} onChange={e => setDrug(e.target.value)} placeholder="Drug name + strength" className="flex-1 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
        <input value={zip} onChange={e => setZip(e.target.value)} placeholder="ZIP" className="w-24 px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white" />
        <button onClick={compare} disabled={loading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Compare
        </button>
      </div>
      {savings > 5 && (
        <div className="px-4 py-2 bg-green-500/10 border-b border-green-500/30 text-xs text-green-300">
          You could save up to ${savings.toFixed(2)} by switching pharmacies.
        </div>
      )}
      <ul className="divide-y divide-white/5 max-h-96 overflow-y-auto">
        {loading ? (
          <li className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Querying pharmacies…</li>
        ) : sorted.length === 0 ? (
          <li className="px-3 py-8 text-center text-xs text-gray-500">No prices found.</li>
        ) : (
          sorted.map((p, i) => (
            <li key={`${p.pharmacy}-${i}`} className={cn('px-3 py-2', i === 0 && 'bg-green-500/5')}>
              <div className="flex items-center gap-2">
                <span className="text-sm text-white font-medium">{p.pharmacy}</span>
                {i === 0 && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-green-500/20 text-green-300 font-bold">cheapest</span>}
                {!p.inStock && <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 font-bold">out of stock</span>}
                <div className="ml-auto text-right">
                  <div className="text-lg font-bold text-cyan-300 tabular-nums">${p.cashPrice.toFixed(2)}</div>
                  {p.withInsuranceCopay != null && (
                    <div className="text-[10px] text-gray-500">copay ${p.withInsuranceCopay.toFixed(2)}</div>
                  )}
                </div>
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5 inline-flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {p.address} · {p.distanceMi.toFixed(1)} mi
                {p.couponCode && <span className="ml-2 text-cyan-300">code {p.couponCode}</span>}
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export default RxPriceCompare;
