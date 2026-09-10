'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo } from 'react';
import { lensRun } from '@/lib/api/client';

export interface WmEntity { id: string; name: string; type: string; attributes?: Record<string, any>; updatedAt?: string }
export interface WmRelation { id: string; from: string; to: string; type: string; weight?: number }
export interface WmTypeField { key: string; kind: 'number' | 'string' | 'boolean'; label?: string }
export interface WmType { name: string; fields: WmTypeField[] }
export interface WmTrajRow { step: number; [k: string]: number }
export interface WmSim {
  id: string; name: string; mode?: string; total?: number; createdAt?: string;
  trajectory?: WmTrajRow[]; finalState?: Record<string, number>; entityNames?: Record<string, string>;
}
export interface WmSnapshot { id: string; label: string; entityCount: number; relationCount: number; capturedAt: string }
export interface WmScenario {
  id: string; name: string; steps: number; growth: number;
  shocks: { entityId: string; step: number; delta: number }[]; note?: string; savedAt?: string;
}
export interface WmIngestEvent {
  id: string; entityId: string; entityName: string; attribute: string;
  mode: string; from: number; to: number; source: string; at: string;
}
export interface CompareResult {
  steps: number;
  entityNames: Record<string, string>;
  baseline: { trajectory: WmTrajRow[]; total: number };
  counterfactual: { trajectory: WmTrajRow[]; total: number };
  delta: WmTrajRow[];
  totalSwing: number;
  verdict: string;
}
export interface SnapshotDiff {
  from: { id: string; label: string };
  to: { id: string; label: string };
  addedEntities: { id: string; name: string }[];
  removedEntities: { id: string; name: string }[];
  changedEntities: { id: string; name: string; changes: { field: string; from: unknown; to: unknown }[] }[];
  addedRelations: { id: string; type: string }[];
  removedRelations: { id: string; type: string }[];
  summary: Record<string, number>;
}

export async function wmRun<T = any>(action: string, input: Record<string, unknown> = {}) {
  const r = await lensRun<T>('worldmodel', action, input);
  if (!r.data.ok) throw new Error(r.data.error || `${action} failed`);
  return r.data.result as T;
}

export const card = 'rounded-lg border border-emerald-900/40 bg-emerald-950/10 p-4';
export const input = 'rounded border border-emerald-900/40 bg-black/40 px-2 py-1.5 font-mono text-sm text-emerald-100 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500';
export const btn = 'inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-400';
export const btnGhost = 'inline-flex items-center gap-1 rounded border border-emerald-900/40 px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-900/30';

export const WM_QUERY_KEYS = {
  status: ['wm-status'] as const,
  entities: ['wm-entities'] as const,
  relations: ['wm-relations'] as const,
  types: ['wm-types'] as const,
  graph: ['wm-graph'] as const,
  sims: ['wm-sims'] as const,
  snapshots: ['wm-snapshots'] as const,
  scenarios: ['wm-scenarios'] as const,
  ingestLog: ['wm-ingest-log'] as const,
};

export function invalidateWorldModel(qc: { invalidateQueries: (opts: { queryKey: readonly string[] }) => unknown }) {
  (['wm-status', 'wm-entities', 'wm-relations', 'wm-types', 'wm-graph'] as const).forEach((k) => {
    qc.invalidateQueries({ queryKey: [k] });
  });
}

export function useTrajectoryChart(sim: WmSim | null) {
  return useMemo(() => {
    if (!sim?.trajectory) return { data: [] as Record<string, unknown>[], series: [] as { key: string; label: string }[] };
    const names = sim.entityNames ?? {};
    const ids = Object.keys(sim.trajectory[0] ?? {}).filter((k) => k !== 'step');
    return {
      data: sim.trajectory as unknown as Record<string, unknown>[],
      series: ids.map((id) => ({ key: id, label: names[id] ?? id })),
    };
  }, [sim]);
}

export function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-emerald-200';
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-emerald-700">{label}</div>
      <div className={`font-mono text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
