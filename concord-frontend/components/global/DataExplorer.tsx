'use client';

/**
 * DataExplorer — the data-exploration heart of the global lens, parity with
 * Our World in Data / World Bank DataBank. Six purpose-built tools, each
 * wired to a live `global` domain macro backed by the World Bank Open Data
 * API:
 *   - Choropleth   → global.choropleth
 *   - Time series  → global.indicatorTimeseries
 *   - Compare      → global.compareCountries
 *   - Scatter      → global.scatterExplorer
 *   - Catalog      → global.searchIndicators
 *   - Profile      → global.countryProfile
 * Plus saved/shareable views via global.saveView / listViews / deleteView.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Map as MapIcon, LineChart as LineIcon, Columns3, ScatterChart as ScatterIcon,
  Search, Contact, Loader2, AlertTriangle, Bookmark, Trash2, Link2, Play, Copy,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, MapView } from '@/components/viz';
import type { MapMarker } from '@/components/viz';
import { cn } from '@/lib/utils';
import { IndicatorPicker } from './IndicatorPicker';
import { CountryPicker } from './CountryPicker';

type Mode = 'choropleth' | 'timeseries' | 'compare' | 'scatter' | 'catalog' | 'profile';

interface ChoroplethCountry {
  code: string; name: string; year: number; value: number; intensity: number;
  lat: number | null; lon: number | null;
}
interface ChoroplethResult {
  indicator: string; indicatorName: string; countryCount: number;
  min: number; max: number; countries: ChoroplethCountry[]; source: string;
}
interface SeriesPoint { year: number; value: number | null; }
interface TimeseriesResult {
  country: string; countryName: string; indicator: string; indicatorName: string;
  points: SeriesPoint[]; minYear: number; maxYear: number;
  latest: { year: number; value: number }; earliest: { year: number; value: number };
  pctChange: number | null; source: string;
}
interface CompareSeries { code: string; name: string; latest: number | null; earliest: number | null; }
interface CompareResult {
  indicator: string; indicatorName: string; countries: CompareSeries[];
  table: Array<Record<string, number>>; minYear: number; maxYear: number; source: string;
}
interface ScatterPoint { code: string; name: string; x: number; y: number; size: number | null; }
interface ScatterResult {
  indicatorX: string; indicatorY: string; indicatorSize: string | null;
  indicatorXName: string; indicatorYName: string; indicatorSizeName: string | null;
  years: number[]; frames: Array<{ year: number; points: ScatterPoint[] }>; source: string;
}
interface CatalogIndicator {
  code: string; name: string; sourceNote: string; sourceOrg: string; topics: string[];
}
interface CatalogResult { query: string; totalMatches: number; indicators: CatalogIndicator[]; source: string; }
interface ProfileIndicator {
  code: string; name: string; latestValue: number | null; latestYear: number | null;
  trendPct: number | null; spark: SeriesPoint[];
}
interface ProfileResult {
  country: string; countryName: string; indicatorCount: number;
  indicators: ProfileIndicator[]; source: string;
}
interface SavedView {
  id: string; mode: string; label: string;
  config: Record<string, unknown>; createdAt: string;
}

const MODES: { key: Mode; label: string; icon: typeof MapIcon; desc: string }[] = [
  { key: 'choropleth', label: 'World Map', icon: MapIcon, desc: 'Choropleth — one indicator across all countries' },
  { key: 'timeseries', label: 'Time Series', icon: LineIcon, desc: 'One indicator, one country, with a year slider' },
  { key: 'compare', label: 'Compare', icon: Columns3, desc: 'Side-by-side multiple countries' },
  { key: 'scatter', label: 'Scatter', icon: ScatterIcon, desc: 'X vs Y bubble explorer animated over time' },
  { key: 'catalog', label: 'Indicator Catalog', icon: Search, desc: 'Search the full World Bank indicator catalog' },
  { key: 'profile', label: 'Country Profile', icon: Contact, desc: 'All headline indicators for one country' },
];

function fmt(v: number | null | undefined, indicator?: string): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const code = indicator || '';
  if (code.includes('GDP') && Math.abs(v) >= 1e6) {
    if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    return `$${(v / 1e6).toFixed(2)}M`;
  }
  if (code.endsWith('.ZS') || code.endsWith('.ZG')) return `${v.toFixed(2)}%`;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1000) return v.toLocaleString();
  return v.toFixed(2);
}

const PALETTE = ['#06b6d4', '#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#ef4444'];

export function DataExplorer() {
  const [mode, setMode] = useState<Mode>('choropleth');

  // --- per-mode inputs ---
  const [indicator, setIndicator] = useState('NY.GDP.PCAP.CD');
  const [indicatorX, setIndicatorX] = useState('NY.GDP.PCAP.CD');
  const [indicatorY, setIndicatorY] = useState('SP.DYN.LE00.IN');
  const [indicatorSize, setIndicatorSize] = useState('SP.POP.TOTL');
  const [country, setCountry] = useState('USA');
  const [compareCodes, setCompareCodes] = useState<string[]>(['USA', 'CHN', 'IND']);
  const [catalogQuery, setCatalogQuery] = useState('');

  // --- results ---
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choropleth, setChoropleth] = useState<ChoroplethResult | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesResult | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [scatter, setScatter] = useState<ScatterResult | null>(null);
  const [catalog, setCatalog] = useState<CatalogResult | null>(null);
  const [profile, setProfile] = useState<ProfileResult | null>(null);

  // --- year sliders ---
  const [tsYear, setTsYear] = useState<number | null>(null);
  const [scatterFrame, setScatterFrame] = useState(0);

  // --- saved views ---
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshViews = useCallback(async () => {
    const r = await lensRun<{ views: SavedView[] }>('global', 'listViews', {});
    if (r.data.ok && r.data.result) setSavedViews(r.data.result.views || []);
  }, []);

  useEffect(() => {
    void refreshViews();
  }, [refreshViews]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setShareLink(null);
    try {
      if (mode === 'choropleth') {
        const r = await lensRun<ChoroplethResult>('global', 'choropleth', { indicator });
        if (r.data.ok && r.data.result) setChoropleth(r.data.result);
        else { setChoropleth(null); setError(r.data.error || 'No data.'); }
      } else if (mode === 'timeseries') {
        const r = await lensRun<TimeseriesResult>('global', 'indicatorTimeseries', { country, indicator, yearsBack: 40 });
        if (r.data.ok && r.data.result) { setTimeseries(r.data.result); setTsYear(r.data.result.maxYear); }
        else { setTimeseries(null); setError(r.data.error || 'No data.'); }
      } else if (mode === 'compare') {
        if (compareCodes.length < 2) { setError('Pick at least 2 countries.'); setLoading(false); return; }
        const r = await lensRun<CompareResult>('global', 'compareCountries', { countries: compareCodes, indicator, yearsBack: 30 });
        if (r.data.ok && r.data.result) setCompare(r.data.result);
        else { setCompare(null); setError(r.data.error || 'No data.'); }
      } else if (mode === 'scatter') {
        const r = await lensRun<ScatterResult>('global', 'scatterExplorer', {
          indicatorX, indicatorY, indicatorSize: indicatorSize || undefined, yearsBack: 25,
        });
        if (r.data.ok && r.data.result) { setScatter(r.data.result); setScatterFrame(r.data.result.frames.length - 1); }
        else { setScatter(null); setError(r.data.error || 'No data.'); }
      } else if (mode === 'catalog') {
        if (catalogQuery.trim().length < 2) { setError('Enter at least 2 characters.'); setLoading(false); return; }
        const r = await lensRun<CatalogResult>('global', 'searchIndicators', { query: catalogQuery, limit: 40 });
        if (r.data.ok && r.data.result) setCatalog(r.data.result);
        else { setCatalog(null); setError(r.data.error || 'No matches.'); }
      } else if (mode === 'profile') {
        const r = await lensRun<ProfileResult>('global', 'countryProfile', { country });
        if (r.data.ok && r.data.result) setProfile(r.data.result);
        else { setProfile(null); setError(r.data.error || 'No data.'); }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setLoading(false);
    }
  }, [mode, indicator, country, compareCodes, indicatorX, indicatorY, indicatorSize, catalogQuery]);

  // current-view config (for save + share)
  const currentConfig = useMemo<Record<string, unknown>>(() => {
    switch (mode) {
      case 'choropleth': return { indicator };
      case 'timeseries': return { country, indicator, year: tsYear };
      case 'compare': return { countries: compareCodes, indicator };
      case 'scatter': return { indicatorX, indicatorY, indicatorSize };
      case 'catalog': return { query: catalogQuery };
      case 'profile': return { country };
      default: return {};
    }
  }, [mode, indicator, country, tsYear, compareCodes, indicatorX, indicatorY, indicatorSize, catalogQuery]);

  const saveCurrentView = useCallback(async () => {
    const label = `${MODES.find((m) => m.key === mode)?.label}: ${
      mode === 'choropleth' || mode === 'compare' ? indicator
      : mode === 'scatter' ? `${indicatorX} × ${indicatorY}`
      : mode === 'catalog' ? catalogQuery
      : `${country} · ${indicator}`
    }`;
    const r = await lensRun<{ shareLink: string }>('global', 'saveView', {
      view: { mode, label, config: currentConfig },
    });
    if (r.data.ok && r.data.result) {
      setShareLink(r.data.result.shareLink);
      void refreshViews();
    } else {
      setError(r.data.error || 'Could not save view.');
    }
  }, [mode, indicator, indicatorX, indicatorY, catalogQuery, country, currentConfig, refreshViews]);

  const deleteView = useCallback(async (id: string) => {
    const r = await lensRun('global', 'deleteView', { id });
    if (r.data.ok) void refreshViews();
  }, [refreshViews]);

  const applyView = useCallback((v: SavedView) => {
    const c = v.config || {};
    setMode(v.mode as Mode);
    if (typeof c.indicator === 'string') setIndicator(c.indicator);
    if (typeof c.indicatorX === 'string') setIndicatorX(c.indicatorX);
    if (typeof c.indicatorY === 'string') setIndicatorY(c.indicatorY);
    if (typeof c.indicatorSize === 'string') setIndicatorSize(c.indicatorSize);
    if (typeof c.country === 'string') setCountry(c.country);
    if (Array.isArray(c.countries)) setCompareCodes(c.countries as string[]);
    if (typeof c.query === 'string') setCatalogQuery(c.query);
  }, []);

  const copyShareLink = useCallback(() => {
    if (!shareLink) return;
    const full = typeof window !== 'undefined' ? `${window.location.origin}${shareLink}` : shareLink;
    void navigator.clipboard?.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [shareLink]);

  // --- derived render data ---
  const choroMarkers = useMemo<MapMarker[]>(() => {
    if (!choropleth) return [];
    return choropleth.countries
      .filter((c) => c.lat != null && c.lon != null)
      .map((c) => ({
        id: c.code,
        lat: c.lat as number,
        lon: c.lon as number,
        label: `${c.name} · ${fmt(c.value, choropleth.indicator)}`,
        value: c.intensity,
      }));
  }, [choropleth]);

  const tsChartData = useMemo(() => {
    if (!timeseries) return [];
    return timeseries.points
      .filter((p) => p.value != null && (tsYear == null || p.year <= tsYear))
      .map((p) => ({ year: p.year, value: p.value }));
  }, [timeseries, tsYear]);

  const scatterChartData = useMemo(() => {
    if (!scatter || !scatter.frames[scatterFrame]) return [];
    return scatter.frames[scatterFrame].points.map((p) => ({
      x: p.x, y: p.y, code: p.code, name: p.name, size: p.size,
    }));
  }, [scatter, scatterFrame]);

  return (
    <div className="space-y-4">
      {/* mode selector */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {MODES.map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.key}
              type="button"
              onClick={() => { setMode(m.key); setError(null); }}
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-colors',
                mode === m.key
                  ? 'border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan'
                  : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:border-zinc-700 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="text-xs font-medium">{m.label}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-zinc-500">{MODES.find((m) => m.key === mode)?.desc}</p>

      {/* per-mode controls */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-3">
        {(mode === 'choropleth' || mode === 'compare') && (
          <IndicatorPicker label="Indicator" value={indicator} onChange={setIndicator} />
        )}
        {mode === 'timeseries' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <CountryPicker label="Country" value={country} onChange={setCountry} />
            <IndicatorPicker label="Indicator" value={indicator} onChange={setIndicator} />
          </div>
        )}
        {mode === 'compare' && (
          <CountryPicker label="Countries (2–6)" value={compareCodes} multi max={6} onChangeMulti={setCompareCodes} />
        )}
        {mode === 'scatter' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <IndicatorPicker label="X axis" value={indicatorX} onChange={setIndicatorX} />
            <IndicatorPicker label="Y axis" value={indicatorY} onChange={setIndicatorY} />
            <IndicatorPicker label="Bubble size" value={indicatorSize} onChange={setIndicatorSize} />
          </div>
        )}
        {mode === 'catalog' && (
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-zinc-500">Search the World Bank catalog</span>
            <input
              value={catalogQuery}
              onChange={(e) => setCatalogQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
              placeholder="e.g. carbon, mortality, internet, forest"
              className="w-full rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
            />
          </label>
        )}
        {mode === 'profile' && (
          <CountryPicker label="Country" value={country} onChange={setCountry} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md bg-neon-cyan/15 px-3 py-1.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/25 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run query
          </button>
          <button
            type="button"
            onClick={() => void saveCurrentView()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-500 disabled:opacity-50"
          >
            <Bookmark className="h-4 w-4" /> Save view
          </button>
          {shareLink && (
            <button
              type="button"
              onClick={copyShareLink}
              className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-300"
            >
              {copied ? <Copy className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {copied ? 'Copied!' : 'Copy share link'}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      {/* ---- CHOROPLETH ---- */}
      {mode === 'choropleth' && choropleth && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">{choropleth.indicatorName}</h3>
            <span className="text-xs text-zinc-500">{choropleth.countryCount} countries · {choropleth.source}</span>
          </div>
          <MapView markers={choroMarkers} height={340} />
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>low · {fmt(choropleth.min, choropleth.indicator)}</span>
            <div className="mx-3 h-2 flex-1 rounded-full bg-gradient-to-r from-[rgb(30,200,220)] to-[rgb(255,80,60)]" />
            <span>high · {fmt(choropleth.max, choropleth.indicator)}</span>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {choropleth.countries.slice(0, 60).map((c, i) => (
              <div key={c.code} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-[11px]">
                <span className="w-6 text-right font-mono text-zinc-600">{i + 1}</span>
                <span className="w-12 font-mono text-zinc-500">{c.code}</span>
                <span className="flex-1 truncate text-zinc-200">{c.name}</span>
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-neon-cyan" style={{ width: `${c.intensity * 100}%` }} />
                </div>
                <span className="w-20 text-right font-mono text-neon-cyan">{fmt(c.value, choropleth.indicator)}</span>
                <span className="w-10 text-right font-mono text-zinc-600">{c.year}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---- TIME SERIES ---- */}
      {mode === 'timeseries' && timeseries && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">
              {timeseries.indicatorName} — {timeseries.countryName}
            </h3>
            <span className="text-xs text-zinc-500">{timeseries.source}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Latest ({timeseries.latest.year})</div>
              <div className="mt-0.5 font-mono text-lg text-neon-cyan">{fmt(timeseries.latest.value, timeseries.indicator)}</div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Earliest ({timeseries.earliest.year})</div>
              <div className="mt-0.5 font-mono text-lg text-zinc-300">{fmt(timeseries.earliest.value, timeseries.indicator)}</div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Change</div>
              <div className={cn('mt-0.5 font-mono text-lg', (timeseries.pctChange ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                {timeseries.pctChange == null ? '—' : `${timeseries.pctChange > 0 ? '+' : ''}${timeseries.pctChange}%`}
              </div>
            </div>
          </div>
          <ChartKit
            kind="area"
            data={tsChartData}
            xKey="year"
            series={[{ key: 'value', label: timeseries.indicatorName, color: '#06b6d4' }]}
            height={260}
          />
          {tsYear != null && (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>Year cutoff</span>
                <span className="font-mono text-neon-cyan">{tsYear}</span>
              </div>
              <input
                type="range"
                min={timeseries.minYear}
                max={timeseries.maxYear}
                value={tsYear}
                onChange={(e) => setTsYear(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>
          )}
        </div>
      )}

      {/* ---- COMPARE ---- */}
      {mode === 'compare' && compare && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">{compare.indicatorName}</h3>
            <span className="text-xs text-zinc-500">{compare.minYear}–{compare.maxYear} · {compare.source}</span>
          </div>
          <ChartKit
            kind="line"
            data={compare.table}
            xKey="year"
            series={compare.countries.map((c, i) => ({ key: c.code, label: c.name, color: PALETTE[i % PALETTE.length] }))}
            height={280}
          />
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {compare.countries.map((c, i) => {
              const delta = c.latest != null && c.earliest != null && c.earliest !== 0
                ? ((c.latest - c.earliest) / Math.abs(c.earliest)) * 100 : null;
              return (
                <div key={c.code} className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
                    <span className="flex-1 truncate text-sm text-zinc-100">{c.name}</span>
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="font-mono text-lg text-white">{fmt(c.latest, compare.indicator)}</span>
                    {delta != null && (
                      <span className={cn('font-mono text-xs', delta >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- SCATTER ---- */}
      {mode === 'scatter' && scatter && scatter.frames[scatterFrame] && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">
              {scatter.indicatorXName} <span className="text-zinc-500">vs</span> {scatter.indicatorYName}
            </h3>
            <span className="text-xs text-zinc-500">
              {scatter.frames[scatterFrame].points.length} countries · {scatter.source}
            </span>
          </div>
          <ChartKit
            kind="scatter"
            data={scatterChartData}
            xKey="x"
            series={[{ key: 'y', label: scatter.indicatorYName, color: '#a855f7' }]}
            height={300}
            showLegend={false}
          />
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-zinc-500">
              <span>Year</span>
              <span className="font-mono text-neon-purple">{scatter.years[scatterFrame]}</span>
            </div>
            <input
              type="range"
              min={0}
              max={scatter.frames.length - 1}
              value={scatterFrame}
              onChange={(e) => setScatterFrame(Number(e.target.value))}
              className="w-full accent-purple-400"
            />
            <div className="flex justify-between text-[10px] font-mono text-zinc-600">
              <span>{scatter.years[0]}</span>
              <span>{scatter.years[scatter.years.length - 1]}</span>
            </div>
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {[...scatter.frames[scatterFrame].points]
              .sort((a, b) => b.x - a.x)
              .slice(0, 40)
              .map((p) => (
                <div key={p.code} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-[11px]">
                  <span className="w-12 font-mono text-zinc-500">{p.code}</span>
                  <span className="flex-1 truncate text-zinc-200">{p.name}</span>
                  <span className="font-mono text-cyan-300">x {fmt(p.x, scatter.indicatorX)}</span>
                  <span className="font-mono text-purple-300">y {fmt(p.y, scatter.indicatorY)}</span>
                  {p.size != null && <span className="font-mono text-zinc-500">{fmt(p.size, scatter.indicatorSize || '')}</span>}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ---- CATALOG ---- */}
      {mode === 'catalog' && catalog && (
        <div className="space-y-2">
          <p className="text-xs text-zinc-500">
            {catalog.totalMatches} indicators match &quot;{catalog.query}&quot; · {catalog.source}
          </p>
          {catalog.indicators.map((ind) => (
            <div key={ind.code} className="rounded border border-zinc-800 bg-zinc-950/40 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-100">{ind.name}</p>
                  <p className="font-mono text-[10px] text-neon-cyan">{ind.code}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setIndicator(ind.code); setMode('choropleth'); }}
                  className="shrink-0 rounded border border-neon-cyan/30 px-2 py-0.5 text-[10px] text-neon-cyan hover:bg-neon-cyan/10"
                >
                  Map it
                </button>
              </div>
              {ind.sourceNote && <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">{ind.sourceNote}</p>}
              {ind.topics.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {ind.topics.map((t) => (
                    <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">{t}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ---- PROFILE ---- */}
      {mode === 'profile' && profile && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">{profile.countryName} — country profile</h3>
            <span className="text-xs text-zinc-500">{profile.indicatorCount} indicators · {profile.source}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {profile.indicators.map((ind) => {
              const min = ind.spark.length ? Math.min(...ind.spark.map((s) => s.value ?? 0)) : 0;
              const max = ind.spark.length ? Math.max(...ind.spark.map((s) => s.value ?? 0)) : 1;
              const range = max - min || 1;
              return (
                <div key={ind.code} className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
                  <p className="text-xs text-zinc-400">{ind.name}</p>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className="font-mono text-lg text-white">{fmt(ind.latestValue, ind.code)}</span>
                    {ind.trendPct != null && (
                      <span className={cn('font-mono text-xs', ind.trendPct >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                        {ind.trendPct > 0 ? '+' : ''}{ind.trendPct}%
                      </span>
                    )}
                  </div>
                  {ind.spark.length > 1 && (
                    <svg viewBox={`0 0 ${ind.spark.length * 8} 28`} className="mt-1 h-8 w-full" preserveAspectRatio="none">
                      <polyline
                        fill="none"
                        stroke="#06b6d4"
                        strokeWidth={1.4}
                        points={ind.spark
                          .map((s, i) => `${i * 8},${28 - ((s.value ?? 0) - min) / range * 24 - 2}`)
                          .join(' ')}
                      />
                    </svg>
                  )}
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{ind.latestYear ?? '—'}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ---- SAVED VIEWS ---- */}
      {savedViews.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
            <Bookmark className="h-3.5 w-3.5" /> Saved views ({savedViews.length})
          </h4>
          <div className="space-y-1">
            {savedViews.map((v) => (
              <div key={v.id} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => applyView(v)}
                  className="flex-1 truncate text-left text-[11px] text-zinc-200 hover:text-neon-cyan"
                >
                  {v.label}
                </button>
                <span className="font-mono text-[10px] text-zinc-600">
                  {new Date(v.createdAt).toLocaleDateString()}
                </span>
                <button
                  type="button"
                  onClick={() => void deleteView(v.id)}
                  className="text-zinc-600 hover:text-rose-400"
                  aria-label="Delete view"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default DataExplorer;
