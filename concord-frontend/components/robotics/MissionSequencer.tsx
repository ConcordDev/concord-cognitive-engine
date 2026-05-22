'use client';

import { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';
import { ListChecks, Plus, Trash2, Play, RotateCcw, Square, CheckCircle2, Circle, XCircle, Loader2 } from 'lucide-react';
import type { RobotRow } from './FleetManager';

interface MissionStep { index: number; command: string; status: string; durationMs: number; executedAt?: string }
interface Mission {
  id: string; name: string; robotId: string | null; priority: number;
  status: string; steps: MissionStep[]; currentStep: number; estimatedMs: number;
}

const STEP_ICON: Record<string, typeof Circle> = {
  pending: Circle, complete: CheckCircle2, failed: XCircle, aborted: XCircle, running: Loader2,
};
const STEP_COLOR: Record<string, string> = {
  pending: 'text-gray-500', complete: 'text-green-400', failed: 'text-red-400',
  aborted: 'text-gray-600', running: 'text-neon-cyan',
};
const MISSION_COLOR: Record<string, string> = {
  queued: 'text-yellow-400', running: 'text-neon-cyan', complete: 'text-green-400', failed: 'text-red-400',
};

/**
 * MissionSequencer — queue and execute multi-step robot programs.
 * Wires robotics.missionList / missionCreate / missionAdvance / missionRemove.
 */
export function MissionSequencer({ robots }: { robots: RobotRow[] }) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [robotId, setRobotId] = useState('');
  const [priority, setPriority] = useState('5');
  const [stepsText, setStepsText] = useState('MOVE_TO(0,0,0)\nCALIBRATE\nGRIP_OPEN\nGRIP_CLOSE');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('robotics', 'missionList', {});
    if (r.data?.ok && r.data.result) setMissions((r.data.result as { missions: Mission[] }).missions || []);
    else setErr(r.data?.error || 'Failed to load missions');
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim()) { setErr('Mission name required'); return; }
    const steps = stepsText.split('\n').map(s => s.trim()).filter(Boolean);
    if (steps.length === 0) { setErr('At least one step required'); return; }
    setBusy('create'); setErr(null);
    const r = await lensRun('robotics', 'missionCreate', {
      name: name.trim(), robotId: robotId || undefined,
      priority: parseInt(priority) || 5, steps,
    });
    if (r.data?.ok) { setName(''); await load(); }
    else setErr(r.data?.error || 'Create failed');
    setBusy(null);
  };

  const advance = async (missionId: string, op: 'step' | 'reset' | 'abort') => {
    setBusy(missionId); setErr(null);
    const r = await lensRun('robotics', 'missionAdvance', { missionId, op });
    if (r.data?.ok) await load();
    else setErr(r.data?.error || 'Advance failed');
    setBusy(null);
  };

  const remove = async (missionId: string) => {
    setBusy(missionId); setErr(null);
    const r = await lensRun('robotics', 'missionRemove', { missionId });
    if (r.data?.ok) await load();
    else setErr(r.data?.error || 'Remove failed');
    setBusy(null);
  };

  return (
    <div className="space-y-4">
      <div className="panel p-3">
        <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <ListChecks className="w-4 h-4 text-neon-cyan" /> New Mission Program
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Mission name"
            className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm" />
          <select value={robotId} onChange={e => setRobotId(e.target.value)}
            className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm">
            <option value="">Any robot</option>
            {robots.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <input value={priority} onChange={e => setPriority(e.target.value)} type="number" min="1" max="10"
            placeholder="Priority 1-10" className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-sm font-mono" />
        </div>
        <label className="text-[11px] text-gray-400 uppercase tracking-wide">Steps (one command per line)</label>
        <textarea value={stepsText} onChange={e => setStepsText(e.target.value)} rows={4}
          className="w-full bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs font-mono mt-1" />
        <button onClick={create} disabled={busy === 'create'}
          className="mt-2 px-3 py-1.5 bg-neon-cyan/20 text-neon-cyan rounded text-sm hover:bg-neon-cyan/30 disabled:opacity-50 flex items-center gap-1">
          {busy === 'create' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Queue Mission
        </button>
      </div>

      {err && <p className="text-xs text-red-400">{err}</p>}

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-neon-cyan" /></div>
      ) : missions.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-4">No missions queued.</p>
      ) : (
        <div className="space-y-3">
          {missions.map(m => {
            const done = m.steps.filter(s => s.status === 'complete').length;
            const pct = Math.round((done / m.steps.length) * 100);
            return (
              <div key={m.id} className="panel p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-[11px] font-bold">{m.priority}</span>
                    <span className="font-medium text-sm">{m.name}</span>
                    <span className={`text-[11px] uppercase ${MISSION_COLOR[m.status] || 'text-gray-400'}`}>{m.status}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => advance(m.id, 'step')} disabled={busy === m.id || m.status === 'complete' || m.status === 'failed'}
                      className="p-1.5 rounded bg-green-400/20 text-green-400 hover:bg-green-400/30 disabled:opacity-40" aria-label="Execute next step">
                      <Play className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => advance(m.id, 'reset')} disabled={busy === m.id}
                      className="p-1.5 rounded bg-white/10 text-gray-300 hover:bg-white/20 disabled:opacity-40" aria-label="Reset mission">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => advance(m.id, 'abort')} disabled={busy === m.id || m.status === 'complete'}
                      className="p-1.5 rounded bg-red-400/20 text-red-400 hover:bg-red-400/30 disabled:opacity-40" aria-label="Abort mission">
                      <Square className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(m.id)} disabled={busy === m.id}
                      className="p-1.5 rounded text-gray-500 hover:text-red-400" aria-label="Delete mission">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full mb-2">
                  <div className="h-full bg-neon-cyan rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <div className="space-y-1">
                  {m.steps.map(step => {
                    const Icon = STEP_ICON[step.status] || Circle;
                    return (
                      <div key={step.index} className={`flex items-center gap-2 text-xs ${step.index === m.currentStep && m.status === 'running' ? 'bg-neon-cyan/5 rounded px-1' : ''}`}>
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${STEP_COLOR[step.status] || 'text-gray-500'}`} />
                        <span className="font-mono text-gray-300">{step.command}</span>
                        <span className="ml-auto text-[10px] text-gray-500">{step.durationMs}ms</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-500 mt-1.5">
                  {done}/{m.steps.length} steps · est {Math.round(m.estimatedMs / 1000)}s total
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
