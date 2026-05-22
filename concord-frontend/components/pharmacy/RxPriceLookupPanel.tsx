'use client';

/**
 * RxPriceLookupPanel — GoodRx-shape live drug price lookup (CMS NADAC
 * acquisition cost via RxNorm) and openFDA pill identifier.
 */

import { useState } from 'react';
import { Loader2, Search, DollarSign, Pill, ScanLine } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PriceQuote { ndcDescription: string; perUnit: number; pricingUnit: string; estimatedTotal: number; effectiveDate: string | null }
interface PriceResult { drug: string; rxName: string; rxcui: string | null; quantity: number; quotes: PriceQuote[]; lowestPerUnit?: number; lowestTotal?: number; highestTotal?: number; note?: string; disclaimer?: string }
interface PillMatch { genericName: string | null; brandName: string | null; manufacturer: string | null; dosageForm: string | null; route: string | null; strength: string | null; colorMatch: boolean | null; shapeMatch: boolean | null; setId: string }
interface PillResult { matches: PillMatch[]; count: number; note?: string; disclaimer?: string }

export function RxPriceLookupPanel() {
  const [priceForm, setPriceForm] = useState({ drug: '', quantity: '30' });
  const [priceResult, setPriceResult] = useState<PriceResult | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);

  const [pillForm, setPillForm] = useState({ imprint: '', color: '', shape: '', drugName: '' });
  const [pillResult, setPillResult] = useState<PillResult | null>(null);
  const [pillLoading, setPillLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const lookupPrice = async () => {
    if (!priceForm.drug.trim()) { setError('Enter a drug name.'); return; }
    setPriceLoading(true); setError(null); setPriceResult(null);
    const r = await lensRun('pharmacy', 'price-lookup', {
      drug: priceForm.drug.trim(), quantity: Number(priceForm.quantity) || 30,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Price lookup failed'); }
    else { setPriceResult(r.data?.result as PriceResult); }
    setPriceLoading(false);
  };

  const identifyPill = async () => {
    if (!pillForm.imprint.trim() && !pillForm.drugName.trim()) {
      setError('Enter an imprint code or drug name to identify a pill.'); return;
    }
    setPillLoading(true); setError(null); setPillResult(null);
    const r = await lensRun('pharmacy', 'pill-identify', {
      imprint: pillForm.imprint.trim(), color: pillForm.color.trim(),
      shape: pillForm.shape.trim(), drugName: pillForm.drugName.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Pill identification failed'); }
    else { setPillResult(r.data?.result as PillResult); }
    setPillLoading(false);
  };

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Live price lookup */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <DollarSign className="w-3.5 h-3.5 text-amber-400" /> Live drug price lookup
        </h3>
        <div className="grid grid-cols-3 gap-2">
          <input placeholder="Drug name (e.g. atorvastatin)" value={priceForm.drug}
            onChange={(e) => setPriceForm({ ...priceForm, drug: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') void lookupPrice(); }}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Quantity" inputMode="numeric" value={priceForm.quantity}
            onChange={(e) => setPriceForm({ ...priceForm, quantity: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <button type="button" onClick={lookupPrice} disabled={priceLoading}
          className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg">
          {priceLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          Look up price
        </button>
        {priceResult && (
          <div className="mt-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <p className="text-[11px] text-zinc-400 mb-1">
              {priceResult.rxName}
              {priceResult.rxcui ? ` · RxCUI ${priceResult.rxcui}` : ''} · qty {priceResult.quantity}
            </p>
            {priceResult.quotes.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic">{priceResult.note || 'No pricing data found.'}</p>
            ) : (
              <>
                {priceResult.lowestTotal != null && (
                  <p className="text-xs text-emerald-400 mb-1.5">
                    Lowest est. total: <span className="font-mono font-bold">${priceResult.lowestTotal}</span>
                    <span className="text-zinc-500"> (${priceResult.lowestPerUnit}/unit)</span>
                  </p>
                )}
                <ul className="space-y-1 max-h-56 overflow-y-auto">
                  {priceResult.quotes.map((q, i) => (
                    <li key={`${q.ndcDescription}-${i}`}
                      className={cn('flex items-center justify-between text-[11px] px-2 py-1 rounded-lg',
                        i === 0 ? 'bg-emerald-950/40 text-emerald-200' : 'text-zinc-300')}>
                      <span className="truncate pr-2">{q.ndcDescription}</span>
                      <span className="font-mono whitespace-nowrap">${q.estimatedTotal}</span>
                    </li>
                  ))}
                </ul>
                {priceResult.disclaimer && <p className="text-[10px] text-zinc-600 italic mt-1.5">{priceResult.disclaimer}</p>}
              </>
            )}
          </div>
        )}
      </section>

      {/* Pill identifier */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <ScanLine className="w-3.5 h-3.5 text-amber-400" /> Pill identifier
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <input placeholder="Imprint code" value={pillForm.imprint}
            onChange={(e) => setPillForm({ ...pillForm, imprint: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Drug name (optional)" value={pillForm.drugName}
            onChange={(e) => setPillForm({ ...pillForm, drugName: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Color (optional)" value={pillForm.color}
            onChange={(e) => setPillForm({ ...pillForm, color: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Shape (optional)" value={pillForm.shape}
            onChange={(e) => setPillForm({ ...pillForm, shape: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <button type="button" onClick={identifyPill} disabled={pillLoading}
          className="mt-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg">
          {pillLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pill className="w-3.5 h-3.5" />}
          Identify pill
        </button>
        {pillResult && (
          <div className="mt-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            {pillResult.matches.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic">{pillResult.note || 'No pill matched.'}</p>
            ) : (
              <ul className="space-y-1.5 max-h-64 overflow-y-auto">
                {pillResult.matches.map((m, i) => (
                  <li key={m.setId || i} className="bg-zinc-950/60 border border-zinc-800 rounded-lg px-2.5 py-1.5">
                    <p className="text-xs text-zinc-100">
                      {m.brandName || m.genericName || 'Unknown'}
                      {m.brandName && m.genericName ? <span className="text-zinc-500"> · {m.genericName}</span> : null}
                    </p>
                    <p className="text-[10px] text-zinc-500">
                      {[m.dosageForm, m.route, m.manufacturer].filter(Boolean).join(' · ')}
                    </p>
                    {m.strength && <p className="text-[10px] text-zinc-500">{m.strength}</p>}
                    {(m.colorMatch || m.shapeMatch) && (
                      <p className="text-[10px] text-emerald-400">
                        {m.colorMatch ? 'color match ' : ''}{m.shapeMatch ? 'shape match' : ''}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {pillResult.disclaimer && <p className="text-[10px] text-zinc-600 italic mt-1.5">{pillResult.disclaimer}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
