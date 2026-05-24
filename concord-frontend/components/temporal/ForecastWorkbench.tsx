'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ForecastWorkbench — the Prophet/Tableau-grade time-series analysis surface
 * for the temporal lens. Every panel here is wired to a real `temporal`
 * domain macro: dataset-import (CSV), timeSeriesDecompose, anomalyDetection,
 * forecast, holidayForecast (confidence intervals + holidays), changepoints,
 * multiSeasonality, backtest (MAE/MAPE), crossCorrelation. No mock data —
 * every value rendered is computed server-side from a user-supplied series.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, TimelineView } from '@/components/viz';
import type { TimelineEvent } from '@/components/viz';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Upload, Database, Activity, TrendingUp, ScanLine, GitCommitHorizontal,
  Waves, Gauge, Link2, Trash2, Loader2, BarChart3,
} from 'lucide-react';

interface DatasetSummary {
  id: string;
  name: string;
  count: number;
  hasTimestamps: boolean;
  importedAt: string;
  preview: number[];
}
interface DatasetFull {
  id: string;
  name: string;
  values: number[];
  timestamps: (string | null)[] | null;
  count: number;
}

type AnalysisTab =
  | 'decompose' | 'forecast' | 'anomaly' | 'changepoints'
  | 'seasonality' | 'backtest' | 'correlation';

const ANALYSIS_TABS: { id: AnalysisTab; label: string; icon: typeof Activity }[] = [
  { id: 'forecast', label: 'Forecast', icon: TrendingUp },
  { id: 'decompose', label: 'Decompose', icon: Activity },
  { id: 'anomaly', label: 'Anomalies', icon: ScanLine },
  { id: 'changepoints', label: 'Changepoints', icon: GitCommitHorizontal },
  { id: 'seasonality', label: 'Seasonality', icon: Waves },
  { id: 'backtest', label: 'Backtest', icon: Gauge },
  { id: 'correlation', label: 'Correlation', icon: Link2 },
];

interface HolidayInput { name: string; index: string; window: string }

export function ForecastWorkbench() {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeData, setActiveData] = useState<DatasetFull | null>(null);
  const [tab, setTab] = useState<AnalysisTab>('forecast');

  // import form
  const [importName, setImportName] = useState('');
  const [importCsv, setImportCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // analysis params
  const [horizon, setHorizon] = useState('12');
  const [period, setPeriod] = useState('');
  const [zThreshold, setZThreshold] = useState('2.5');
  const [testFraction, setTestFraction] = useState('0.2');
  const [holidays, setHolidays] = useState<HolidayInput[]>([]);
  const [compareId, setCompareId] = useState<string>('');

  // results
  const [result, setResult] = useState<any>(null);
  const [running, setRunning] = useState(false);

  // brushing window over the series chart [startIdx, endIdx]
  const [brush, setBrush] = useState<{ start: number; end: number } | null>(null);

  const loadDatasets = useCallback(async () => {
    const r = await lensRun('temporal', 'dataset-list', {});
    if (r.data?.ok && r.data.result) {
      const list = (r.data.result as any).datasets as DatasetSummary[];
      setDatasets(list);
      return list;
    }
    return [] as DatasetSummary[];
  }, []);

  const selectDataset = useCallback(async (id: string) => {
    setActiveId(id);
    setResult(null);
    setBrush(null);
    const r = await lensRun('temporal', 'dataset-get', { datasetId: id });
    if (r.data?.ok && r.data.result) {
      setActiveData((r.data.result as any).dataset as DatasetFull);
    }
  }, []);

  // run-once on mount: load datasets, auto-select the first
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await loadDatasets();
      if (!cancelled && list[0]) await selectDataset(list[0].id);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImport = async () => {
    if (!importCsv.trim()) { setErr('Paste CSV or numeric values first.'); return; }
    setBusy(true);
    setErr(null);
    const r = await lensRun('temporal', 'dataset-import', {
      name: importName.trim() || 'Imported series',
      csv: importCsv,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setImportCsv('');
      setImportName('');
      const list = await loadDatasets();
      const newId = (r.data.result as any).dataset?.id;
      if (newId) await selectDataset(newId);
      else if (list[0]) await selectDataset(list[0].id);
    } else {
      setErr(r.data?.error || 'Import failed.');
    }
  };

  const handleDelete = async (id: string) => {
    await lensRun('temporal', 'dataset-delete', { datasetId: id });
    const list = await loadDatasets();
    if (activeId === id) {
      setActiveData(null);
      setActiveId(null);
      setResult(null);
      if (list[0]) await selectDataset(list[0].id);
    }
  };

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setImportCsv(String(reader.result || ''));
      if (!importName) setImportName(file.name.replace(/\.[^.]+$/, ''));
    };
    reader.readAsText(file);
  };

  const runAnalysis = useCallback(async () => {
    if (!activeId) return;
    setRunning(true);
    setResult(null);
    let macro = '';
    const input: Record<string, unknown> = { datasetId: activeId };
    if (tab === 'decompose') {
      macro = 'timeSeriesDecompose';
      if (period) input.period = Number(period);
    } else if (tab === 'forecast') {
      macro = holidays.length ? 'holidayForecast' : 'forecast';
      input.horizon = Number(horizon) || 12;
      if (period) input.period = Number(period);
      if (holidays.length) {
        input.holidays = holidays
          .filter((h) => h.name.trim() && h.index.trim() !== '')
          .map((h) => ({
            name: h.name.trim(),
            index: Number(h.index),
            window: Number(h.window) || 0,
          }));
      }
    } else if (tab === 'anomaly') {
      macro = 'anomalyDetection';
      input.threshold = Number(zThreshold) || 2.5;
    } else if (tab === 'changepoints') {
      macro = 'changepoints';
    } else if (tab === 'seasonality') {
      macro = 'multiSeasonality';
    } else if (tab === 'backtest') {
      macro = 'backtest';
      input.testFraction = Number(testFraction) || 0.2;
      if (period) input.period = Number(period);
    } else if (tab === 'correlation') {
      macro = 'crossCorrelation';
      if (!compareId) { setErr('Pick a second dataset to correlate against.'); setRunning(false); return; }
      input.datasetIdA = activeId;
      input.datasetIdB = compareId;
      delete input.datasetId;
    }
    const r = await lensRun('temporal', macro, input);
    setRunning(false);
    if (r.data?.ok && r.data.result) {
      setResult({ macro, ...(r.data.result as any) });
      setErr(null);
    } else {
      setErr(r.data?.error || 'Analysis failed.');
    }
  }, [activeId, tab, horizon, period, zThreshold, testFraction, holidays, compareId]);

  // ─── series chart data (with optional brush window) ────────────────
  const seriesChart = useMemo(() => {
    if (!activeData) return [];
    const lo = brush ? brush.start : 0;
    const hi = brush ? brush.end : activeData.values.length;
    return activeData.values.slice(lo, hi).map((v, i) => ({
      idx: lo + i,
      label: activeData.timestamps?.[lo + i] || String(lo + i),
      value: v,
    }));
  }, [activeData, brush]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-cyan-500/15 pb-3">
        <BarChart3 className="h-5 w-5 text-sky-400" />
        <h2 className="text-sm font-semibold text-white">Time-Series Forecast Workbench</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          prophet-grade · server-computed
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* ── left rail: datasets + import ── */}
        <div className="space-y-3">
          <div className={ds.panel}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <Upload className="h-3.5 w-3.5" /> Import Series
            </div>
            <input
              className={cn(ds.input, 'mb-2 text-xs')}
              placeholder="Dataset name"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
            />
            <textarea
              className={cn(ds.textarea, 'mb-2 font-mono text-[11px]')}
              rows={4}
              placeholder={'date,value\n2026-01-01,120\n2026-01-02,135\n...'}
              value={importCsv}
              onChange={(e) => setImportCsv(e.target.value)}
            />
            <label className="mb-2 flex cursor-pointer items-center justify-center gap-1.5 rounded border border-dashed border-zinc-700 py-1.5 text-[11px] text-zinc-400 hover:border-sky-500/40 hover:text-sky-300">
              <Upload className="h-3 w-3" /> Upload .csv file
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
              />
            </label>
            <button
              className={cn(ds.btnPrimary, 'w-full justify-center text-xs')}
              onClick={handleImport}
              disabled={busy}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Database className="h-3.5 w-3.5" />}
              Import
            </button>
            {err && <p className="mt-2 text-[11px] text-rose-400">{err}</p>}
          </div>

          <div className={ds.panel}>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
              <Database className="h-3.5 w-3.5" /> Stored Datasets ({datasets.length})
            </div>
            {datasets.length === 0 ? (
              <p className="text-[11px] text-zinc-500">No datasets imported yet.</p>
            ) : (
              <div className="space-y-1">
                {datasets.map((d) => (
                  <div
                    key={d.id}
                    className={cn(
                      'flex items-center justify-between rounded border px-2 py-1.5 text-[11px] cursor-pointer',
                      activeId === d.id
                        ? 'border-sky-500/50 bg-sky-500/10'
                        : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700',
                    )}
                    onClick={() => selectDataset(d.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-zinc-100">{d.name}</p>
                      <p className="text-[10px] text-zinc-500">
                        {d.count} pts {d.hasTimestamps ? '· dated' : ''}
                      </p>
                    </div>
                    <button
                      className="shrink-0 text-rose-400 hover:text-rose-300"
                      onClick={(e) => { e.stopPropagation(); handleDelete(d.id); }}
                      aria-label="Delete dataset"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── right: chart + analysis ── */}
        <div className="space-y-4">
          {!activeData ? (
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-xs text-zinc-600">
              Import or select a dataset to begin analysis.
            </div>
          ) : (
            <>
              {/* series viewer + brush */}
              <div className={ds.panel}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-200">
                    {activeData.name} — {activeData.count} points
                  </span>
                  {brush && (
                    <button
                      className="text-[11px] text-sky-400 hover:text-sky-300"
                      onClick={() => setBrush(null)}
                    >
                      Reset zoom ({brush.start}–{brush.end})
                    </button>
                  )}
                </div>
                <ChartKit
                  kind="area"
                  data={seriesChart}
                  xKey="label"
                  series={[{ key: 'value', label: activeData.name, color: '#06b6d4' }]}
                  height={220}
                />
                <BrushControl
                  length={activeData.count}
                  brush={brush}
                  onChange={setBrush}
                />
              </div>

              {/* analysis tabs */}
              <div className="flex flex-wrap gap-1.5">
                {ANALYSIS_TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setTab(t.id); setResult(null); }}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition-colors',
                      tab === t.id
                        ? 'bg-sky-500/20 text-sky-300'
                        : 'text-zinc-400 hover:bg-zinc-800 hover:text-white',
                    )}
                  >
                    <t.icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                ))}
              </div>

              {/* analysis params */}
              <div className={ds.panel}>
                <ParamControls
                  tab={tab}
                  horizon={horizon} setHorizon={setHorizon}
                  period={period} setPeriod={setPeriod}
                  zThreshold={zThreshold} setZThreshold={setZThreshold}
                  testFraction={testFraction} setTestFraction={setTestFraction}
                  holidays={holidays} setHolidays={setHolidays}
                  datasets={datasets} activeId={activeId}
                  compareId={compareId} setCompareId={setCompareId}
                />
                <button
                  className={cn(ds.btnPrimary, 'mt-3 w-full justify-center text-xs')}
                  onClick={runAnalysis}
                  disabled={running}
                >
                  {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                  Run {ANALYSIS_TABS.find((t) => t.id === tab)?.label}
                </button>
              </div>

              {/* results */}
              {result && (
                <ResultPanel result={result} activeData={activeData} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── brush / zoom range control ── */
function BrushControl({
  length, brush, onChange,
}: {
  length: number;
  brush: { start: number; end: number } | null;
  onChange: (b: { start: number; end: number } | null) => void;
}) {
  const start = brush?.start ?? 0;
  const end = brush?.end ?? length;
  return (
    <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-500">
      <span>Zoom</span>
      <input
        type="range"
        min={0}
        max={length - 2}
        value={start}
        onChange={(e) => {
          const s = Number(e.target.value);
          onChange({ start: s, end: Math.max(s + 2, end) });
        }}
        className="flex-1 accent-sky-500"
      />
      <input
        type="range"
        min={2}
        max={length}
        value={end}
        onChange={(e) => {
          const en = Number(e.target.value);
          onChange({ start: Math.min(start, en - 2), end: en });
        }}
        className="flex-1 accent-sky-500"
      />
      <span className="font-mono">{start}–{end}</span>
    </div>
  );
}

/* ── per-tab parameter controls ── */
function ParamControls(props: {
  tab: AnalysisTab;
  horizon: string; setHorizon: (v: string) => void;
  period: string; setPeriod: (v: string) => void;
  zThreshold: string; setZThreshold: (v: string) => void;
  testFraction: string; setTestFraction: (v: string) => void;
  holidays: HolidayInput[]; setHolidays: (h: HolidayInput[]) => void;
  datasets: DatasetSummary[]; activeId: string | null;
  compareId: string; setCompareId: (v: string) => void;
}) {
  const {
    tab, horizon, setHorizon, period, setPeriod, zThreshold, setZThreshold,
    testFraction, setTestFraction, holidays, setHolidays, datasets, activeId,
    compareId, setCompareId,
  } = props;
  const field = (label: string, node: React.ReactNode) => (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-zinc-500">{label}</label>
      {node}
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(tab === 'forecast') && field('Horizon (steps)',
          <input className={cn(ds.input, 'text-xs')} type="number" value={horizon}
            onChange={(e) => setHorizon(e.target.value)} />)}
        {(tab === 'forecast' || tab === 'decompose' || tab === 'backtest') && field('Period (optional)',
          <input className={cn(ds.input, 'text-xs')} type="number" placeholder="auto"
            value={period} onChange={(e) => setPeriod(e.target.value)} />)}
        {tab === 'anomaly' && field('Z-score threshold',
          <input className={cn(ds.input, 'text-xs')} type="number" step="0.1" value={zThreshold}
            onChange={(e) => setZThreshold(e.target.value)} />)}
        {tab === 'backtest' && field('Test fraction',
          <input className={cn(ds.input, 'text-xs')} type="number" step="0.05" value={testFraction}
            onChange={(e) => setTestFraction(e.target.value)} />)}
        {tab === 'correlation' && field('Second dataset',
          <select className={cn(ds.select, 'text-xs')} value={compareId}
            onChange={(e) => setCompareId(e.target.value)}>
            <option value="">Select…</option>
            {datasets.filter((d) => d.id !== activeId).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>)}
      </div>

      {tab === 'forecast' && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-wider text-zinc-500">
              Holiday / Event effects
            </label>
            <button
              className="text-[11px] text-sky-400 hover:text-sky-300"
              onClick={() => setHolidays([...holidays, { name: '', index: '', window: '0' }])}
            >
              + Add holiday
            </button>
          </div>
          {holidays.length === 0 && (
            <p className="text-[10px] text-zinc-600">
              None — plain Holt forecast. Add a holiday to model calendar spikes.
            </p>
          )}
          {holidays.map((h, i) => (
            <div key={i} className="mb-1 grid grid-cols-[1fr_70px_70px_24px] gap-1">
              <input className={cn(ds.input, 'text-[11px]')} placeholder="Name"
                value={h.name}
                onChange={(e) => {
                  const next = [...holidays]; next[i] = { ...h, name: e.target.value }; setHolidays(next);
                }} />
              <input className={cn(ds.input, 'text-[11px]')} type="number" placeholder="idx"
                value={h.index}
                onChange={(e) => {
                  const next = [...holidays]; next[i] = { ...h, index: e.target.value }; setHolidays(next);
                }} />
              <input className={cn(ds.input, 'text-[11px]')} type="number" placeholder="±win"
                value={h.window}
                onChange={(e) => {
                  const next = [...holidays]; next[i] = { ...h, window: e.target.value }; setHolidays(next);
                }} />
              <button
                className="text-rose-400 hover:text-rose-300"
                onClick={() => setHolidays(holidays.filter((_, j) => j !== i))}
                aria-label="Remove holiday"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── result rendering per macro ── */
function ResultPanel({ result, activeData }: { result: any; activeData: DatasetFull }) {
  const { macro } = result;

  if (macro === 'timeSeriesDecompose') {
    const data = activeData.values.map((v, i) => ({
      label: activeData.timestamps?.[i] || String(i),
      observed: v,
      trend: result.trend?.[i],
      seasonal: result.seasonal?.[i],
      residual: result.residual?.[i],
    }));
    return (
      <div className={ds.panel}>
        <h3 className="mb-2 text-xs font-semibold text-zinc-200">
          Decomposition — period {result.detectedPeriod}
        </h3>
        <div className="mb-3 flex flex-wrap gap-2">
          <Stat label="Trend strength" value={`${(result.strength?.trend * 100).toFixed(0)}% (${result.strength?.trendLabel})`} />
          <Stat label="Seasonal strength" value={`${(result.strength?.seasonal * 100).toFixed(0)}% (${result.strength?.seasonalLabel})`} />
          <Stat label="Residual var" value={result.variance?.residual} />
        </div>
        <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Observed vs Trend</p>
        <ChartKit kind="line" data={data} xKey="label" height={170}
          series={[
            { key: 'observed', label: 'Observed', color: '#06b6d4' },
            { key: 'trend', label: 'Trend', color: '#f59e0b' },
          ]} />
        <p className="mb-1 mt-3 text-[10px] uppercase tracking-wider text-zinc-500">Seasonal + Residual</p>
        <ChartKit kind="line" data={data} xKey="label" height={150}
          series={[
            { key: 'seasonal', label: 'Seasonal', color: '#a855f7' },
            { key: 'residual', label: 'Residual', color: '#ef4444' },
          ]} />
      </div>
    );
  }

  if (macro === 'forecast' || macro === 'holidayForecast') {
    const histLen = activeData.values.length;
    const hist = activeData.values.map((v, i) => ({
      label: activeData.timestamps?.[i] || String(i),
      observed: v as number | undefined,
      forecast: undefined as number | undefined,
      lower: undefined as number | undefined,
      upper: undefined as number | undefined,
    }));
    const preds = (result.predictions || []).map((p: any) => ({
      label: String(histLen + p.step - 1),
      observed: undefined as number | undefined,
      forecast: p.forecast,
      lower: p.lower95,
      upper: p.upper95,
    }));
    const data = [...hist, ...preds];
    return (
      <div className={ds.panel}>
        <h3 className="mb-2 text-xs font-semibold text-zinc-200">
          Forecast — {result.method} · {result.horizon} steps
        </h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {result.accuracy && <Stat label="RMSE" value={result.accuracy.rmse} />}
          {result.accuracy && <Stat label="MAPE" value={result.accuracy.mape} />}
          {result.accuracyLabel && <Stat label="Accuracy" value={result.accuracyLabel} />}
          {result.trend && <Stat label="Trend" value={result.trend.direction} />}
          {result.residualStd != null && <Stat label="Residual σ" value={result.residualStd} />}
        </div>
        <ChartKit kind="line" data={data} xKey="label" height={230}
          series={[
            { key: 'observed', label: 'Observed', color: '#06b6d4' },
            { key: 'forecast', label: 'Forecast', color: '#f59e0b' },
            { key: 'upper', label: 'Upper 95%', color: '#3f3f46' },
            { key: 'lower', label: 'Lower 95%', color: '#3f3f46' },
          ]} />
        {result.holidayEffects?.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Estimated holiday effects</p>
            <div className="space-y-1">
              {result.holidayEffects.map((h: any, i: number) => (
                <div key={i} className="flex justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px]">
                  <span className="text-zinc-200">{h.name}</span>
                  <span className={h.effect >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                    {h.observed ? `${h.effect >= 0 ? '+' : ''}${h.effect}` : 'not observed'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (macro === 'anomalyDetection') {
    const flagged = new Map<number, string>();
    for (const a of result.consensusAnomalies || []) flagged.set(a.index, 'consensus');
    for (const a of result.zScoreAnomalies || []) if (!flagged.has(a.index)) flagged.set(a.index, 'zscore');
    for (const a of result.iqrAnomalies || []) if (!flagged.has(a.index)) flagged.set(a.index, 'iqr');
    const data = activeData.values.map((v, i) => ({
      label: activeData.timestamps?.[i] || String(i),
      value: v,
      anomaly: flagged.has(i) ? v : undefined,
    }));
    const events: TimelineEvent[] = [...flagged.entries()].map(([idx, kind]) => ({
      id: `an-${idx}`,
      label: `#${idx}`,
      time: Date.parse(String(activeData.timestamps?.[idx] || '')) || idx,
      tone: kind === 'consensus' ? 'bad' : kind === 'zscore' ? 'warn' : 'info',
      detail: `${kind} anomaly · value ${activeData.values[idx]}`,
    }));
    return (
      <div className={ds.panel}>
        <h3 className="mb-2 text-xs font-semibold text-zinc-200">Anomaly Detection</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          <Stat label="Z-score flags" value={result.zScoreCount} />
          <Stat label="IQR flags" value={result.iqrCount} />
          <Stat label="Consensus" value={result.consensusCount} />
          <Stat label="Anomaly rate" value={`${(result.anomalyRate * 100).toFixed(1)}% (${result.anomalyRateLabel})`} />
          <Stat label="Longest cluster" value={result.longestCluster} />
        </div>
        <ChartKit kind="line" data={data} xKey="label" height={200}
          series={[
            { key: 'value', label: 'Series', color: '#06b6d4' },
            { key: 'anomaly', label: 'Anomaly', color: '#ef4444' },
          ]} />
        {events.length > 0 && (
          <div className="mt-3">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Anomalies on time axis</p>
            <TimelineView events={events} height={110} />
          </div>
        )}
      </div>
    );
  }

  if (macro === 'changepoints') {
    const cpSet = new Map<number, any>();
    for (const c of result.changepoints || []) cpSet.set(c.index, c);
    const data = activeData.values.map((v, i) => ({
      label: activeData.timestamps?.[i] || String(i),
      value: v,
      changepoint: cpSet.has(i) ? v : undefined,
    }));
    return (
      <div className={ds.panel}>
        <h3 className="mb-2 text-xs font-semibold text-zinc-200">
          Changepoints — {result.changepointCount} detected ({result.stability})
        </h3>
        <div className="mb-3 flex flex-wrap gap-2">
          <Stat label="Variance explained" value={`${(result.totalVarianceExplained * 100).toFixed(0)}%`} />
          <Stat label="Penalty" value={result.penalty} />
        </div>
        <ChartKit kind="line" data={data} xKey="label" height={200}
          series={[
            { key: 'value', label: 'Series', color: '#06b6d4' },
            { key: 'changepoint', label: 'Changepoint', color: '#f59e0b' },
          ]} />
        <div className="mt-3 space-y-1">
          {(result.changepoints || []).map((c: any, i: number) => (
            <div key={i} className="flex justify-between rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-[11px]">
              <span className="text-zinc-300">
                #{c.index}{c.timestamp ? ` · ${c.timestamp}` : ''}
              </span>
              <span className={c.direction === 'upward' ? 'text-emerald-400' : c.direction === 'downward' ? 'text-rose-400' : 'text-zinc-400'}>
                {c.meanBefore} → {c.meanAfter} ({c.shift >= 0 ? '+' : ''}{c.shift})
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (macro === 'multiSeasonality') {
    const seasons = result.seasonalities || [];
    return (
      <div className={ds.panel}>
        <h3 className="mb-2 text-xs font-semibold text-zinc-200">
          Multiple Seasonality — {seasons.length} period(s)
        </h3>
        <div className="mb-3 flex flex-wrap gap-2">
          {result.dominant && <Stat label="Dominant period" value={result.dominant.period} />}
          <Stat label="Total seasonal share" value={`${(result.totalSeasonalShare * 100).toFixed(0)}%`} />
          <Stat label="Residual var" value={result.residualVariance} />
        </div>
        {seasons.map((s: any, i: number) => (
          <div key={i} className="mb-3">
            <p className="mb-1 text-[11px] text-zinc-300">
              Period {s.period} · {s.strengthLabel} · {(s.varianceShare * 100).toFixed(0)}% variance · amp {s.amplitude}
            </p>
            <ChartKit kind="bar" data={s.profile.map((v: number, j: number) => ({ pos: j, effect: v }))}
              xKey="pos" height={120}
              series={[{ key: 'effect', label: `Period-${s.period} profile`, color: '#a855f7' }]} />
          </div>
        ))}
        {result.acfCurve?.length > 0 && (
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Autocorrelation</p>
            <ChartKit kind="line" data={result.acfCurve} xKey="lag" height={140}
              series={[{ key: 'acf', label: 'ACF', color: '#06b6d4' }]} />
          </div>
        )}
        {seasons.length === 0 && <p className="text-[11px] text-zinc-500">{result.note}</p>}
      </div>
    );
  }

  if (macro === 'backtest') {
    const models = result.models || [];
    const overlay = (result.actual || []).map((a: number, i: number) => {
      const row: Record<string, unknown> = { step: i, actual: a };
      for (const m of models) row[m.model] = m.forecast?.[i];
      return row;
    });
    const palette = ['#22c55e', '#f59e0b', '#ec4899', '#a855f7', '#ef4444'];
    return (
      <div className={ds.panel}>
        <h3 className="mb-2 text-xs font-semibold text-zinc-200">
          Backtest — train {result.trainLength} / test {result.testLength}
        </h3>
        <div className="mb-3 flex flex-wrap gap-2">
          <Stat label="Best model" value={result.bestModel} />
          <Stat label="Best RMSE" value={result.bestRmse} />
        </div>
        <ChartKit kind="line" data={overlay} xKey="step" height={210}
          series={[
            { key: 'actual', label: 'Actual', color: '#06b6d4' },
            ...models.map((m: any, i: number) => ({
              key: m.model, label: m.model, color: palette[i % palette.length],
            })),
          ]} />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-zinc-500">
                <th className="py-1 text-left">Model</th>
                <th className="py-1 text-right">MAE</th>
                <th className="py-1 text-right">RMSE</th>
                <th className="py-1 text-right">MAPE</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m: any) => (
                <tr key={m.model} className={cn('border-t border-zinc-800',
                  m.model === result.bestModel && 'text-emerald-400')}>
                  <td className="py-1">{m.model}</td>
                  <td className="py-1 text-right">{m.mae}</td>
                  <td className="py-1 text-right">{m.rmse}</td>
                  <td className="py-1 text-right">{m.mape}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (macro === 'crossCorrelation') {
    return (
      <div className={ds.panel}>
        <h3 className="mb-2 text-xs font-semibold text-zinc-200">Cross-Correlation / Lag Analysis</h3>
        <div className="mb-3 flex flex-wrap gap-2">
          <Stat label="Relationship" value={result.relationship} />
          <Stat label="Peak corr" value={result.peakCorrelation} />
          <Stat label="Optimal lag" value={result.optimalLag} />
          <Stat label="Lead periods" value={result.leadPeriods} />
          <Stat label="Strength" value={`${result.strengthLabel} (${result.direction})`} />
          <Stat label="Contemporaneous" value={result.contemporaneousCorrelation} />
        </div>
        <ChartKit kind="bar" data={result.ccf || []} xKey="lag" height={210}
          series={[{ key: 'correlation', label: 'CCF', color: '#06b6d4' }]} />
      </div>
    );
  }

  return null;
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-sky-300">{value ?? '—'}</div>
    </div>
  );
}
