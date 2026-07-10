'use client';

/**
 * RegionStatsTool — structured geo-economic comparator for the atlas
 * lens's Tools tab. Wires the previously-UNSURFACED `atlas.regionStats`
 * macro (a real, stateless calculator: totals, weighted averages,
 * population Gini coefficient, per-metric rankings, GDP-per-capita
 * income tiers) behind a proper row editor instead of a raw-JSON paste.
 *
 * Backend: atlas.regionStats — pure computation over caller-supplied
 * region rows (no persistence, no external I/O). This was previously
 * reachable ONLY through a dead "Atlas Compute Actions" button that
 * targeted a `useLensData('atlas','location')` artifact nothing in the
 * app ever creates — so the button silently no-opped on every click.
 * That dead panel has been retired; this is the real, working surface.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BarChart3, Loader2, Globe2 } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { StructuredArrayEditor, type ColumnSpec } from '@/components/panel-polish';

interface RegionRow { name: string; population: number; area: number; gdp: number; growth: number }

interface RegionStatsResult {
  regionCount: number;
  totals: { population: number; area: number; gdp: number };
  averages: { population: number; density: number; gdpPerCapita: number; growthRate: number };
  distribution: { populationStdDev: number; populationGini: number; concentration: string };
  rankings: { byPopulation: Array<{ rank: number; name: string; value: number }>; byGdp: Array<{ rank: number; name: string; value: number }> };
  incomeTiers: Array<{ name: string; gdpPerCapita: number; tier: string }>;
  message?: string;
}

const COLS: ColumnSpec<RegionRow>[] = [
  { key: 'name', label: 'Region', type: 'text', flex: 2 },
  { key: 'population', label: 'Population', type: 'number', width: '7rem' },
  { key: 'area', label: 'Area (km²)', type: 'number', width: '7rem' },
  { key: 'gdp', label: 'GDP ($)', type: 'number', width: '8rem' },
  { key: 'growth', label: 'Growth %', type: 'number', width: '6rem', step: 0.1 },
];

const TIER_STYLE: Record<string, string> = {
  'high-income': 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
  'upper-middle': 'text-lime-300 border-lime-500/30 bg-lime-500/10',
  'lower-middle': 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  'low-income': 'text-rose-300 border-rose-500/30 bg-rose-500/10',
};

export function RegionStatsTool() {
  const [regions, setRegions] = useState<RegionRow[]>([]);

  const compute = useMutation({
    mutationFn: async () => {
      const valid = regions.filter((r) => r.name.trim());
      if (valid.length === 0) return null;
      const r = await apiHelpers.lens.runDomain('atlas', 'regionStats', { input: { artifact: { data: { regions: valid } } } });
      const env = (r as { data?: { ok: boolean; result?: { result?: RegionStatsResult } & RegionStatsResult } }).data;
      if (!env?.ok) return null;
      const raw = env.result;
      return (raw && 'result' in raw && raw.result ? raw.result : raw) as RegionStatsResult | null;
    },
  });

  const result = compute.data;

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-lime-400" />
          <span className="text-sm font-semibold text-white">Region comparator</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">atlas.regionStats</span>
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">Compare regions by population, area, GDP and growth — rankings, income tiers, and a population concentration (Gini) index.</p>
      </div>

      <div className="space-y-3 p-3">
        <StructuredArrayEditor<RegionRow>
          value={regions}
          onChange={setRegions}
          template={{ name: '', population: 0, area: 0, gdp: 0, growth: 0 }}
          columns={COLS}
          accent="lime"
          maxRows={20}
          rowsOnly
        />
        <button
          type="button"
          onClick={() => compute.mutate()}
          disabled={compute.isPending || regions.filter((r) => r.name.trim()).length === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-lime-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-lime-400 disabled:opacity-50"
        >
          {compute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
          Compare regions
        </button>

        {compute.isError && <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">Comparison failed.</div>}
        {!result && !compute.isPending && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">
            No data yet. Add at least one region above, then compare.
          </div>
        )}
        {result?.message && <div className="text-[11px] text-zinc-400">{result.message}</div>}
        {result && result.regionCount > 0 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Regions" value={String(result.regionCount)} />
              <Stat label="Total pop." value={result.totals.population.toLocaleString()} />
              <Stat label="Total GDP" value={`$${result.totals.gdp.toLocaleString()}`} />
              <Stat label="Avg growth" value={`${result.averages.growthRate}%`} />
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">Population distribution</div>
              <div className="mt-1 text-[11px] text-zinc-200">
                Gini {result.distribution.populationGini} · <span className="capitalize">{result.distribution.concentration.replace('-', ' ')}</span> · σ {result.distribution.populationStdDev.toLocaleString()}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <RankList title="By population" rows={result.rankings.byPopulation} suffix="" />
              <RankList title="By GDP" rows={result.rankings.byGdp} suffix="" prefix="$" />
            </div>
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">Income tiers (GDP per capita)</div>
              {result.incomeTiers.map((t) => (
                <div key={t.name} className={`flex items-center justify-between rounded border px-2.5 py-1.5 text-[11px] ${TIER_STYLE[t.tier] || TIER_STYLE['low-income']}`}>
                  <span>{t.name}</span>
                  <span className="font-mono">${t.gdpPerCapita.toLocaleString()} · <span className="capitalize">{t.tier.replace('-', ' ')}</span></span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-center">
      <p className="font-mono text-sm text-white">{value}</p>
      <p className="text-[9px] text-zinc-400">{label}</p>
    </div>
  );
}

function RankList({ title, rows, prefix = '', suffix = '' }: { title: string; rows: Array<{ rank: number; name: string; value: number }>; prefix?: string; suffix?: string }) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{title}</div>
      {rows.slice(0, 8).map((r) => (
        <div key={r.name} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[11px]">
          <span className="text-zinc-300">{r.rank}. {r.name}</span>
          <span className="font-mono text-zinc-100">{prefix}{r.value.toLocaleString()}{suffix}</span>
        </div>
      ))}
    </div>
  );
}
