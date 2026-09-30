'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { ChartKit } from '@/components/viz';
import {
  type WmEntity, type WmSim,
  btn, btnGhost, card, input, useTrajectoryChart, wmRun, WM_QUERY_KEYS,
} from '@/components/worldmodel/wm-shared';

// ─── Simulate tab ───────────────────────────────────────────────────────
export function SimulatePanel() {
  const entitiesQ = useQuery({
    queryKey: WM_QUERY_KEYS.entities,
    queryFn: () => wmRun<{ entities: WmEntity[] }>('wm_list_entities'),
  });
  const entities = entitiesQ.data?.entities ?? [];
  const qc = useQueryClient();
  const [steps, setSteps] = useState(10);
  const [growth, setGrowth] = useState(0.05);
  const [name, setName] = useState('forward run');
  const [shocks, setShocks] = useState<{ entityId: string; step: number; delta: number }[]>([]);

  const sims = useQuery({
    queryKey: WM_QUERY_KEYS.sims,
    queryFn: () => wmRun<{ simulations: WmSim[] }>('list_sims'),
  });
  const [viewSim, setViewSim] = useState<WmSim | null>(null);

  const exec = useMutation({
    mutationFn: () => wmRun<WmSim>('run_scenario', { name, steps, growth, shocks }),
    onSuccess: (sim) => { setViewSim(sim); qc.invalidateQueries({ queryKey: WM_QUERY_KEYS.sims }); },
  });
  const loadSim = useMutation({
    mutationFn: (id: string) => wmRun<WmSim>('get_sim', { id }),
    onSuccess: (sim) => setViewSim(sim),
  });

  const chart = useTrajectoryChart(viewSim);

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-3 text-sm font-semibold text-emerald-300">Run a forward simulation</h3>
        {entities.length === 0 ? (
          <p className="text-xs text-emerald-700">Create entities (with a numeric value) before simulating.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <input className={`${input} w-44`} aria-label="Simulation name" value={name} onChange={(e) => setName(e.target.value)} />
              <label className="text-[11px] text-emerald-600">steps {steps}
                <input type="range" min={1} max={60} value={steps} onChange={(e) => setSteps(Number(e.target.value))}
                  aria-label="Steps" className="block" />
              </label>
              <label className="text-[11px] text-emerald-600">growth {growth.toFixed(2)}
                <input type="range" min={-0.5} max={0.5} step={0.01} value={growth}
                  onChange={(e) => setGrowth(Number(e.target.value))} aria-label="Growth rate" className="block" />
              </label>
              <button className={btn} disabled={exec.isPending} onClick={() => exec.mutate()}>
                {exec.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run
              </button>
            </div>
            <ShockEditor entities={entities} steps={steps} shocks={shocks} onChange={setShocks} />
          </>
        )}
        {exec.isError && <p className="mt-2 text-xs text-rose-400">{(exec.error as Error).message}</p>}
      </div>

      {viewSim?.trajectory && (
        <div className={card}>
          <h3 className="mb-3 text-sm font-semibold text-emerald-300">
            Trajectory · {viewSim.name} <span className="text-emerald-700">(total {viewSim.total})</span>
          </h3>
          <ChartKit kind="line" data={chart.data} xKey="step" series={chart.series} height={280} />
        </div>
      )}

      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Recent simulations</h3>
        {(sims.data?.simulations ?? []).length === 0 ? (
          <p className="text-xs text-emerald-700">No simulations yet.</p>
        ) : (
          <ul className="space-y-1">
            {(sims.data?.simulations ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded border border-emerald-900/30 bg-black/30 px-3 py-2 text-xs">
                <Play className="h-3 w-3 text-emerald-500" aria-hidden />
                <span className="text-emerald-100">{s.name}</span>
                <span className="rounded bg-emerald-800/30 px-1.5 py-0.5 text-[10px]">{s.mode}</span>
                <span className="font-mono text-emerald-600">total {s.total}</span>
                {s.createdAt && <span className="text-[10px] text-emerald-800">{new Date(s.createdAt).toLocaleString()}</span>}
                <button className={`${btnGhost} ml-auto`} onClick={() => loadSim.mutate(s.id)}>view chart</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ShockEditor({
  entities, steps, shocks, onChange,
}: {
  entities: WmEntity[]; steps: number;
  shocks: { entityId: string; step: number; delta: number }[];
  onChange: (s: { entityId: string; step: number; delta: number }[]) => void;
}) {
  return (
    <div className="mt-3 border-t border-emerald-900/30 pt-3">
      <p className="mb-1.5 text-[11px] uppercase tracking-wider text-emerald-700">Shocks (one-off deltas at a step)</p>
      {shocks.map((sh, i) => (
        <div key={i} className="mb-1.5 flex flex-wrap gap-1.5">
          <select className={input} aria-label="Shock entity" value={sh.entityId}
            onChange={(e) => onChange(shocks.map((x, j) => j === i ? { ...x, entityId: e.target.value } : x))}>
            <option value="">entity…</option>
            {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <input className={`${input} w-20`} type="number" min={1} max={steps} aria-label="Shock step"
            value={sh.step} onChange={(e) => onChange(shocks.map((x, j) => j === i ? { ...x, step: Number(e.target.value) } : x))} />
          <input className={`${input} w-24`} type="number" aria-label="Shock delta" placeholder="delta"
            value={sh.delta} onChange={(e) => onChange(shocks.map((x, j) => j === i ? { ...x, delta: Number(e.target.value) } : x))} />
          <button aria-label="Delete" className={btnGhost} onClick={() => onChange(shocks.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></button>
        </div>
      ))}
      <button className={btnGhost} disabled={entities.length === 0}
        onClick={() => onChange([...shocks, { entityId: entities[0]?.id ?? '', step: 1, delta: 0 }])}>
        <Plus className="h-3 w-3" /> Add shock
      </button>
    </div>
  );
}


