'use client';

/**
 * IndicatorCorrelations — real cross-country correlation between World Bank
 * indicators (e.g. "does internet access correlate with life expectancy
 * across countries?"), the Our World in Data "correlates" idiom.
 *
 * Pipeline (100% real):
 *   1. User picks 2-6 indicators.
 *   2. `global.choropleth` fetches each indicator's latest real value per
 *      country.
 *   3. The set of countries is intersected across all chosen indicators (so
 *      every variable has a value for the same country in the same slot —
 *      required for a valid correlation).
 *   4. `global.correlationMatrix` computes real Pearson + Spearman
 *      correlation, significance, and collinearity — no client-side math.
 *
 * This surfaces `global.correlationMatrix`, which previously only ran
 * against a "global-dataset" artifact that no UI path could ever create
 * (see the removed Actions tab) — it now runs against real, live data.
 */

import { useCallback, useState } from 'react';
import { GitBranch, Loader2, AlertTriangle, Sparkles } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { INDICATORS } from './indicators';

const DEFAULT_SELECTED = ['NY.GDP.PCAP.CD', 'SP.DYN.LE00.IN', 'IT.NET.USER.ZS'];
const MAX_INDICATORS = 6;

interface ChoroplethCountry { code: string; name: string; value: number; }
interface ChoroplethResult { countries: ChoroplethCountry[]; }
interface SigPair { var1: string; var2: string; pearson: number; spearman: number; strength: string; direction: string; pValue: number; }
interface CorrelationResult {
  variables: number; observations: number; method: string;
  significantCount: number;
  significantCorrelations: SigPair[];
  unexpectedRelationships: SigPair[];
  collinearGroups: string[][];
  variableStatistics: { name: string; mean: number; std: number; min: number; max: number }[];
}

export function IndicatorCorrelations() {
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTED);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CorrelationResult | null>(null);
  const [sampleN, setSampleN] = useState(0);

  const toggle = useCallback((code: string) => {
    setSelected((prev) => {
      if (prev.includes(code)) return prev.filter((c) => c !== code);
      if (prev.length >= MAX_INDICATORS) return prev;
      return [...prev, code];
    });
  }, []);

  const run = useCallback(async () => {
    if (selected.length < 2) { setError('Pick at least 2 indicators.'); return; }
    setLoading(true);
    setError(null);
    try {
      const fetched = await Promise.all(
        selected.map((code) => lensRun<ChoroplethResult>('global', 'choropleth', { indicator: code })),
      );
      const perIndicator = fetched.map((r) => {
        const m = new Map<string, number>();
        if (r.data.ok && r.data.result) for (const c of r.data.result.countries) m.set(c.code, c.value);
        return m;
      });
      if (perIndicator.some((m) => m.size === 0)) {
        setResult(null);
        setError('One of the selected indicators returned no World Bank data.');
        setLoading(false);
        return;
      }
      const commonCodes = [...perIndicator[0].keys()].filter((code) => perIndicator.every((m) => m.has(code)));
      if (commonCodes.length < 3) {
        setResult(null);
        setError(`Only ${commonCodes.length} countries report all selected indicators — need at least 3 overlapping observations.`);
        setLoading(false);
        return;
      }
      setSampleN(commonCodes.length);
      const variables = selected.map((code, i) => ({
        name: INDICATORS.find((x) => x.code === code)?.label || code,
        domain: 'worldbank',
        values: commonCodes.map((cc) => perIndicator[i].get(cc) as number),
      }));
      const r2 = await lensRun<CorrelationResult>('global', 'correlationMatrix', { variables, method: 'both' });
      if (r2.data.ok && r2.data.result) setResult(r2.data.result);
      else { setResult(null); setError(r2.data.error || 'Could not compute correlations.'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-3">
        <p className="text-xs text-zinc-400">
          Pick 2–{MAX_INDICATORS} indicators. Correlation is computed across the countries that
          report every selected indicator — real Pearson &amp; Spearman coefficients, not a guess.
        </p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {INDICATORS.map((ind) => {
            const on = selected.includes(ind.code);
            const disabled = !on && selected.length >= MAX_INDICATORS;
            return (
              <button
                key={ind.code}
                type="button"
                onClick={() => toggle(ind.code)}
                disabled={disabled}
                className={cn(
                  'truncate rounded border px-2.5 py-1.5 text-left text-xs transition-colors',
                  on ? 'border-neon-purple/40 bg-neon-purple/10 text-neon-purple' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-white',
                  disabled && 'opacity-30',
                )}
              >
                {ind.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading || selected.length < 2}
          className="flex items-center gap-1.5 rounded-md bg-neon-purple/15 px-3 py-1.5 text-sm font-medium text-neon-purple transition-colors hover:bg-neon-purple/25 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}
          Compute correlations ({selected.length} indicators)
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: 'Indicators', value: result.variables },
              { label: 'Countries (overlap)', value: sampleN || result.observations },
              { label: 'Significant pairs', value: result.significantCount },
              { label: 'Collinear groups', value: result.collinearGroups.length },
            ].map(({ label, value }) => (
              <div key={label} className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-center">
                <p className="text-lg font-bold text-white">{value}</p>
                <p className="text-[10px] text-zinc-400">{label}</p>
              </div>
            ))}
          </div>

          {result.significantCorrelations.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-zinc-400">Significant correlations (p &lt; 0.05, |r| &gt; 0.3)</p>
              {result.significantCorrelations.map((pair, i) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">{pair.var1} &harr; {pair.var2}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-[10px]', pair.direction === 'positive' ? 'bg-neon-green/10 text-neon-green' : 'bg-red-400/10 text-red-400')}>
                    {pair.direction}
                  </span>
                  <span className="text-[10px] text-zinc-400">{pair.strength}</span>
                  <span className="font-mono text-xs text-neon-purple">r={pair.pearson}</span>
                </div>
              ))}
            </div>
          )}

          {result.unexpectedRelationships.length === 0 && result.significantCorrelations.length === 0 && (
            <p className="text-xs italic text-zinc-500">No statistically significant correlations among these indicators in this country set.</p>
          )}

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-400">
              <Sparkles className="h-3 w-3" /> Variable statistics
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {result.variableStatistics.map((v) => (
                <div key={v.name} className="rounded border border-zinc-800 bg-zinc-950/40 p-2 text-[11px]">
                  <p className="truncate font-medium text-white">{v.name}</p>
                  <div className="mt-1 flex justify-between text-zinc-400">
                    <span>mean <span className="text-zinc-200">{v.mean.toLocaleString()}</span></span>
                    <span>std <span className="text-zinc-200">{v.std.toLocaleString()}</span></span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {result.collinearGroups.length > 0 && (
            <div className="rounded border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-[11px] text-yellow-300">
              Collinear (|r| &ge; 0.85): {result.collinearGroups.map((g) => g.join(' = ')).join(' · ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default IndicatorCorrelations;
