'use client';

/**
 * ResourceAllocationPanel — priority-sorted force allocation across
 * missions. Backed by defense.resourceAllocation (a pure-compute
 * optimizer: sorts missions critical→low, greedily assigns available
 * resource units, and reports fully/partially/unallocated status per
 * mission plus a post-allocation summary).
 *
 * The macro is stateless per call (no persisted resource/mission
 * roster server-side) — this panel owns the resource pool + mission
 * list locally and re-runs the optimizer on demand, which matches how
 * a planner actually uses an allocation tool: stage the inputs, run
 * the pass, read the result, adjust, re-run.
 */

import { useState, useCallback, useMemo } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Plus, Trash2, Loader2, Boxes, Target, PlayCircle,
  CheckCircle2, AlertCircle, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ResourceUnit {
  id: string;
  label: string;
}

type MissionPriority = 'critical' | 'high' | 'medium' | 'low';

interface MissionInput {
  id: string;
  name: string;
  priority: MissionPriority;
  resourcesNeeded: string;
}

interface AllocationRow {
  mission: string;
  priority: string;
  resourcesNeeded: number;
  resourcesAssigned: number;
  status: 'fully-allocated' | 'partially-allocated' | 'unallocated';
}

interface AllocationResult {
  message?: string;
  totalResources: number;
  totalMissions: number;
  availableAfter: number;
  allocations: AllocationRow[];
  fullyStaffed: number;
  understaffed: number;
}

const PRIORITIES: MissionPriority[] = ['critical', 'high', 'medium', 'low'];

const PRIORITY_COLOR: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-amber-400',
  low: 'text-zinc-400',
};

const STATUS_META: Record<AllocationRow['status'], { label: string; color: string; icon: typeof CheckCircle2 }> = {
  'fully-allocated': { label: 'Fully allocated', color: 'text-green-400 bg-green-400/10 border-green-500/30', icon: CheckCircle2 },
  'partially-allocated': { label: 'Partially allocated', color: 'text-amber-400 bg-amber-400/10 border-amber-500/30', icon: AlertCircle },
  unallocated: { label: 'Unallocated', color: 'text-red-400 bg-red-400/10 border-red-500/30', icon: XCircle },
};

let seq = 0;
function localId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

export function ResourceAllocationPanel() {
  const [resources, setResources] = useState<ResourceUnit[]>([]);
  const [missions, setMissions] = useState<MissionInput[]>([]);

  const [resourceLabel, setResourceLabel] = useState('');
  const [missionName, setMissionName] = useState('');
  const [missionPriority, setMissionPriority] = useState<MissionPriority>('medium');
  const [missionNeeded, setMissionNeeded] = useState('1');

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AllocationResult | null>(null);

  const addResource = useCallback(() => {
    const label = resourceLabel.trim();
    if (!label) return;
    setResources((prev) => [...prev, { id: localId('res'), label }]);
    setResourceLabel('');
  }, [resourceLabel]);

  const removeResource = useCallback((id: string) => {
    setResources((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addMission = useCallback(() => {
    const name = missionName.trim();
    if (!name) return;
    const needed = Math.max(1, Math.round(Number(missionNeeded) || 1));
    setMissions((prev) => [...prev, { id: localId('mis'), name, priority: missionPriority, resourcesNeeded: String(needed) }]);
    setMissionName('');
    setMissionNeeded('1');
  }, [missionName, missionPriority, missionNeeded]);

  const removeMission = useCallback((id: string) => {
    setMissions((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const canRun = resources.length > 0 && missions.length > 0;

  const runAllocation = useCallback(async () => {
    if (!canRun) {
      setError('Add at least one resource unit and one mission first.');
      return;
    }
    setRunning(true);
    setError(null);
    const r = await lensRun<AllocationResult>('defense', 'resourceAllocation', {
      resources: resources.map((res) => ({ name: res.label })),
      missions: missions.map((m) => ({
        name: m.name,
        priority: m.priority,
        resourcesNeeded: Math.max(1, Math.round(Number(m.resourcesNeeded) || 1)),
      })),
    });
    if (r.data?.ok && r.data.result) {
      setResult(r.data.result);
    } else {
      setError(r.data?.error || 'Allocation run failed');
    }
    setRunning(false);
  }, [canRun, resources, missions]);

  const sortedAllocations = useMemo(() => {
    if (!result?.allocations) return [];
    const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    return [...result.allocations].sort((a, b) => (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2));
  }, [result]);

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Boxes className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-semibold text-white">Resource Allocation</h3>
        </div>
        {result && !result.message && (
          <span className="text-xs text-zinc-400">
            <span className="text-green-400 font-semibold">{result.fullyStaffed}</span> fully staffed ·{' '}
            <span className="text-amber-400 font-semibold">{result.understaffed}</span> short ·{' '}
            <span className="text-zinc-300 font-semibold">{result.availableAfter}</span> spare
          </span>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Resource pool */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">
            Available resource units ({resources.length})
          </div>
          <div className="flex gap-2">
            <input
              value={resourceLabel}
              onChange={(e) => setResourceLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addResource()}
              placeholder="e.g. Fireteam Alpha, MEDEVAC helo"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white placeholder-zinc-500"
            />
            <button
              onClick={addResource}
              disabled={!resourceLabel.trim()}
              aria-label="Add resource unit"
              className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-white"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {resources.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
                <span className="text-xs text-white truncate">{r.label}</span>
                <button onClick={() => removeResource(r.id)} aria-label="Remove resource unit" className="p-0.5 text-zinc-400 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {resources.length === 0 && (
              <div className="text-[11px] text-zinc-500 py-2">No resource units staged yet.</div>
            )}
          </div>
        </div>

        {/* Mission demand */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">
            Missions requiring resources ({missions.length})
          </div>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-1.5">
            <input
              value={missionName}
              onChange={(e) => setMissionName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addMission()}
              placeholder="Mission name"
              className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white placeholder-zinc-500"
            />
            <select
              value={missionPriority}
              onChange={(e) => setMissionPriority(e.target.value as MissionPriority)}
              className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1.5 text-xs text-white"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input
              value={missionNeeded}
              onChange={(e) => setMissionNeeded(e.target.value)}
              placeholder="Qty"
              inputMode="numeric"
              className="w-14 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white font-mono"
            />
            <button
              onClick={addMission}
              disabled={!missionName.trim()}
              aria-label="Add mission"
              className="px-2.5 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded text-white"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {missions.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Target className="w-3 h-3 text-zinc-500 shrink-0" />
                  <span className="text-xs text-white truncate">{m.name}</span>
                  <span className={cn('text-[10px] font-semibold uppercase shrink-0', PRIORITY_COLOR[m.priority])}>{m.priority}</span>
                  <span className="text-[10px] text-zinc-400 font-mono shrink-0">×{m.resourcesNeeded}</span>
                </div>
                <button onClick={() => removeMission(m.id)} aria-label="Remove mission" className="p-0.5 text-zinc-400 hover:text-red-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {missions.length === 0 && (
              <div className="text-[11px] text-zinc-500 py-2">No missions staged yet.</div>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={runAllocation}
        disabled={!canRun || running}
        className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 hover:bg-purple-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlayCircle className="w-3.5 h-3.5" />}
        Run Allocation
      </button>

      {/* Results */}
      {result && result.message && (
        <div className="text-xs text-zinc-400 rounded-md border border-zinc-800 bg-zinc-900/60 px-3 py-2">{result.message}</div>
      )}
      {result && !result.message && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">Resources</div>
              <div className="text-lg font-bold text-white">{result.totalResources}</div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">Missions</div>
              <div className="text-lg font-bold text-white">{result.totalMissions}</div>
            </div>
            <div className="rounded border border-green-500/30 bg-green-500/5 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-green-300">Fully staffed</div>
              <div className="text-lg font-bold text-green-400">{result.fullyStaffed}</div>
            </div>
            <div className="rounded border border-amber-500/30 bg-amber-500/5 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-amber-300">Understaffed</div>
              <div className="text-lg font-bold text-amber-400">{result.understaffed}</div>
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">Spare after</div>
              <div className="text-lg font-bold text-white">{result.availableAfter}</div>
            </div>
          </div>

          <div className="space-y-1">
            {sortedAllocations.map((a, i) => {
              const meta = STATUS_META[a.status];
              const Icon = meta.icon;
              return (
                <div key={`${a.mission}-${i}`} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={cn('text-[10px] font-bold uppercase shrink-0', PRIORITY_COLOR[a.priority])}>{a.priority}</span>
                    <span className="text-xs text-white truncate">{a.mission}</span>
                    <span className="text-[10px] text-zinc-400 font-mono shrink-0">{a.resourcesAssigned}/{a.resourcesNeeded}</span>
                  </div>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded border flex items-center gap-1 shrink-0', meta.color)}>
                    <Icon className="w-3 h-3" />
                    {meta.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
