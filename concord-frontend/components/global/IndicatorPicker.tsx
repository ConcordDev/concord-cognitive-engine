'use client';

/**
 * IndicatorPicker — choose a World Bank indicator code. Offers a curated
 * shortlist of popular indicators plus a live search against the full
 * World Bank catalog via the `global.searchIndicators` macro.
 */

import { useCallback, useRef, useState } from 'react';
import { Search, Loader2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface CatalogIndicator { code: string; name: string; sourceOrg: string; }

export const POPULAR_INDICATORS: { code: string; label: string }[] = [
  { code: 'NY.GDP.MKTP.CD', label: 'GDP (US$)' },
  { code: 'NY.GDP.PCAP.CD', label: 'GDP per capita (US$)' },
  { code: 'SP.POP.TOTL', label: 'Population' },
  { code: 'SP.DYN.LE00.IN', label: 'Life expectancy' },
  { code: 'SE.ADT.LITR.ZS', label: 'Literacy rate %' },
  { code: 'IT.NET.USER.ZS', label: 'Internet users %' },
  { code: 'SL.UEM.TOTL.ZS', label: 'Unemployment %' },
  { code: 'FP.CPI.TOTL.ZG', label: 'Inflation %' },
  { code: 'SP.URB.TOTL.IN.ZS', label: 'Urban population %' },
  { code: 'EN.ATM.CO2E.PC', label: 'CO2 emissions per capita' },
  { code: 'SH.DYN.MORT', label: 'Under-5 mortality' },
  { code: 'EG.ELC.ACCS.ZS', label: 'Access to electricity %' },
];

export function IndicatorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (code: string) => void;
}) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogIndicator[]>([]);
  const [loading, setLoading] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const known = POPULAR_INDICATORS.find((p) => p.code === value);

  const search = useCallback((q: string) => {
    setQuery(q);
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      const r = await lensRun<{ indicators: CatalogIndicator[] }>('global', 'searchIndicators', { query: q, limit: 25 });
      if (r.data.ok && r.data.result) setResults(r.data.result.indicators || []);
      else setResults([]);
      setLoading(false);
    }, 350);
  }, []);

  return (
    <div className="space-y-1">
      <span className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</span>
      <div className="flex gap-2">
        <select
          value={known ? value : '__custom__'}
          onChange={(e) => { if (e.target.value !== '__custom__') onChange(e.target.value); }}
          className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
        >
          {POPULAR_INDICATORS.map((p) => (
            <option key={p.code} value={p.code}>{p.label}</option>
          ))}
          {!known && <option value="__custom__">{value}</option>}
        </select>
        <button
          type="button"
          onClick={() => setSearching((s) => !s)}
          className={cn(
            'shrink-0 rounded border px-2 py-1.5 transition-colors',
            searching ? 'border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan' : 'border-zinc-700 text-zinc-400 hover:text-white',
          )}
          aria-label="Search catalog"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>
      {searching && (
        <div className="rounded border border-zinc-800 bg-zinc-950/80 p-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-600" />
            <input
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Search the full World Bank catalog…"
              className="w-full rounded border border-zinc-700 bg-zinc-900 py-1.5 pl-7 pr-2 text-xs text-zinc-100"
            />
          </div>
          {loading && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-400">
              <Loader2 className="h-3 w-3 animate-spin" /> Searching catalog…
            </div>
          )}
          {results.length > 0 && (
            <div className="mt-2 max-h-44 space-y-0.5 overflow-y-auto">
              {results.map((ind) => (
                <button
                  key={ind.code}
                  type="button"
                  onClick={() => { onChange(ind.code); setSearching(false); setQuery(''); setResults([]); }}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[11px] hover:bg-zinc-800"
                >
                  {ind.code === value && <Check className="h-3 w-3 text-neon-cyan" />}
                  <span className="flex-1 truncate text-zinc-200">{ind.name}</span>
                  <span className="font-mono text-[10px] text-neon-cyan">{ind.code}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default IndicatorPicker;
