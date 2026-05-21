'use client';

import { useState, useEffect, useCallback } from 'react';
import { BarChart3 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ChartKit, type ChartKind } from '@/components/viz/ChartKit';
import { useDatasets, RunButton, type DatasetMeta } from '@/components/science/ScienceWorkbench';

type VizKind = 'bar' | 'line' | 'scatter' | 'histogram' | 'box' | 'pie';

interface XYResult {
  kind: 'bar' | 'line' | 'scatter' | 'heatmap';
  xKey: string;
  n: number;
  points: Array<Record<string, unknown>>;
  series: { key: string; label: string }[];
}
interface HistResult {
  kind: 'histogram';
  valueColumn: string;
  n: number;
  bins: number;
  points: { bin: number; binEnd: number; count: number }[];
  xKey: string;
  series: { key: string; label: string }[];
}
interface BoxResult {
  kind: 'box';
  valueColumn: string;
  n: number;
  min: number; max: number; q1: number; median: number; q3: number;
  whiskerLow: number; whiskerHigh: number;
  outliers: number[];
}
interface PieResult {
  kind: 'pie';
  categoryColumn: string;
  total: number;
  slices: { name: string; count: number }[];
}
type ChartResult = XYResult | HistResult | BoxResult | PieResult;

/**
 * Interactive chart rendering. Picks a stored dataset + columns and plots
 * via the chart-render macro. Empty until a dataset exists.
 */
export function ScienceCharts() {
  const { datasets, refresh } = useDatasets();
  const [datasetId, setDatasetId] = useState('');
  const [kind, setKind] = useState<VizKind>('bar');
  const [xColumn, setXColumn] = useState('');
  const [yColumn, setYColumn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ChartResult | null>(null);

  useEffect(() => { refresh(); }, [refresh]);

  const selected: DatasetMeta | undefined = datasets.find((d) => d.id === datasetId);

  useEffect(() => {
    if (selected) {
      setXColumn((x) => (selected.columns.includes(x) ? x : selected.columns[0] || ''));
      setYColumn((y) => (selected.columns.includes(y) ? y : selected.columns[1] || selected.columns[0] || ''));
    }
  }, [selected]);

  const render = useCallback(async () => {
    if (!datasetId) { setError('Select a dataset'); return; }
    setBusy(true);
    setError(null);
    setResult(null);
    const params: Record<string, unknown> = { datasetId, kind };
    if (kind === 'histogram' || kind === 'box') params.valueColumn = yColumn || xColumn;
    else if (kind === 'pie') params.categoryColumn = xColumn;
    else { params.xColumn = xColumn; params.yColumn = yColumn; }
    const r = await lensRun<ChartResult>('science', 'chart-render', params);
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setError(r.data?.error || 'Chart render failed');
    setBusy(false);
  }, [datasetId, kind, xColumn, yColumn]);

  return (
    <div className="p-3 space-y-3">
      <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
        <BarChart3 className="w-4 h-4 text-teal-400" /> Chart Rendering
      </h3>

      {datasets.length === 0 ? (
        <p className="text-xs text-gray-500">
          No datasets yet. Create a dataset in the Data Grid tab to plot charts.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[10px] text-gray-500 uppercase">
              Dataset
              <select
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
              >
                <option value="">Select…</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
            <label className="text-[10px] text-gray-500 uppercase">
              Chart Type
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as VizKind)}
                className="mt-1 w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
              >
                {(['bar', 'line', 'scatter', 'histogram', 'box', 'pie'] as VizKind[]).map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>

          {selected && (
            <div className="grid grid-cols-2 gap-2">
              {kind !== 'histogram' && kind !== 'box' && (
                <label className="text-[10px] text-gray-500 uppercase">
                  {kind === 'pie' ? 'Category Column' : 'X Column'}
                  <select
                    value={xColumn}
                    onChange={(e) => setXColumn(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
                  >
                    {selected.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
              {kind !== 'pie' && (
                <label className="text-[10px] text-gray-500 uppercase">
                  {kind === 'histogram' || kind === 'box' ? 'Value Column' : 'Y Column'}
                  <select
                    value={yColumn}
                    onChange={(e) => setYColumn(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
                  >
                    {selected.columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          <RunButton onClick={render} busy={busy}>
            <BarChart3 className="w-3 h-3" /> Render Chart
          </RunButton>

          {error && <p className="text-xs text-red-400">{error}</p>}

          {result && <ChartResultView result={result} />}
        </>
      )}
    </div>
  );
}

function ChartResultView({ result }: { result: ChartResult }) {
  if (result.kind === 'histogram') {
    const data = result.points.map((p) => ({
      bin: `${p.bin}–${p.binEnd}`,
      count: p.count,
    }));
    return (
      <div className="rounded border border-teal-500/20 bg-teal-500/5 p-2">
        <p className="text-[10px] text-gray-500 uppercase mb-1">
          {result.valueColumn} — {result.n} values, {result.bins} bins
        </p>
        <ChartKit kind="bar" data={data} xKey="bin" series={[{ key: 'count', label: 'Frequency' }]} />
      </div>
    );
  }
  if (result.kind === 'box') {
    const cells: [string, number][] = [
      ['Min', result.min], ['Q1', result.q1], ['Median', result.median],
      ['Q3', result.q3], ['Max', result.max],
      ['Whisker Lo', result.whiskerLow], ['Whisker Hi', result.whiskerHigh],
    ];
    return (
      <div className="rounded border border-teal-500/20 bg-teal-500/5 p-3 text-xs">
        <p className="text-[10px] text-gray-500 uppercase mb-2">
          Box plot — {result.valueColumn} ({result.n} values)
        </p>
        <div className="grid grid-cols-4 gap-2">
          {cells.map(([k, v]) => (
            <div key={k}>
              <span className="text-gray-500 text-[10px]">{k}</span>
              <p className="font-mono text-gray-100">{v}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          Outliers: {result.outliers.length === 0 ? 'none' : result.outliers.join(', ')}
        </p>
      </div>
    );
  }
  if (result.kind === 'pie') {
    return (
      <div className="rounded border border-teal-500/20 bg-teal-500/5 p-3 text-xs">
        <p className="text-[10px] text-gray-500 uppercase mb-2">
          {result.categoryColumn} — {result.total} rows
        </p>
        <ul className="space-y-1">
          {result.slices.map((s) => {
            const pct = result.total > 0 ? (s.count / result.total) * 100 : 0;
            return (
              <li key={s.name} className="flex items-center gap-2">
                <span className="w-24 truncate text-gray-300">{s.name || '(blank)'}</span>
                <span className="flex-1 h-2 bg-black/40 rounded overflow-hidden">
                  <span
                    className="block h-full bg-teal-400"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="font-mono text-gray-100 w-14 text-right">
                  {s.count} ({pct.toFixed(0)}%)
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  /* bar / line / scatter */
  const chartKind: ChartKind = result.kind === 'scatter' ? 'scatter'
    : result.kind === 'line' ? 'line' : 'bar';
  return (
    <div className="rounded border border-teal-500/20 bg-teal-500/5 p-2">
      <p className="text-[10px] text-gray-500 uppercase mb-1">{result.n} points</p>
      <ChartKit
        kind={chartKind}
        data={result.points}
        xKey={result.xKey}
        series={result.series}
      />
    </div>
  );
}

export default ScienceCharts;
