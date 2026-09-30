'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { GitCompareArrows, Loader2 } from 'lucide-react';
import { ChartKit } from '@/components/viz';
import {
  type CompareResult, type WmEntity, type WmTrajRow,
  btn, card, Stat, wmRun, WM_QUERY_KEYS,
} from '@/components/worldmodel/wm-shared';

// ─── Compare tab ────────────────────────────────────────────────────────
export function ComparePanel() {
  const entitiesQ = useQuery({
    queryKey: WM_QUERY_KEYS.entities,
    queryFn: () => wmRun<{ entities: WmEntity[] }>('wm_list_entities'),
  });
  const entities = entitiesQ.data?.entities ?? [];
  const [steps, setSteps] = useState(10);
  const [baseGrowth, setBaseGrowth] = useState(0.05);
  const [cfGrowth, setCfGrowth] = useState(0.12);
  const [result, setResult] = useState<CompareResult | null>(null);

  const exec = useMutation({
    mutationFn: () => wmRun<CompareResult>('compare_scenarios', {
      steps,
      baseline: { growth: baseGrowth, shocks: [] },
      counterfactual: { growth: cfGrowth, shocks: [] },
    }),
    onSuccess: (r) => setResult(r),
  });

  const series = useMemo(() => {
    if (!result) return [];
    return Object.keys(result.entityNames).map((id) => ({ key: id, label: result.entityNames[id] }));
  }, [result]);
  const totalSeries = useMemo(() => {
    if (!result) return [];
    return result.baseline.trajectory.map((row, i) => {
      const cf = result.counterfactual.trajectory[i] ?? {};
      const sumRow = (r: WmTrajRow) => Object.entries(r).reduce((a, [k, v]) => k === 'step' ? a : a + (v as number), 0);
      return { step: row.step, baseline: Number(sumRow(row).toFixed(2)), counterfactual: Number(sumRow(cf as WmTrajRow).toFixed(2)) };
    });
  }, [result]);

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-3 text-sm font-semibold text-emerald-300">Scenario vs counterfactual</h3>
        {entities.length === 0 ? (
          <p className="text-xs text-emerald-700">Create entities before comparing scenarios.</p>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-[11px] text-emerald-600">steps {steps}
              <input type="range" min={1} max={60} value={steps} onChange={(e) => setSteps(Number(e.target.value))}
                aria-label="Steps" className="block" />
            </label>
            <label className="text-[11px] text-indigo-400">baseline growth {baseGrowth.toFixed(2)}
              <input type="range" min={-0.5} max={0.5} step={0.01} value={baseGrowth}
                onChange={(e) => setBaseGrowth(Number(e.target.value))} aria-label="Baseline growth" className="block" />
            </label>
            <label className="text-[11px] text-amber-400">counterfactual growth {cfGrowth.toFixed(2)}
              <input type="range" min={-0.5} max={0.5} step={0.01} value={cfGrowth}
                onChange={(e) => setCfGrowth(Number(e.target.value))} aria-label="Counterfactual growth" className="block" />
            </label>
            <button className={btn} disabled={exec.isPending} onClick={() => exec.mutate()}>
              {exec.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompareArrows className="h-3.5 w-3.5" />} Compare
            </button>
          </div>
        )}
        {exec.isError && <p className="mt-2 text-xs text-rose-400">{(exec.error as Error).message}</p>}
      </div>

      {result && (
        <>
          <div className={`${card} flex flex-wrap items-center gap-4`}>
            <Stat label="Baseline total" value={result.baseline.total} />
            <Stat label="Counterfactual total" value={result.counterfactual.total} />
            <Stat label="Net swing" value={result.totalSwing} tone={result.totalSwing >= 0 ? 'good' : 'bad'} />
            <span className={`text-xs ${result.totalSwing >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{result.verdict}</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={card}>
              <h4 className="mb-2 text-xs font-semibold text-indigo-300">Baseline trajectory</h4>
              <ChartKit kind="line" data={result.baseline.trajectory as unknown as Record<string, unknown>[]} xKey="step" series={series} height={220} />
            </div>
            <div className={card}>
              <h4 className="mb-2 text-xs font-semibold text-amber-300">Counterfactual trajectory</h4>
              <ChartKit kind="line" data={result.counterfactual.trajectory as unknown as Record<string, unknown>[]} xKey="step" series={series} height={220} />
            </div>
          </div>
          <div className={card}>
            <h4 className="mb-2 text-xs font-semibold text-emerald-300">Total system value — baseline vs counterfactual</h4>
            <ChartKit kind="area" data={totalSeries as unknown as Record<string, unknown>[]} xKey="step"
              series={[{ key: 'baseline', label: 'Baseline', color: '#6366f1' }, { key: 'counterfactual', label: 'Counterfactual', color: '#f59e0b' }]}
              height={240} />
          </div>
          <div className={card}>
            <h4 className="mb-2 text-xs font-semibold text-emerald-300">Per-entity delta (counterfactual − baseline)</h4>
            <ChartKit kind="bar" data={result.delta as unknown as Record<string, unknown>[]} xKey="step" series={series} height={240} />
          </div>
        </>
      )}
    </div>
  );
}

