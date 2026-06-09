'use client';

/**
 * SystemDynamicsBuilder — visual stock-and-flow model builder.
 *
 * Authors a Vensim-style system-dynamics model (stocks, flows, auxiliaries,
 * params), runs it through the `sim.systemDynamics` Euler integrator, and
 * persists models per-user via `sim.saveModel` / `sim.listModels` /
 * `sim.loadModel` / `sim.deleteModel`. The stock trajectory and per-flow rates
 * are charted with the shared ChartKit, and detected feedback loops are listed.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import {
  Plus, Trash2, Play, Save, FolderOpen, RefreshCw, Box, ArrowRight,
  Sigma, GitBranch, AlertCircle,
} from 'lucide-react';

interface Stock { name: string; initial: number }
interface Flow { name: string; expr: string; from: string; to: string }
interface Aux { name: string; expr: string }
interface SDModel {
  stocks: Stock[];
  flows: Flow[];
  auxiliaries: Aux[];
  params: Record<string, number>;
}
interface FeedbackLoop { flow: string; referencesStocks: string[]; polarity: string }
interface SDResult {
  method: string;
  dt: number;
  stepsRun: number;
  stocks: string[];
  flows: string[];
  finalState: Record<string, number>;
  trajectory: Array<Record<string, number>>;
  flowSeries: Record<string, number[]>;
  feedbackLoops: FeedbackLoop[];
}
interface SavedModelMeta {
  id: string; name: string; stockCount: number; flowCount: number; updatedAt: string;
}

const PALETTE = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#ef4444'];

function emptyModel(): SDModel {
  return {
    stocks: [{ name: 'population', initial: 1000 }],
    flows: [{ name: 'births', expr: 'population * birthRate', from: '', to: 'population' }],
    auxiliaries: [],
    params: { birthRate: 0.03 },
  };
}

export function SystemDynamicsBuilder() {
  const [model, setModel] = useState<SDModel>(emptyModel);
  const [modelName, setModelName] = useState('Population Growth');
  const [modelId, setModelId] = useState<string | null>(null);
  const [steps, setSteps] = useState(40);
  const [dt, setDt] = useState(1);
  const [result, setResult] = useState<SDResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState<SavedModelMeta[]>([]);
  const [paramRows, setParamRows] = useState<Array<{ k: string; v: number }>>([
    { k: 'birthRate', v: 0.03 },
  ]);

  const refreshSaved = useCallback(async () => {
    const r = await lensRun<{ models: SavedModelMeta[] }>('sim', 'listModels', {});
    if (r.data.ok && r.data.result) setSaved(r.data.result.models || []);
  }, []);

  useEffect(() => {
    void refreshSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncParams = useCallback((rows: Array<{ k: string; v: number }>) => {
    const params: Record<string, number> = {};
    for (const row of rows) if (row.k.trim()) params[row.k.trim()] = row.v;
    setModel((m) => ({ ...m, params }));
  }, []);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    const r = await lensRun<SDResult>('sim', 'systemDynamics', { model, steps, dt });
    if (r.data.ok && r.data.result && !('message' in r.data.result)) {
      setResult(r.data.result);
    } else {
      setResult(null);
      setError(r.data.error || 'Simulation returned no trajectory — check stocks and flow expressions.');
    }
    setRunning(false);
  }, [model, steps, dt]);

  const save = useCallback(async () => {
    const r = await lensRun<{ id: string }>('sim', 'saveModel', {
      id: modelId || undefined, name: modelName, model,
    });
    if (r.data.ok && r.data.result) {
      setModelId(r.data.result.id);
      void refreshSaved();
    } else {
      setError(r.data.error || 'Save failed');
    }
  }, [modelId, modelName, model, refreshSaved]);

  const load = useCallback(async (id: string) => {
    const r = await lensRun<{ id: string; name: string; model: SDModel }>('sim', 'loadModel', { id });
    if (r.data.ok && r.data.result) {
      const m = r.data.result.model;
      setModel({
        stocks: m.stocks || [],
        flows: m.flows || [],
        auxiliaries: m.auxiliaries || [],
        params: m.params || {},
      });
      setParamRows(Object.entries(m.params || {}).map(([k, v]) => ({ k, v: Number(v) })));
      setModelName(r.data.result.name);
      setModelId(r.data.result.id);
      setResult(null);
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    await lensRun('sim', 'deleteModel', { id });
    if (id === modelId) setModelId(null);
    void refreshSaved();
  }, [modelId, refreshSaved]);

  const stockNames = model.stocks.map((s) => s.name).filter(Boolean);

  return (
    <div className="space-y-4">
      {/* Model identity + saved model bar */}
      <div className={cn(ds.panel, 'space-y-3')}>
        <div className="flex flex-wrap items-center gap-2">
          <GitBranch className="w-4 h-4 text-green-400" />
          <input
            className={cn(ds.input, 'flex-1 min-w-[180px]')}
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="Model name"
          />
          <button onClick={save} className={cn(ds.btnSecondary, ds.btnSmall)}>
            <Save className="w-3.5 h-3.5" /> Save Model
          </button>
          <button aria-label="Refresh" onClick={refreshSaved} className={cn(ds.btnGhost, ds.btnSmall)}>
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        {saved.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {saved.map((m) => (
              <div key={m.id} className="flex items-center gap-1 bg-lattice-surface/60 rounded-lg px-2 py-1">
                <button onClick={() => load(m.id)} className="text-xs text-gray-300 hover:text-white flex items-center gap-1">
                  <FolderOpen className="w-3 h-3" /> {m.name}
                  <span className="text-gray-600">({m.stockCount}S/{m.flowCount}F)</span>
                </button>
                <button aria-label="Delete" onClick={() => remove(m.id)} className="text-gray-600 hover:text-red-400">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stocks */}
      <div className={ds.panel}>
        <div className={ds.sectionHeader}>
          <h4 className={cn(ds.heading3, 'flex items-center gap-2 text-base')}>
            <Box className="w-4 h-4 text-blue-400" /> Stocks ({model.stocks.length})
          </h4>
          <button
            onClick={() => setModel((m) => ({ ...m, stocks: [...m.stocks, { name: '', initial: 0 }] }))}
            className={cn(ds.btnGhost, ds.btnSmall)}
          >
            <Plus className="w-3 h-3" /> Add Stock
          </button>
        </div>
        <div className="space-y-2 mt-3">
          {model.stocks.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={cn(ds.input, 'flex-1')}
                value={s.name}
                placeholder="Stock name"
                onChange={(e) => setModel((m) => {
                  const stocks = [...m.stocks];
                  stocks[i] = { ...stocks[i], name: e.target.value };
                  return { ...m, stocks };
                })}
              />
              <input
                type="number"
                className={cn(ds.input, 'w-32')}
                value={s.initial}
                placeholder="initial"
                onChange={(e) => setModel((m) => {
                  const stocks = [...m.stocks];
                  stocks[i] = { ...stocks[i], initial: parseFloat(e.target.value) || 0 };
                  return { ...m, stocks };
                })}
              />
              <button
                onClick={() => setModel((m) => ({ ...m, stocks: m.stocks.filter((_, x) => x !== i) }))}
                className={cn(ds.btnGhost, 'p-1.5 text-red-400')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Flows */}
      <div className={ds.panel}>
        <div className={ds.sectionHeader}>
          <h4 className={cn(ds.heading3, 'flex items-center gap-2 text-base')}>
            <ArrowRight className="w-4 h-4 text-orange-400" /> Flows ({model.flows.length})
          </h4>
          <button
            onClick={() => setModel((m) => ({ ...m, flows: [...m.flows, { name: '', expr: '', from: '', to: '' }] }))}
            className={cn(ds.btnGhost, ds.btnSmall)}
          >
            <Plus className="w-3 h-3" /> Add Flow
          </button>
        </div>
        <div className="space-y-2 mt-3">
          {model.flows.map((f, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 items-center">
              <input
                className={cn(ds.input, 'col-span-2')}
                value={f.name}
                placeholder="flow"
                onChange={(e) => setModel((m) => {
                  const flows = [...m.flows];
                  flows[i] = { ...flows[i], name: e.target.value };
                  return { ...m, flows };
                })}
              />
              <input
                className={cn(ds.input, 'col-span-5 font-mono text-xs')}
                value={f.expr}
                placeholder="rate expression e.g. population * birthRate"
                onChange={(e) => setModel((m) => {
                  const flows = [...m.flows];
                  flows[i] = { ...flows[i], expr: e.target.value };
                  return { ...m, flows };
                })}
              />
              <select
                className={cn(ds.select, 'col-span-2')}
                value={f.from}
                onChange={(e) => setModel((m) => {
                  const flows = [...m.flows];
                  flows[i] = { ...flows[i], from: e.target.value };
                  return { ...m, flows };
                })}
              >
                <option value="">from: —</option>
                {stockNames.map((n) => <option key={n} value={n}>from: {n}</option>)}
              </select>
              <select
                className={cn(ds.select, 'col-span-2')}
                value={f.to}
                onChange={(e) => setModel((m) => {
                  const flows = [...m.flows];
                  flows[i] = { ...flows[i], to: e.target.value };
                  return { ...m, flows };
                })}
              >
                <option value="">to: —</option>
                {stockNames.map((n) => <option key={n} value={n}>to: {n}</option>)}
              </select>
              <button
                onClick={() => setModel((m) => ({ ...m, flows: m.flows.filter((_, x) => x !== i) }))}
                className={cn(ds.btnGhost, 'p-1 text-red-400 col-span-1')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Parameters */}
      <div className={ds.panel}>
        <div className={ds.sectionHeader}>
          <h4 className={cn(ds.heading3, 'flex items-center gap-2 text-base')}>
            <Sigma className="w-4 h-4 text-purple-400" /> Parameters
          </h4>
          <button
            onClick={() => { const rows = [...paramRows, { k: '', v: 0 }]; setParamRows(rows); }}
            className={cn(ds.btnGhost, ds.btnSmall)}
          >
            <Plus className="w-3 h-3" /> Add Param
          </button>
        </div>
        <div className="space-y-2 mt-3">
          {paramRows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={cn(ds.input, 'flex-1 font-mono text-xs')}
                value={row.k}
                placeholder="param name"
                onChange={(e) => {
                  const rows = [...paramRows];
                  rows[i] = { ...rows[i], k: e.target.value };
                  setParamRows(rows); syncParams(rows);
                }}
              />
              <input
                type="number"
                step="any"
                className={cn(ds.input, 'w-32')}
                value={row.v}
                onChange={(e) => {
                  const rows = [...paramRows];
                  rows[i] = { ...rows[i], v: parseFloat(e.target.value) || 0 };
                  setParamRows(rows); syncParams(rows);
                }}
              />
              <button aria-label="Delete"
                onClick={() => { const rows = paramRows.filter((_, x) => x !== i); setParamRows(rows); syncParams(rows); }}
                className={cn(ds.btnGhost, 'p-1.5 text-red-400')}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Run controls */}
      <div className={cn(ds.panel, 'flex flex-wrap items-end gap-3')}>
        <div>
          <label className={ds.label}>Steps</label>
          <input
            type="number"
            className={cn(ds.input, 'w-24')}
            value={steps}
            onChange={(e) => setSteps(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
        <div>
          <label className={ds.label}>dt (Euler step)</label>
          <input
            type="number"
            step="any"
            className={cn(ds.input, 'w-24')}
            value={dt}
            onChange={(e) => setDt(parseFloat(e.target.value) || 1)}
          />
        </div>
        <button onClick={run} disabled={running} className={cn(ds.btnPrimary, 'ml-auto')}>
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {running ? 'Integrating…' : 'Run Integration'}
        </button>
      </div>

      {error && (
        <div className={cn(ds.panel, 'border-red-500/30 bg-red-500/5 flex items-center gap-2')}>
          <AlertCircle className="w-4 h-4 text-red-400" />
          <span className="text-sm text-red-400">{error}</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <div className={ds.panel}>
            <h4 className={cn(ds.heading3, 'text-base mb-3')}>Stock Trajectory ({result.method}, dt={result.dt})</h4>
            <ChartKit
              kind="line"
              data={result.trajectory}
              xKey="t"
              series={result.stocks.map((name, i) => ({ key: name, label: name, color: PALETTE[i % PALETTE.length] }))}
              height={280}
            />
          </div>

          {result.flows.length > 0 && (
            <div className={ds.panel}>
              <h4 className={cn(ds.heading3, 'text-base mb-3')}>Flow Rates Over Time</h4>
              <ChartKit
                kind="area"
                data={(result.flowSeries[result.flows[0]] || []).map((_, idx) => {
                  const row: Record<string, number> = { step: idx + 1 };
                  for (const fn of result.flows) row[fn] = result.flowSeries[fn]?.[idx] ?? 0;
                  return row;
                })}
                xKey="step"
                series={result.flows.map((name, i) => ({ key: name, label: name, color: PALETTE[(i + 2) % PALETTE.length] }))}
                height={220}
              />
            </div>
          )}

          <div className={ds.grid2}>
            <div className={ds.panel}>
              <h4 className={cn(ds.heading3, 'text-base mb-3')}>Final State</h4>
              <div className="space-y-2">
                {Object.entries(result.finalState).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-gray-400 font-mono">{k}</span>
                    <span className="text-white font-mono">{v}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className={ds.panel}>
              <h4 className={cn(ds.heading3, 'text-base mb-3 flex items-center gap-2')}>
                <GitBranch className="w-4 h-4 text-cyan-400" /> Feedback Loops ({result.feedbackLoops.length})
              </h4>
              {result.feedbackLoops.length === 0 && (
                <p className={ds.textMuted}>No stock-coupled feedback detected.</p>
              )}
              <div className="space-y-2">
                {result.feedbackLoops.map((loop, i) => (
                  <div key={i} className="flex items-center justify-between text-sm bg-lattice-surface/50 rounded px-2 py-1.5">
                    <span className="text-gray-300 font-mono">{loop.flow}</span>
                    <span className="text-xs text-gray-400">{loop.referencesStocks.join(', ')}</span>
                    <span className={cn(
                      'text-xs px-1.5 py-0.5 rounded-full',
                      loop.polarity === 'reinforcing'
                        ? 'bg-orange-500/20 text-orange-400'
                        : 'bg-blue-500/20 text-blue-400',
                    )}>
                      {loop.polarity === 'reinforcing' ? 'R (+)' : 'B (−)'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
