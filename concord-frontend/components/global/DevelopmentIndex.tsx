'use client';

/**
 * DevelopmentIndex — a real composite development ranking across countries,
 * computed live from World Bank data. This REPLACES the old "Regions" and
 * "Indicators" tabs, which rendered a hardcoded REGIONS array (fixed index
 * numbers + `Math.random()` sparklines) styled to look like live data next
 * to the genuinely-live World Bank panels — a zero-demo-content violation.
 *
 * Pipeline (100% real, no invented numbers):
 *   1. User picks 2+ indicators (defaults to a balanced basket).
 *   2. For each indicator, fetch `global.choropleth` — latest real value per
 *      country across the World Bank's full reporting set.
 *   3. Feed every (country, indicator) pair into `global.aggregateDashboard`
 *      as `{ domain: countryCode, name: indicatorCode, value, higherIsBetter }`
 *      — the macro's own min-max normalization + composite-index math (the
 *      same engine the "Actions" tab used to leave stranded behind a
 *      never-creatable artifact) produces the ranking, not client arithmetic.
 *
 * `aggregateDashboard` groups metrics by `name` and computes min/max from the
 * ACTUAL fetched values (no invented benchmark), so the score for e.g. Norway
 * is relative to the exact country set that returned data — an honest,
 * reproducible composite, not a fabricated "index".
 */

import { useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, AlertTriangle, TrendingUp, Award } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { INDICATORS, formatIndicatorValue, indicatorLabel } from './indicators';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

const DEFAULT_SELECTED = [
  'NY.GDP.PCAP.CD', 'SP.DYN.LE00.IN', 'SE.ADT.LITR.ZS',
  'IT.NET.USER.ZS', 'SL.UEM.TOTL.ZS', 'EN.ATM.CO2E.PC',
];

interface ChoroplethCountry { code: string; name: string; value: number; year: number; }
interface ChoroplethResult { indicator: string; indicatorName: string; countries: ChoroplethCountry[]; }
interface Breakdown { name: string; raw: number; unit?: string; normalized: number; weight: number; contribution: number; }
interface DomainScore { compositeScore: number; metricCount: number; breakdown: Breakdown[]; grade: string; }
interface DashboardResult {
  totalMetrics: number; domains: number; normalization: string;
  domainScores: Record<string, DomainScore>;
  rankings: { domain: string; compositeScore: number; grade: string; rank: number }[];
  overallComposite: number; overallGrade: string;
  strengths: { domain: string; metric: string; score: number }[];
  weaknesses: { domain: string; metric: string; score: number }[];
}

function gradeColor(grade: string): string {
  if (grade === 'A+' || grade === 'A') return 'text-neon-green bg-neon-green/10 border-neon-green/30';
  if (grade === 'B') return 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/30';
  if (grade === 'C') return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30';
  return 'text-red-400 bg-red-400/10 border-red-400/30';
}

export function DevelopmentIndex() {
  const [selected, setSelected] = useState<string[]>(DEFAULT_SELECTED);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DashboardResult | null>(null);
  const [countryNames, setCountryNames] = useState<Record<string, string>>({});
  const [countrySampleSize, setCountrySampleSize] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  const toggleIndicator = useCallback((code: string) => {
    setSelected((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  }, []);

  const run = useCallback(async () => {
    if (selected.length < 2) { setError('Pick at least 2 indicators.'); return; }
    setLoading(true);
    setError(null);
    setRan(true);
    try {
      const fetched = await Promise.all(
        selected.map((code) => lensRun<ChoroplethResult>('global', 'choropleth', { indicator: code })),
      );
      const names: Record<string, string> = {};
      const metrics: { domain: string; name: string; value: number; higherIsBetter: boolean }[] = [];
      let anyData = false;
      let maxCountries = 0;
      fetched.forEach((r, i) => {
        const code = selected[i];
        if (r.data.ok && r.data.result) {
          anyData = true;
          maxCountries = Math.max(maxCountries, r.data.result.countries.length);
          const meta = INDICATORS.find((x) => x.code === code);
          for (const c of r.data.result.countries) {
            names[c.code] = c.name;
            metrics.push({ domain: c.code, name: code, value: c.value, higherIsBetter: meta?.higherIsBetter !== false });
          }
        }
      });
      setCountryNames(names);
      setCountrySampleSize(maxCountries);
      if (!anyData || metrics.length === 0) {
        setResult(null);
        setError('World Bank returned no data for the selected indicators.');
        setLoading(false);
        return;
      }
      const r2 = await lensRun<DashboardResult>('global', 'aggregateDashboard', {
        metrics,
        normalization: 'min-max',
      });
      if (r2.data.ok && r2.data.result) setResult(r2.data.result);
      else { setResult(null); setError(r2.data.error || 'Could not compute the composite index.'); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  const exportContent = useMemo(() => {
    if (!result) return '';
    return result.rankings
      .map((r) => `${r.rank}. ${countryNames[r.domain] || r.domain} (${r.domain}) — ${r.compositeScore} · grade ${r.grade}`)
      .join('\n');
  }, [result, countryNames]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-3">
        <p className="text-xs text-zinc-400">
          Pick 2+ indicators. Each country&apos;s composite score is min-max normalized across the
          countries that actually reported data for these indicators — the World Bank is the source
          of every number, not an invented benchmark.
        </p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {INDICATORS.map((ind) => {
            const on = selected.includes(ind.code);
            return (
              <button
                key={ind.code}
                type="button"
                onClick={() => toggleIndicator(ind.code)}
                className={cn(
                  'flex items-center justify-between gap-2 rounded border px-2.5 py-1.5 text-left text-xs transition-colors',
                  on ? 'border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan' : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-white',
                )}
              >
                <span className="truncate">{ind.label}</span>
                <span className="shrink-0 font-mono text-[10px] opacity-70">
                  {ind.higherIsBetter === false ? '↓ better' : '↑ better'}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading || selected.length < 2}
          className="flex items-center gap-1.5 rounded-md bg-neon-cyan/15 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/25 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <TrendingUp className="h-4 w-4" />}
          Compute development index ({selected.length} indicators)
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      {!ran && !loading && (
        <div className="rounded border border-zinc-800 bg-zinc-950/30 px-3 py-6 text-center text-xs text-zinc-500">
          Run the index to rank countries from live World Bank data.
        </div>
      )}

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <Award className="h-4 w-4 text-neon-green" />
              <span className="text-sm text-white">
                {result.domains} countries ranked · {result.totalMetrics} data points · {countrySampleSize} max reporting
              </span>
            </div>
            {exportContent && (
              <SaveAsDtuButton
                compact
                apiSource="worldbank"
                apiUrl="https://api.worldbank.org/v2"
                title={`Global development index — ${selected.length} indicators, ${result.domains} countries`}
                content={exportContent}
                extraTags={['global', 'development-index', 'worldbank']}
                rawData={{ selected, rankings: result.rankings }}
              />
            )}
          </div>
          <div className="space-y-1">
            {result.rankings.map((r) => {
              const isOpen = expanded === r.domain;
              const breakdown = result.domainScores[r.domain]?.breakdown || [];
              return (
                <div key={r.domain} className="rounded border border-zinc-800 bg-zinc-950/40">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : r.domain)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left"
                  >
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
                    <span className="w-7 shrink-0 text-right font-mono text-xs text-zinc-500">#{r.rank}</span>
                    <span className="w-12 shrink-0 font-mono text-[10px] text-zinc-400">{r.domain}</span>
                    <span className="flex-1 truncate text-sm text-zinc-100">{countryNames[r.domain] || r.domain}</span>
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-800">
                      <div className="h-full rounded-full bg-neon-cyan" style={{ width: `${r.compositeScore * 100}%` }} />
                    </div>
                    <span className="w-12 text-right font-mono text-xs text-zinc-300">{r.compositeScore.toFixed(3)}</span>
                    <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold', gradeColor(r.grade))}>{r.grade}</span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-zinc-800/60 px-3 py-2 pl-12">
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {breakdown.map((b) => (
                          <div key={b.name} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate text-zinc-400">{indicatorLabel(b.name)}</span>
                            <span className="font-mono text-zinc-200">{formatIndicatorValue(b.raw, b.name)}</span>
                            <span className="font-mono text-neon-cyan">{(b.normalized * 100).toFixed(0)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {(result.strengths.length > 0 || result.weaknesses.length > 0) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-neon-green">Global standouts (highest normalized)</p>
                {result.strengths.map((s, i) => (
                  <div key={i} className="flex justify-between border-b border-white/5 py-1 text-[11px]">
                    <span className="text-zinc-300">{countryNames[s.domain] || s.domain} · {indicatorLabel(s.metric)}</span>
                    <span className="font-mono text-neon-green">{(s.score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-1.5 text-[10px] uppercase tracking-wider text-red-400">Lowest normalized</p>
                {result.weaknesses.map((w, i) => (
                  <div key={i} className="flex justify-between border-b border-white/5 py-1 text-[11px]">
                    <span className="text-zinc-300">{countryNames[w.domain] || w.domain} · {indicatorLabel(w.metric)}</span>
                    <span className="font-mono text-red-400">{(w.score * 100).toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DevelopmentIndex;
