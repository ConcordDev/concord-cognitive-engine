'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building, Loader2, Receipt, LandPlot, Home } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import type { Listing } from './ListingsBrowser';

interface TaxEntry {
  year: number;
  assessedValue: number;
  taxPaid: number;
  effectiveRatePct: number;
}
interface Lot {
  lotSqft: number;
  lotAcres: number;
  yearBuilt: number | null;
  ageYears: number | null;
  pricePerSqft: number | null;
  pricePerLotSqft: number | null;
}
interface SimilarHome {
  id: string;
  address: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  pricePerSqft: number | null;
  similarityPct: number;
}
interface DetailResult {
  listing: Listing;
  taxHistory: TaxEntry[];
  lot: Lot;
  similarHomes: SimilarHome[];
  photoCount: number;
}

export function PropertyDetailPanel({ listingId, onSelect }: { listingId?: string; onSelect?: (l: { id: string }) => void }) {
  const [detail, setDetail] = useState<DetailResult | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!listingId) { setDetail(null); return; }
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'realestate', action: 'property-detail', input: { listingId } });
      if (r.data?.ok) setDetail(r.data.result as DetailResult);
      else setDetail(null);
    } catch (e) {
      console.error('[PropertyDetail] refresh failed', e);
    } finally {
      setLoading(false);
    }
  }, [listingId]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!listingId) {
    return (
      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg p-8 text-center text-xs text-gray-400">
        <Building className="w-6 h-6 mx-auto mb-2 opacity-30" />
        Select a listing to view its tax history, lot facts, and similar homes.
      </div>
    );
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Building className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Property detail</span>
        <span className="ml-auto text-[10px] text-gray-400">tax · lot · comps</span>
      </header>

      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : !detail ? (
        <div className="py-8 text-center text-xs text-gray-400">No detail available for this listing.</div>
      ) : (
        <div className="p-3 space-y-4">
          <div>
            <div className="text-2xl font-mono font-semibold text-white tabular-nums">${detail.listing.price.toLocaleString()}</div>
            <div className="text-xs text-gray-300">{detail.listing.address}</div>
            <div className="text-[10px] text-gray-400">{detail.listing.city}{detail.listing.state ? `, ${detail.listing.state}` : ''} · {detail.photoCount} photo{detail.photoCount === 1 ? '' : 's'}</div>
          </div>

          {/* Lot facts */}
          <section>
            <div className="flex items-center gap-1.5 mb-1.5">
              <LandPlot className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[10px] uppercase tracking-wider text-gray-400">Lot & structure</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <Fact label="Lot size" value={detail.lot.lotSqft > 0 ? `${detail.lot.lotSqft.toLocaleString()} sqft` : '—'} />
              <Fact label="Lot acres" value={detail.lot.lotAcres > 0 ? detail.lot.lotAcres.toFixed(3) : '—'} />
              <Fact label="Year built" value={detail.lot.yearBuilt ? String(detail.lot.yearBuilt) : '—'} />
              <Fact label="Age" value={detail.lot.ageYears != null ? `${detail.lot.ageYears} yr` : '—'} />
              <Fact label="$/sqft" value={detail.lot.pricePerSqft != null ? `$${detail.lot.pricePerSqft}` : '—'} />
              <Fact label="$/lot sqft" value={detail.lot.pricePerLotSqft != null ? `$${detail.lot.pricePerLotSqft}` : '—'} />
            </div>
          </section>

          {/* Tax history */}
          <section>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Receipt className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[10px] uppercase tracking-wider text-gray-400">Tax history</span>
            </div>
            {detail.taxHistory.length === 0 ? (
              <p className="text-[11px] text-gray-400">No tax history.</p>
            ) : (
              <>
                <ChartKit
                  kind="bar"
                  data={detail.taxHistory.map((t) => ({ year: String(t.year), taxPaid: t.taxPaid }))}
                  xKey="year"
                  series={[{ key: 'taxPaid', label: 'Tax paid', color: '#f59e0b' }]}
                  height={160}
                  showLegend={false}
                />
                <table className="w-full mt-2 text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase text-gray-400 border-b border-white/10">
                      <th className="text-left py-1">Year</th>
                      <th className="text-right py-1">Assessed</th>
                      <th className="text-right py-1">Tax paid</th>
                      <th className="text-right py-1">Eff. rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.taxHistory.map((t) => (
                      <tr key={t.year} className="border-b border-white/5">
                        <td className="py-1 text-gray-300">{t.year}</td>
                        <td className="py-1 text-right font-mono tabular-nums text-white">${t.assessedValue.toLocaleString()}</td>
                        <td className="py-1 text-right font-mono tabular-nums text-amber-300">${t.taxPaid.toLocaleString()}</td>
                        <td className="py-1 text-right font-mono tabular-nums text-gray-400">{t.effectiveRatePct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          {/* Similar homes carousel */}
          <section>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Home className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-[10px] uppercase tracking-wider text-gray-400">Similar homes</span>
            </div>
            {detail.similarHomes.length === 0 ? (
              <p className="text-[11px] text-gray-400">No comparable homes in your listings yet.</p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {detail.similarHomes.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => onSelect?.({ id: h.id })}
                    className="flex-shrink-0 w-40 text-left rounded-md border border-white/10 bg-white/[0.03] p-2.5 hover:border-cyan-500/40"
                  >
                    <div className="text-sm font-mono font-semibold text-white">${h.price.toLocaleString()}</div>
                    <div className="text-[11px] text-gray-300 truncate">{h.address}</div>
                    <div className="text-[10px] text-gray-400">{h.beds}bd · {h.baths}ba · {h.sqft.toLocaleString()} sqft</div>
                    <div className="mt-1 text-[10px] text-cyan-300">{h.similarityPct}% match{h.pricePerSqft != null ? ` · $${h.pricePerSqft}/sqft` : ''}</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2">
      <div className="text-[9px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-sm font-mono tabular-nums text-white">{value}</div>
    </div>
  );
}

export default PropertyDetailPanel;
