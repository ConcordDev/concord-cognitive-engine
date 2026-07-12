'use client';

/**
 * CMAPanel — Comparative Market Analysis, built from the user's OWN
 * tracked listings (not an MLS-wide feed — Concord has no paid
 * ATTOM/CoreLogic-style comps API configured, and wiring one is a
 * separate DATA-SOURCING decision that needs credentials this
 * environment doesn't have). Every number here is derived from real
 * `$/sqft` math over listings the user actually added in the
 * Listings tab — never a fabricated figure. When there aren't enough
 * tracked comps, the panel says so honestly instead of guessing.
 */

import { useEffect, useState } from 'react';
import { BarChart3, Loader2, Home, ListChecks, Info } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type Kind = 'single_family' | 'condo' | 'townhouse' | 'multi_family' | 'land';
type Condition = 'excellent' | 'good' | 'fair' | 'poor';

interface ListingOption {
  id: string; address: string; city?: string; kind: Kind;
  beds: number; baths: number; sqft: number;
}

interface CompRow {
  id: string; address: string; city?: string; kind: Kind;
  beds: number; baths: number; sqft: number; price: number;
  status: string; daysOnMarket?: number; pricePerSqft: number;
}

interface Subject {
  address: string | null; city: string; kind: Kind;
  beds: number; baths: number; sqft: number; condition: Condition;
}

interface Valuation {
  medianPricePerSqft: number;
  averagePricePerSqft: number;
  minPricePerSqft: number;
  maxPricePerSqft: number;
  conditionMult: number;
  estimate: number;
  lowEstimate: number;
  highEstimate: number;
  formula: string;
}

interface CMAResult {
  subject: Subject;
  comps: CompRow[];
  compCount: number;
  valuation: Valuation | null;
  methodology: string;
  message?: string;
}

const KIND_LABEL: Record<Kind, string> = {
  single_family: 'Single family', condo: 'Condo', townhouse: 'Townhouse',
  multi_family: 'Multi-family', land: 'Land',
};

export function CMAPanel() {
  const [mode, setMode] = useState<'existing' | 'manual'>('existing');
  const [listings, setListings] = useState<ListingOption[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingId, setListingId] = useState('');
  const [manual, setManual] = useState({ address: '', city: '', kind: 'single_family' as Kind, beds: '3', baths: '2', sqft: '2000' });
  const [condition, setCondition] = useState<Condition>('good');
  const [result, setResult] = useState<CMAResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setListingsLoading(true);
      try {
        const res = await lensRun({ domain: 'realestate', action: 'listings-list', input: {} });
        if (res.data?.ok !== false) setListings((res.data?.result?.listings || []) as ListingOption[]);
      } catch (e) { console.error('[CMA] listings-list failed', e); }
      finally { setListingsLoading(false); }
    })();
  }, []);

  async function generate() {
    setError(null);
    const input: Record<string, unknown> = { condition };
    if (mode === 'existing') {
      if (!listingId) { setError('Pick a tracked listing first.'); return; }
      input.listingId = listingId;
    } else {
      if (!manual.city.trim()) { setError('City is required.'); return; }
      const sqft = Number(manual.sqft);
      if (!Number.isFinite(sqft) || sqft <= 0) { setError('Sqft must be a positive number.'); return; }
      input.city = manual.city.trim();
      input.kind = manual.kind;
      input.beds = Number(manual.beds) || 0;
      input.baths = Number(manual.baths) || 0;
      input.sqft = sqft;
      input.address = manual.address.trim();
    }
    setLoading(true); setResult(null);
    try {
      const res = await lensRun({ domain: 'realestate', action: 'cma_generate', input });
      if (res.data?.ok === false) {
        setError((res.data?.error as string) || 'CMA generation failed');
      } else {
        setResult((res.data?.result as CMAResult) || null);
      }
    } catch (e) { console.error('[CMA] cma_generate failed', e); setError(e instanceof Error ? e.message : 'failed'); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Comparative Market Analysis</span>
        <span className="ml-auto text-[10px] text-gray-400">from your tracked listings</span>
      </header>

      <div className="px-4 py-2 border-b border-white/10 flex items-start gap-2 bg-amber-500/[0.04]">
        <Info className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-200/80 leading-relaxed">
          Concord has no MLS-wide comps feed. This CMA is built only from properties <em>you</em> have
          added in the Listings tab — it is not a professional, market-wide comparative analysis.
        </p>
      </div>

      {/* Mode toggle */}
      <div className="px-4 pt-3 flex items-center gap-1.5 text-xs">
        <button
          onClick={() => setMode('existing')}
          className={cn('px-3 py-1.5 rounded-md font-mono transition inline-flex items-center gap-1.5',
            mode === 'existing' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20' : 'text-gray-400 hover:text-cyan-300 border border-transparent')}
        >
          <ListChecks className="w-3.5 h-3.5" /> Pick a tracked listing
        </button>
        <button
          onClick={() => setMode('manual')}
          className={cn('px-3 py-1.5 rounded-md font-mono transition inline-flex items-center gap-1.5',
            mode === 'manual' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/20' : 'text-gray-400 hover:text-cyan-300 border border-transparent')}
        >
          <Home className="w-3.5 h-3.5" /> Enter specs manually
        </button>
      </div>

      {/* Subject form */}
      <div className="p-4 space-y-2">
        {mode === 'existing' ? (
          listingsLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-400"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading your listings…</div>
          ) : listings.length === 0 ? (
            <div className="text-xs text-gray-400 px-3 py-4 text-center border border-dashed border-white/10 rounded-md">
              You haven&apos;t tracked any listings yet. Add one in the Listings tab, or switch to &quot;Enter specs manually&quot;.
            </div>
          ) : (
            <select
              value={listingId}
              onChange={e => setListingId(e.target.value)}
              className="w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white text-xs"
            >
              <option value="">Select a subject property…</option>
              {listings.map(l => (
                <option key={l.id} value={l.id}>
                  {l.address} — {l.city} · {KIND_LABEL[l.kind] || l.kind} · {l.beds}bd/{l.baths}ba · {l.sqft.toLocaleString()} sqft
                </option>
              ))}
            </select>
          )
        ) : (
          <div className="grid grid-cols-4 gap-2 text-xs">
            <label className="col-span-2 space-y-1"><span className="text-gray-400">Address (optional)</span>
              <input value={manual.address} onChange={e => setManual({ ...manual, address: e.target.value })} placeholder="123 Main St" className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
            </label>
            <label className="col-span-2 space-y-1"><span className="text-gray-400">City</span>
              <input value={manual.city} onChange={e => setManual({ ...manual, city: e.target.value })} placeholder="Austin" className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
            </label>
            <label className="space-y-1"><span className="text-gray-400">Beds</span>
              <input type="number" value={manual.beds} onChange={e => setManual({ ...manual, beds: e.target.value })} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
            </label>
            <label className="space-y-1"><span className="text-gray-400">Baths</span>
              <input type="number" value={manual.baths} onChange={e => setManual({ ...manual, baths: e.target.value })} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
            </label>
            <label className="space-y-1"><span className="text-gray-400">Sqft</span>
              <input type="number" value={manual.sqft} onChange={e => setManual({ ...manual, sqft: e.target.value })} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white" />
            </label>
            <label className="space-y-1"><span className="text-gray-400">Kind</span>
              <select value={manual.kind} onChange={e => setManual({ ...manual, kind: e.target.value as Kind })} className="w-full px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
                <option value="single_family">SFH</option><option value="condo">Condo</option><option value="townhouse">TH</option><option value="multi_family">Multi</option><option value="land">Land</option>
              </select>
            </label>
          </div>
        )}

        <label className="flex items-center gap-2 text-xs pt-1">
          <span className="text-gray-400">Condition</span>
          <select value={condition} onChange={e => setCondition(e.target.value as Condition)} className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white">
            <option value="excellent">Excellent</option><option value="good">Good</option><option value="fair">Fair</option><option value="poor">Poor</option>
          </select>
        </label>

        <button
          onClick={generate}
          disabled={loading}
          className="w-full mt-1 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center justify-center gap-1.5"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BarChart3 className="w-3.5 h-3.5" />} Generate CMA
        </button>
        {error && <p className="text-[11px] text-rose-300">{error}</p>}
      </div>

      {/* Results */}
      {result && result.compCount === 0 && (
        <div className="px-4 pb-4">
          <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] p-4 text-center">
            <BarChart3 className="w-6 h-6 mx-auto mb-2 text-gray-500 opacity-40" />
            <p className="text-xs text-gray-300">{result.message}</p>
            <p className="text-[10px] text-gray-500 mt-1.5">{result.methodology}</p>
          </div>
        </div>
      )}

      {result && result.compCount > 0 && result.valuation && (
        <div className="px-4 pb-4 space-y-3">
          <div className="text-center py-2">
            <div className="text-[10px] uppercase tracking-wider text-gray-400">Estimated value</div>
            <div className="text-4xl font-mono font-semibold text-cyan-300 tabular-nums">${result.valuation.estimate.toLocaleString()}</div>
            <div className="text-[11px] text-gray-400 mt-1">
              Range: <span className="text-gray-200">${result.valuation.lowEstimate.toLocaleString()}</span> – <span className="text-gray-200">${result.valuation.highEstimate.toLocaleString()}</span>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2 text-xs">
            <StatTile label="Median $/sqft" value={`$${result.valuation.medianPricePerSqft}`} />
            <StatTile label="Avg $/sqft" value={`$${result.valuation.averagePricePerSqft}`} />
            <StatTile label="Min $/sqft" value={`$${result.valuation.minPricePerSqft}`} />
            <StatTile label="Max $/sqft" value={`$${result.valuation.maxPricePerSqft}`} />
          </div>

          <p className="text-[10px] text-gray-500 font-mono bg-white/[0.02] border border-white/10 rounded p-2">{result.valuation.formula}</p>
          <p className="text-[11px] text-gray-400 leading-relaxed">{result.methodology}</p>

          <div className="rounded-lg border border-white/10 overflow-hidden">
            <div className="px-3 py-1.5 border-b border-white/10 bg-white/[0.02] text-[10px] uppercase tracking-wider text-gray-400">
              {result.compCount} comparable{result.compCount === 1 ? '' : 's'} used
            </div>
            <table className="w-full text-xs">
              <thead className="border-b border-white/10">
                <tr className="text-left text-[10px] uppercase tracking-wider text-gray-400">
                  <th className="px-2 py-1.5">Address</th>
                  <th className="px-2 py-1.5">Bd/Ba</th>
                  <th className="px-2 py-1.5">Sqft</th>
                  <th className="px-2 py-1.5">Price</th>
                  <th className="px-2 py-1.5">$/sqft</th>
                  <th className="px-2 py-1.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {result.comps.map(c => (
                  <tr key={c.id} className="hover:bg-white/[0.03]">
                    <td className="px-2 py-1.5 text-gray-200 truncate max-w-[180px]">{c.address}</td>
                    <td className="px-2 py-1.5 font-mono tabular-nums text-gray-300">{c.beds}/{c.baths}</td>
                    <td className="px-2 py-1.5 font-mono tabular-nums text-gray-300">{c.sqft.toLocaleString()}</td>
                    <td className="px-2 py-1.5 font-mono tabular-nums text-white">${c.price.toLocaleString()}</td>
                    <td className="px-2 py-1.5 font-mono tabular-nums text-cyan-300">${c.pricePerSqft}</td>
                    <td className="px-2 py-1.5 text-gray-400">{c.status?.replace('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className="text-sm font-mono tabular-nums text-white">{value}</div>
    </div>
  );
}

export default CMAPanel;
