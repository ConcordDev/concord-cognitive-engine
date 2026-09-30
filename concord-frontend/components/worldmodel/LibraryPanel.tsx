'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Library, Play, Save, Trash2 } from 'lucide-react';
import { ChartKit } from '@/components/viz';
import {
  type WmEntity, type WmScenario, type WmSim,
  btn, btnGhost, card, input, useTrajectoryChart, wmRun, WM_QUERY_KEYS,
} from '@/components/worldmodel/wm-shared';

// ─── Library tab ────────────────────────────────────────────────────────
export function LibraryPanel() {
  const entitiesQ = useQuery({
    queryKey: WM_QUERY_KEYS.entities,
    queryFn: () => wmRun<{ entities: WmEntity[] }>('wm_list_entities'),
  });
  const entities = entitiesQ.data?.entities ?? [];
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [steps, setSteps] = useState(10);
  const [growth, setGrowth] = useState(0.05);
  const [note, setNote] = useState('');
  const [lastRun, setLastRun] = useState<WmSim | null>(null);

  const scenarios = useQuery({
    queryKey: WM_QUERY_KEYS.scenarios,
    queryFn: () => wmRun<{ scenarios: WmScenario[] }>('list_scenarios'),
  });
  const save = useMutation({
    mutationFn: () => wmRun('save_scenario', { name, steps, growth, note, shocks: [] }),
    onSuccess: () => { setName(''); setNote(''); qc.invalidateQueries({ queryKey: WM_QUERY_KEYS.scenarios }); },
  });
  const del = useMutation({
    mutationFn: (id: string) => wmRun('delete_scenario', { id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WM_QUERY_KEYS.scenarios }),
  });
  const rerun = useMutation({
    mutationFn: (s: WmScenario) => wmRun<WmSim>('run_scenario', {
      name: s.name, steps: s.steps, growth: s.growth, shocks: s.shocks,
    }),
    onSuccess: (sim) => { setLastRun(sim); qc.invalidateQueries({ queryKey: WM_QUERY_KEYS.sims }); },
  });
  const chart = useTrajectoryChart(lastRun);
  const list = scenarios.data?.scenarios ?? [];

  return (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Save a named scenario</h3>
        <div className="flex flex-wrap items-end gap-3">
          <input className={`${input} w-44`} placeholder="Scenario name" aria-label="Scenario name"
            value={name} onChange={(e) => setName(e.target.value)} />
          <label className="text-[11px] text-emerald-600">steps {steps}
            <input type="range" min={1} max={60} value={steps} onChange={(e) => setSteps(Number(e.target.value))}
              aria-label="Steps" className="block" />
          </label>
          <label className="text-[11px] text-emerald-600">growth {growth.toFixed(2)}
            <input type="range" min={-0.5} max={0.5} step={0.01} value={growth}
              onChange={(e) => setGrowth(Number(e.target.value))} aria-label="Growth" className="block" />
          </label>
          <input className={`${input} flex-1 min-w-32`} placeholder="note (optional)" aria-label="Scenario note"
            value={note} onChange={(e) => setNote(e.target.value)} />
          <button className={btn} disabled={!name || save.isPending} onClick={() => save.mutate()}>
            <Save className="h-3 w-3" /> Save
          </button>
        </div>
      </div>

      <div className={card}>
        <h3 className="mb-2 text-sm font-semibold text-emerald-300">Scenario library</h3>
        {list.length === 0 ? (
          <p className="text-xs text-emerald-700">No saved scenarios.</p>
        ) : (
          <ul className="space-y-1">
            {list.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 rounded border border-emerald-900/30 bg-black/30 px-3 py-2 text-xs">
                <Library className="h-3 w-3 text-emerald-500" aria-hidden />
                <span className="text-emerald-100">{s.name}</span>
                <span className="font-mono text-emerald-600">steps {s.steps} · growth {s.growth}</span>
                {s.note && <span className="text-emerald-700">{s.note}</span>}
                <button className={`${btnGhost} ml-auto`} disabled={entities.length === 0 || rerun.isPending}
                  onClick={() => rerun.mutate(s)}>
                  <Play className="h-3 w-3" /> re-run
                </button>
                <button aria-label="Delete" className={btnGhost} onClick={() => del.mutate(s.id)}><Trash2 className="h-3 w-3" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {lastRun?.trajectory && (
        <div className={card}>
          <h3 className="mb-2 text-sm font-semibold text-emerald-300">
            Re-run result · {lastRun.name} <span className="text-emerald-700">(total {lastRun.total})</span>
          </h3>
          <ChartKit kind="line" data={chart.data} xKey="step" series={chart.series} height={260} />
        </div>
      )}
    </div>
  );
}

