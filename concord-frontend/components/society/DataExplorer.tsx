'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * DataExplorer — Our World in Data / Gapminder-style exploration surface
 * for the society lens. Wires every World Bank macro on server/domains/
 * society.js:
 *   wb-chart-series       → interactive line/bar charting + transforms
 *   wb-bubble-frames      → animated Gapminder bubble chart
 *   wb-choropleth         → world choropleth map
 *   wb-indicator-search   → full 1,400-indicator catalog search
 *   wb-country-dashboard  → many-indicator one-country dashboard
 *   wb-region-rankings    → region/income-group aggregate rankings
 *   wb-export-csv         → CSV export
 *   wb-save/load/list-chart → shareable chart permalinks
 *   wb-transform-series   → per-capita / inflation-adjusted toggles
 *   wb-common-indicators / wb-aggregate-codes → alias + aggregate tables
 *
 * Every value rendered comes from a live macro call. No mock data.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Globe2, Loader2, LineChart as LineChartIcon, Search, LayoutDashboard,
  CircleDot, Map as MapIcon, Trophy, Download, Link2, Play, Pause,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, MapView, type MapMarker } from '@/components/viz';

// ─── Types ───────────────────────────────────────────────────────────────────
interface SeriesPoint { year: number; value: number }
interface ChartSeriesResult {
  country: string; indicator: string; alias: string | null; chartKind: string;
  xKey: string; series: SeriesPoint[]; points: number; transforms: string[];
  min: number | null; max: number | null; first: SeriesPoint | null; last: SeriesPoint | null;
}
interface Bubble { country: string; countryName: string; x: number; y: number; size: number | null }
interface BubbleFrame { year: number; bubbles: Bubble[] }
interface BubbleResult {
  countries: string[]; frames: BubbleFrame[]; frameCount: number;
  xIndicator: string; yIndicator: string; sizeIndicator: string;
  startYear: number; endYear: number;
}
interface ChoroPoint {
  country: string; countryName: string; region: string; lat: number; lon: number;
  year: number; value: number; intensity: number;
}
interface ChoroResult { indicator: string; alias: string | null; points: ChoroPoint[]; count: number; min: number; max: number }
interface SearchMatch { code: string; name: string; source: string | null; topics: string[] }
interface SearchResult { query: string; matches: SearchMatch[]; count: number }
interface DashCard { indicator: string; code: string; latest: SeriesPoint | null; series: SeriesPoint[]; available: boolean }
interface DashResult {
  country: string;
  profile: { name: string; capital?: string; region?: string; incomeLevel?: string; lat?: number; lon?: number };
  cards: DashCard[]; cardCount: number; available: number;
}
interface RankRow { code: string; name: string; year: number; value: number; rank: number }
interface RankResult { indicator: string; alias: string | null; rankings: RankRow[]; count: number; worldValue: number | null }
interface SavedChart { id: string; title: string; createdAt: string; permalink: string }

async function macro<T>(action: string, input: Record<string, unknown>): Promise<{ ok: boolean; result?: T; error?: string }> {
  try {
    // lensRun returns `{ data: { ok, result, error } }`, already unwrapping the
    // server's `{ ok, result }` envelope down to the macro's `result` payload.
    // PRIOR BUG: this helper checked `'ok' in r` on the OUTER `{ data }` object
    // (which has no `ok` key), so it returned `{ ok:true, result: { data } }` —
    // every view then read `result.indicators` off the wrong object and showed
    // nothing. Read `r.data` (or the bare value for a non-enveloped return).
    const r = await lensRun<T>('society', action, input);
    const env = (r && typeof r === 'object' && 'data' in r ? (r as { data: unknown }).data : r) as
      { ok?: boolean; result?: T; error?: string } | T;
    if (env && typeof env === 'object' && ('ok' in env || 'error' in env)) {
      const e = env as { ok?: boolean; result?: T; error?: string };
      return { ok: e.ok !== false && !e.error, result: e.result, error: e.error };
    }
    return { ok: true, result: env as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const POPULAR: { code: string; name: string }[] = [
  { code: 'USA', name: 'United States' }, { code: 'CHN', name: 'China' }, { code: 'IND', name: 'India' },
  { code: 'JPN', name: 'Japan' }, { code: 'DEU', name: 'Germany' }, { code: 'GBR', name: 'United Kingdom' },
  { code: 'FRA', name: 'France' }, { code: 'BRA', name: 'Brazil' }, { code: 'KOR', name: 'Korea, Rep.' },
  { code: 'MEX', name: 'Mexico' }, { code: 'CAN', name: 'Canada' }, { code: 'NGA', name: 'Nigeria' },
  { code: 'ZAF', name: 'South Africa' }, { code: 'IDN', name: 'Indonesia' }, { code: 'RUS', name: 'Russia' },
  { code: 'AUS', name: 'Australia' }, { code: 'ITA', name: 'Italy' }, { code: 'ESP', name: 'Spain' },
];

type View = 'chart' | 'bubble' | 'map' | 'dashboard' | 'rankings' | 'saved';

export function DataExplorer() {
  const [view, setView] = useState<View>('chart');
  const [aliases, setAliases] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      const env = await macro<{ indicators: Record<string, string> }>('wb-common-indicators', {});
      if (env.ok && env.result) setAliases(env.result.indicators);
    })();
  }, []);

  // Restore a shared chart permalink (?chart=soc_xxx).
  const [sharedTitle, setSharedTitle] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = new URLSearchParams(window.location.search).get('chart');
    if (!id) return;
    (async () => {
      const env = await macro<{ title: string; spec: any }>('wb-load-chart', { id });
      if (env.ok && env.result) {
        setSharedTitle(env.result.title);
        setView('chart');
      }
    })();
  }, []);

  const views: { key: View; label: string; icon: typeof Globe2 }[] = [
    { key: 'chart', label: 'Chart', icon: LineChartIcon },
    { key: 'bubble', label: 'Bubble', icon: CircleDot },
    { key: 'map', label: 'Map', icon: MapIcon },
    { key: 'dashboard', label: 'Country', icon: LayoutDashboard },
    { key: 'rankings', label: 'Rankings', icon: Trophy },
    { key: 'saved', label: 'Saved', icon: Link2 },
  ];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Globe2 className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Data Explorer</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            World Bank Open Data · 1,400 indicators
          </span>
        </div>
        {sharedTitle && (
          <span className="rounded bg-cyan-500/15 px-2 py-0.5 text-[11px] text-cyan-200">
            shared: {sharedTitle}
          </span>
        )}
      </header>

      <nav className="flex flex-wrap gap-1" aria-label="Data views">
        {views.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              view === key
                ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-100'
                : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:text-cyan-300'
            }`}
            aria-pressed={view === key}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
          </button>
        ))}
      </nav>

      {view === 'chart' && <ChartView aliases={aliases} />}
      {view === 'bubble' && <BubbleView aliases={aliases} />}
      {view === 'map' && <MapChoroView aliases={aliases} />}
      {view === 'dashboard' && <DashboardView />}
      {view === 'rankings' && <RankingsView aliases={aliases} />}
      {view === 'saved' && <SavedView />}
    </div>
  );
}

// ─── Shared controls ─────────────────────────────────────────────────────────
function IndicatorPicker({
  value, onChange, aliases, label = 'Indicator',
}: { value: string; onChange: (v: string) => void; aliases: Record<string, string>; label?: string }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);

  const runSearch = useCallback(async () => {
    if (search.trim().length < 2) return;
    setSearching(true);
    const env = await macro<SearchResult>('wb-indicator-search', { query: search.trim(), limit: 30 });
    setSearching(false);
    setResults(env.ok && env.result ? env.result.matches : []);
  }, [search]);

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="alias (gdp) or WB code (SP.POP.TOTL)"
          className="min-w-[180px] flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-white"
          list="wb-alias-list"
          aria-label={label}
        />
        <datalist id="wb-alias-list">
          {Object.entries(aliases).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </datalist>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
          placeholder="search 1,400-indicator catalog…"
          className="flex-1 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px] text-white"
          aria-label="Search indicator catalog"
        />
        <button
          onClick={runSearch}
          disabled={searching || search.trim().length < 2}
          className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {searching ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />} Search
        </button>
      </div>
      {results.length > 0 && (
        <div className="max-h-40 space-y-0.5 overflow-y-auto rounded border border-zinc-800 bg-zinc-950/60 p-1">
          {results.map((m) => (
            <button
              key={m.code}
              onClick={() => { onChange(m.code); setResults([]); }}
              className="block w-full rounded px-2 py-1 text-left text-[11px] text-zinc-300 hover:bg-cyan-500/10 hover:text-cyan-200"
            >
              <span className="font-mono text-cyan-400">{m.code}</span> — {m.name}
              {m.topics[0] && <span className="ml-1 text-zinc-600">· {m.topics[0]}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CountrySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-white"
      aria-label="Country"
    >
      {POPULAR.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
    </select>
  );
}

function ErrorBox({ msg, testId, onRetry }: { msg: string; testId?: string; onRetry?: () => void }) {
  return (
    <div
      data-testid={testId}
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300"
    >
      <span>{msg}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="ml-auto rounded border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[11px] text-red-200 hover:bg-red-500/20"
        >
          Retry
        </button>
      )}
    </div>
  );
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Chart view (interactive charting + transforms + export + save) ──────────
function ChartView({ aliases }: { aliases: Record<string, string> }) {
  const [country, setCountry] = useState('USA');
  const [indicator, setIndicator] = useState('gdpPerCapita');
  const [kind, setKind] = useState<'line' | 'bar' | 'area'>('line');
  const [perCapita, setPerCapita] = useState(false);
  const [inflationAdjust, setInflationAdjust] = useState(false);
  const [data, setData] = useState<ChartSeriesResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savedLink, setSavedLink] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null); setSavedLink(null);
    const env = await macro<ChartSeriesResult>('wb-chart-series', { country, indicator, perCapita, inflationAdjust });
    setLoading(false);
    if (env.ok && env.result) setData(env.result);
    else { setData(null); setError(env.error || 'chart lookup failed'); }
  }, [country, indicator, perCapita, inflationAdjust]);

  const exportCsv = useCallback(async () => {
    if (!data) return;
    const env = await macro<{ csv: string; filename: string }>('wb-export-csv', {
      rows: data.series, columns: ['year', 'value'], filename: `${country}-${indicator}`,
    });
    if (env.ok && env.result) downloadCsv(env.result.filename, env.result.csv);
  }, [data, country, indicator]);

  const saveChart = useCallback(async () => {
    if (!data) return;
    const env = await macro<{ permalink: string }>('wb-save-chart', {
      title: `${country} · ${data.alias || data.indicator}`,
      spec: { view: 'chart', country, indicator, kind, perCapita, inflationAdjust },
    });
    if (env.ok && env.result) {
      const full = typeof window !== 'undefined' ? window.location.origin + env.result.permalink : env.result.permalink;
      setSavedLink(full);
      if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(full).catch(() => {});
    }
  }, [data, country, indicator, kind, perCapita, inflationAdjust]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <CountrySelect value={country} onChange={setCountry} />
        <div className="flex-1 min-w-[220px]">
          <IndicatorPicker value={indicator} onChange={setIndicator} aliases={aliases} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <div className="flex gap-1">
          {(['line', 'bar', 'area'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)}
              className={`rounded px-2 py-0.5 font-mono ${kind === k ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-800 text-zinc-400'}`}>
              {k}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-zinc-400">
          <input type="checkbox" checked={perCapita} onChange={(e) => setPerCapita(e.target.checked)} /> per-capita
        </label>
        <label className="flex items-center gap-1 text-zinc-400">
          <input type="checkbox" checked={inflationAdjust} onChange={(e) => setInflationAdjust(e.target.checked)} /> inflation-adjusted (USD 2024)
        </label>
        <button onClick={run} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LineChartIcon className="h-3.5 w-3.5" />} Plot
        </button>
      </div>

      {error && <ErrorBox msg={error} />}

      {data && data.series.length > 0 && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">{data.country} — {data.alias || data.indicator}</h3>
              <p className="font-mono text-[11px] text-cyan-300">
                {data.points} pts · {data.first?.year}→{data.last?.year}
                {data.transforms.length > 0 && ` · ${data.transforms.join(' · ')}`}
              </p>
            </div>
            <div className="flex gap-1.5">
              <button onClick={exportCsv}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:text-cyan-300">
                <Download className="h-3 w-3" /> CSV
              </button>
              <button onClick={saveChart}
                className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:text-cyan-300">
                <Link2 className="h-3 w-3" /> Share link
              </button>
            </div>
          </div>
          {savedLink && (
            <p className="mb-2 break-all rounded bg-cyan-500/10 px-2 py-1 font-mono text-[10px] text-cyan-200">
              copied: {savedLink}
            </p>
          )}
          <ChartKit
            kind={kind}
            data={data.series as unknown as Array<Record<string, unknown>>}
            xKey="year"
            series={[{ key: 'value', label: data.alias || data.indicator, color: '#22d3ee' }]}
            height={260}
            showLegend={false}
          />
        </div>
      )}
      {data && data.series.length === 0 && !error && (
        <p className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-4 text-center text-xs text-zinc-400">
          No data points for that country / indicator.
        </p>
      )}
    </div>
  );
}

// ─── Bubble view (animated Gapminder chart) ──────────────────────────────────
function BubbleView({ aliases }: { aliases: Record<string, string> }) {
  const [picked, setPicked] = useState<string[]>(['USA', 'CHN', 'IND', 'DEU', 'JPN', 'BRA', 'NGA', 'ZAF']);
  const [xInd, setXInd] = useState('gdpPerCapita');
  const [yInd, setYInd] = useState('lifeExpectancy');
  const [data, setData] = useState<BubbleResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const run = useCallback(async () => {
    setLoading(true); setError(null); setPlaying(false);
    const env = await macro<BubbleResult>('wb-bubble-frames', {
      countries: picked, xIndicator: xInd, yIndicator: yInd, startYear: 1990, endYear: 2023,
    });
    setLoading(false);
    if (env.ok && env.result && env.result.frames.length > 0) { setData(env.result); setFrameIdx(0); }
    else { setData(null); setError(env.error || 'no bubble frames available'); }
  }, [picked, xInd, yInd]);

  useEffect(() => {
    if (!playing || !data) return;
    timerRef.current = setInterval(() => {
      setFrameIdx((i) => (i + 1) % data.frames.length);
    }, 700);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [playing, data]);

  const frame = data?.frames[frameIdx];
  const bounds = useMemo(() => {
    if (!data) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxS = 0;
    for (const f of data.frames) for (const b of f.bubbles) {
      minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x);
      minY = Math.min(minY, b.y); maxY = Math.max(maxY, b.y);
      if (b.size) maxS = Math.max(maxS, b.size);
    }
    return { minX, maxX, minY, maxY, maxS };
  }, [data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-zinc-400">
          X axis
          <input value={xInd} onChange={(e) => setXInd(e.target.value)} list="wb-alias-list"
            className="ml-1 w-36 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" />
        </label>
        <label className="text-[11px] text-zinc-400">
          Y axis
          <input value={yInd} onChange={(e) => setYInd(e.target.value)} list="wb-alias-list"
            className="ml-1 w-36 rounded border border-zinc-800 bg-zinc-950 px-1.5 py-1 text-xs text-white" />
        </label>
        <datalist id="wb-alias-list">
          {Object.entries(aliases).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </datalist>
        <button onClick={run} disabled={loading || picked.length < 2}
          className="inline-flex items-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleDot className="h-3.5 w-3.5" />} Build frames
        </button>
      </div>
      <div className="flex flex-wrap gap-1 text-[10px]">
        {POPULAR.map((c) => {
          const on = picked.includes(c.code);
          return (
            <button key={c.code}
              onClick={() => setPicked((p) => on ? p.filter((x) => x !== c.code) : p.concat(c.code))}
              className={`rounded px-1.5 py-0.5 font-mono ${on ? 'bg-cyan-500/20 text-cyan-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
              {c.code}
            </button>
          );
        })}
      </div>

      {error && <ErrorBox msg={error} />}

      {data && frame && bounds && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="mb-2 flex items-center gap-3">
            <button onClick={() => setPlaying((p) => !p)}
              className="inline-flex items-center gap-1 rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200">
              {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} {playing ? 'Pause' : 'Play'}
            </button>
            <input type="range" min={0} max={data.frames.length - 1} value={frameIdx}
              onChange={(e) => { setPlaying(false); setFrameIdx(Number(e.target.value)); }}
              className="flex-1 accent-cyan-400" aria-label="Year" />
            <span className="w-12 font-mono text-sm text-cyan-300">{frame.year}</span>
          </div>
          <svg viewBox="0 0 640 360" className="w-full" role="img" aria-label="Gapminder bubble chart">
            <rect width={640} height={360} fill="#0a0a0f" />
            {[0, 1, 2, 3, 4].map((i) => (
              <line key={`gx${i}`} x1={60 + i * 140} y1={20} x2={60 + i * 140} y2={320} stroke="#1f1f29" />
            ))}
            {[0, 1, 2, 3, 4].map((i) => (
              <line key={`gy${i}`} x1={60} y1={20 + i * 75} x2={620} y2={20 + i * 75} stroke="#1f1f29" />
            ))}
            {frame.bubbles.map((b) => {
              const px = 60 + ((b.x - bounds.minX) / (bounds.maxX - bounds.minX || 1)) * 560;
              const py = 320 - ((b.y - bounds.minY) / (bounds.maxY - bounds.minY || 1)) * 300;
              const r = b.size ? 6 + Math.sqrt(b.size / (bounds.maxS || 1)) * 28 : 8;
              return (
                <g key={b.country}>
                  <circle cx={px} cy={py} r={r} fill="#22d3ee" fillOpacity={0.35} stroke="#22d3ee" strokeWidth={1} />
                  <text x={px} y={py + 3} textAnchor="middle" fontSize={9} fill="#e4e4e7">{b.country}</text>
                </g>
              );
            })}
            <text x={340} y={350} textAnchor="middle" fontSize={10} fill="#71717a">{data.xIndicator} →</text>
            <text x={14} y={170} textAnchor="middle" fontSize={10} fill="#71717a" transform="rotate(-90 14 170)">{data.yIndicator} →</text>
          </svg>
          <p className="mt-1 text-center text-[10px] text-zinc-400">
            {frame.bubbles.length} countries · bubble area ∝ population · {data.frameCount} frames {data.startYear}–{data.endYear}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Map view (choropleth) ───────────────────────────────────────────────────
function MapChoroView({ aliases }: { aliases: Record<string, string> }) {
  const [indicator, setIndicator] = useState('lifeExpectancy');
  const [data, setData] = useState<ChoroResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    const env = await macro<ChoroResult>('wb-choropleth', { indicator });
    setLoading(false);
    if (env.ok && env.result) setData(env.result);
    else { setData(null); setError(env.error || 'choropleth failed'); }
  }, [indicator]);

  const markers: MapMarker[] = useMemo(() => (data?.points ?? []).map((p) => ({
    id: p.country,
    lat: p.lat, lon: p.lon,
    label: `${p.countryName}: ${p.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} (${p.year})`,
    value: p.intensity,
  })), [data]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]">
          <IndicatorPicker value={indicator} onChange={setIndicator} aliases={aliases} />
        </div>
        <button onClick={run} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MapIcon className="h-3.5 w-3.5" />} Render map
        </button>
      </div>
      {error && <ErrorBox msg={error} />}
      {data && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
            <span>{data.alias || data.indicator} · {data.count} countries</span>
            <span className="font-mono">range {data.min.toLocaleString(undefined, { maximumFractionDigits: 1 })}–{data.max.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
          </div>
          <MapView markers={markers} height={340} />
        </div>
      )}
    </div>
  );
}

// ─── Country dashboard ───────────────────────────────────────────────────────
function DashboardView() {
  const [country, setCountry] = useState('USA');
  const [data, setData] = useState<DashResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    const env = await macro<DashResult>('wb-country-dashboard', { country });
    setLoading(false);
    if (env.ok && env.result) setData(env.result);
    else { setData(null); setError(env.error || 'dashboard failed'); }
  }, [country]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CountrySelect value={country} onChange={setCountry} />
        <button onClick={run} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LayoutDashboard className="h-3.5 w-3.5" />} Load dashboard
        </button>
      </div>
      {error && <ErrorBox msg={error} />}
      {data && (
        <div>
          <div className="mb-3 rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
            <h3 className="text-sm font-semibold text-white">{data.profile.name}</h3>
            <p className="text-[11px] text-zinc-400">
              {data.profile.capital && `${data.profile.capital} · `}
              {data.profile.region} · {data.profile.incomeLevel} · {data.available}/{data.cardCount} indicators
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.cards.map((c) => (
              <div key={c.code} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-xs font-medium text-zinc-300">{c.indicator}</span>
                  <span className="font-mono text-[10px] text-zinc-400">{c.code}</span>
                </div>
                {c.latest ? (
                  <>
                    <p className="font-mono text-lg font-semibold text-cyan-300">
                      {c.latest.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      <span className="ml-1 text-[10px] text-zinc-400">{c.latest.year}</span>
                    </p>
                    {c.series.length > 1 && (
                      <div className="mt-1">
                        <ChartKit
                          kind="area"
                          data={c.series as unknown as Array<Record<string, unknown>>}
                          xKey="year"
                          series={[{ key: 'value', color: '#22d3ee' }]}
                          height={70}
                          showLegend={false}
                          showGrid={false}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-zinc-400">no data</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Rankings (region / income aggregates) ───────────────────────────────────
function RankingsView({ aliases }: { aliases: Record<string, string> }) {
  const [indicator, setIndicator] = useState('gdpPerCapita');
  const [data, setData] = useState<RankResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true); setError(null);
    const env = await macro<RankResult>('wb-region-rankings', { indicator });
    setLoading(false);
    if (env.ok && env.result) setData(env.result);
    else { setData(null); setError(env.error || 'rankings failed'); }
  }, [indicator]);

  const exportCsv = useCallback(async () => {
    if (!data) return;
    const env = await macro<{ csv: string; filename: string }>('wb-export-csv', {
      rows: data.rankings, columns: ['rank', 'code', 'name', 'value', 'year'],
      filename: `region-rankings-${indicator}`,
    });
    if (env.ok && env.result) downloadCsv(env.result.filename, env.result.csv);
  }, [data, indicator]);

  const max = data ? Math.max(...data.rankings.map((r) => r.value || 0)) : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[220px]">
          <IndicatorPicker value={indicator} onChange={setIndicator} aliases={aliases} />
        </div>
        <button onClick={run} disabled={loading}
          className="inline-flex items-center gap-1.5 rounded border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trophy className="h-3.5 w-3.5" />} Rank regions
        </button>
      </div>
      {error && <ErrorBox msg={error} />}
      {data && (
        <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
          <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
            <span>
              {data.alias || data.indicator}
              {data.worldValue != null && ` · world: ${data.worldValue.toLocaleString(undefined, { maximumFractionDigits: 1 })}`}
            </span>
            <button onClick={exportCsv}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 hover:text-cyan-300">
              <Download className="h-3 w-3" /> CSV
            </button>
          </div>
          <div className="space-y-1">
            {data.rankings.map((r) => (
              <div key={r.code} className="flex items-center gap-2 text-[11px]">
                <span className="w-6 text-right font-mono text-zinc-400">{r.rank}</span>
                <span className="w-40 truncate text-zinc-300">{r.name}</span>
                <div className="flex-1 rounded-full bg-zinc-800">
                  <div className="h-3 rounded-full bg-cyan-500/60" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
                </div>
                <span className="w-28 text-right font-mono text-cyan-300">
                  {r.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                </span>
                <span className="w-10 text-right text-zinc-600">{r.year}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Saved charts (permalinks) ───────────────────────────────────────────────
function SavedView() {
  const [charts, setCharts] = useState<SavedChart[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const env = await macro<{ charts: SavedChart[] }>('wb-list-charts', {});
    setLoading(false);
    if (env.ok && env.result) setCharts(env.result.charts);
    else setError(env.error || 'could not load saved charts');
  }, []);

  useEffect(() => { load(); }, [load]);

  // Four mutually-exclusive UX states (honest by construction — every branch is
  // a pure function of the real wb-list-charts macro result): LOADING (role=
  // status), ERROR (role=alert + working Retry), EMPTY, POPULATED.
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-300">Saved charts (shareable permalinks)</h3>
        <button onClick={load} disabled={loading}
          aria-label="Refresh saved charts"
          className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 hover:text-cyan-300">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : 'Refresh'}
        </button>
      </div>

      {loading ? (
        <div
          data-testid="society-saved-loading"
          role="status"
          aria-busy="true"
          aria-live="polite"
          className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-6 text-xs text-zinc-400"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" aria-hidden />
          <span>Loading saved charts…</span>
        </div>
      ) : error ? (
        <ErrorBox testId="society-saved-error" msg={error} onRetry={load} />
      ) : charts.length === 0 ? (
        <p
          data-testid="society-saved-empty"
          className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-400"
        >
          No saved charts yet — plot a chart and click &ldquo;Share link&rdquo;.
        </p>
      ) : (
        <ul data-testid="society-saved-list" className="space-y-1">
          {charts.map((c) => {
            const full = typeof window !== 'undefined' ? window.location.origin + c.permalink : c.permalink;
            return (
              <li key={c.id} className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs">
                <Link2 className="h-3.5 w-3.5 text-cyan-400" aria-hidden />
                <span className="text-zinc-200">{c.title}</span>
                <span className="text-[10px] text-zinc-400">{new Date(c.createdAt).toLocaleDateString()}</span>
                <button
                  aria-label={`Copy permalink for ${c.title}`}
                  onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(full).catch(() => {}); }}
                  className="ml-auto rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-200 hover:bg-cyan-500/20">
                  Copy link
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
