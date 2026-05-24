'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardCheck, Plus, Trash2, Play, Check, SkipForward, ArrowLeft, AlertTriangle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { RunButton } from '@/components/science/ScienceWorkbench';

type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';
interface RunStep {
  index: number;
  label: string;
  status: StepStatus;
  startedAt: string | null;
  completedAt: string | null;
  note: string;
  deviation: boolean;
}
interface ProtocolRun {
  id: string;
  protocolName: string;
  operator: string;
  status: 'in_progress' | 'completed';
  startedAt: string;
  completedAt: string | null;
  currentStep: number;
  steps: RunStep[];
  outcome?: string;
  deviationCount?: number;
}

/**
 * Protocol run log — track an experiment step-by-step against its protocol.
 */
export function ScienceProtocolRuns() {
  const [runs, setRuns] = useState<ProtocolRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<ProtocolRun | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [operator, setOperator] = useState('');
  const [stepsText, setStepsText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ runs: ProtocolRun[] }>('science', 'protorun-list', {});
    if (r.data?.ok && r.data.result) setRuns(r.data.result.runs || []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = async () => {
    const steps = stepsText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (!name.trim()) { setMsg('Protocol name required'); return; }
    if (steps.length === 0) { setMsg('At least one step required'); return; }
    setBusy(true); setMsg(null);
    const r = await lensRun<{ run: ProtocolRun }>('science', 'protorun-start', {
      protocolName: name.trim(),
      operator: operator.trim() || undefined,
      steps,
    });
    if (r.data?.ok && r.data.result?.run) {
      setActive(r.data.result.run);
      setCreating(false);
      setName(''); setOperator(''); setStepsText('');
      await refresh();
    } else setMsg(r.data?.error || 'Failed to start run');
    setBusy(false);
  };

  const updateStep = async (run: ProtocolRun, idx: number, status: StepStatus,
    extra: { note?: string; deviation?: boolean } = {}) => {
    setBusy(true);
    const r = await lensRun<{ run: ProtocolRun }>('science', 'protorun-step', {
      id: run.id, stepIndex: idx, status, ...extra,
    });
    if (r.data?.ok && r.data.result?.run) {
      setActive(r.data.result.run);
      await refresh();
    } else setMsg(r.data?.error || 'Step update failed');
    setBusy(false);
  };

  const complete = async (run: ProtocolRun, outcome: string) => {
    setBusy(true);
    const r = await lensRun<{ run: ProtocolRun }>('science', 'protorun-complete', {
      id: run.id, outcome,
    });
    if (r.data?.ok && r.data.result?.run) {
      setActive(r.data.result.run);
      await refresh();
    } else setMsg(r.data?.error || 'Complete failed');
    setBusy(false);
  };

  const del = async (id: string) => {
    setBusy(true);
    const r = await lensRun('science', 'protorun-delete', { id });
    if (r.data?.ok) { if (active?.id === id) setActive(null); await refresh(); }
    else setMsg(r.data?.error || 'Delete failed');
    setBusy(false);
  };

  if (creating) {
    return (
      <div className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCreating(false)}
            className="p-1 rounded hover:bg-white/5 text-gray-400" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-gray-200">Start Protocol Run</span>
        </div>
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Protocol name"
          className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
        />
        <input
          value={operator} onChange={(e) => setOperator(e.target.value)}
          placeholder="Operator (optional)"
          className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
        />
        <textarea
          value={stepsText} onChange={(e) => setStepsText(e.target.value)}
          rows={6}
          placeholder="Protocol steps — one per line"
          className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 resize-none"
        />
        <RunButton onClick={create} busy={busy}>
          <Play className="w-3 h-3" /> Begin Run
        </RunButton>
        {msg && <p className="text-xs text-gray-400">{msg}</p>}
      </div>
    );
  }

  if (active) {
    const run = active;
    const done = run.steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
    return (
      <div className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setActive(null)}
            className="p-1 rounded hover:bg-white/5 text-gray-400" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-gray-200 truncate">{run.protocolName}</span>
          <span className={cn(
            'ml-auto text-[10px] px-1.5 py-0.5 rounded',
            run.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300',
          )}>
            {run.status.replace('_', ' ')}
          </span>
        </div>
        <div className="h-1.5 bg-black/40 rounded overflow-hidden">
          <div className="h-full bg-teal-400 transition-all"
            style={{ width: `${run.steps.length ? (done / run.steps.length) * 100 : 0}%` }} />
        </div>
        <p className="text-[11px] text-gray-400">
          {done}/{run.steps.length} steps · operator {run.operator}
        </p>

        <ol className="space-y-1.5">
          {run.steps.map((step) => (
            <li key={step.index} className="rounded border border-white/10 bg-black/30 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <span className={cn(
                  'text-[10px] w-5 h-5 rounded-full flex items-center justify-center shrink-0',
                  step.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300'
                    : step.status === 'skipped' ? 'bg-gray-500/20 text-gray-400'
                    : step.status === 'in_progress' ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-white/5 text-gray-400',
                )}>
                  {step.index + 1}
                </span>
                <span className="text-xs text-gray-200 flex-1">{step.label}</span>
                {step.deviation && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
              </div>
              {run.status !== 'completed' && step.status !== 'completed' && step.status !== 'skipped' && (
                <div className="flex items-center gap-1.5 mt-1.5 pl-7">
                  {step.status === 'pending' && (
                    <button type="button" disabled={busy}
                      onClick={() => updateStep(run, step.index, 'in_progress')}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-300">
                      <Play className="w-2.5 h-2.5 inline" /> Start
                    </button>
                  )}
                  <button type="button" disabled={busy}
                    onClick={() => updateStep(run, step.index, 'completed')}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-500/40 text-emerald-300">
                    <Check className="w-2.5 h-2.5 inline" /> Done
                  </button>
                  <button type="button" disabled={busy}
                    onClick={() => updateStep(run, step.index, 'skipped')}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-gray-400">
                    <SkipForward className="w-2.5 h-2.5 inline" /> Skip
                  </button>
                  <button type="button" disabled={busy}
                    onClick={() => updateStep(run, step.index, step.status, { deviation: !step.deviation })}
                    className={cn('text-[10px] px-1.5 py-0.5 rounded border',
                      step.deviation ? 'border-amber-500/40 text-amber-300' : 'border-white/10 text-gray-400')}>
                    Deviation
                  </button>
                </div>
              )}
              {step.note && <p className="text-[10px] text-gray-400 pl-7 mt-1">{step.note}</p>}
            </li>
          ))}
        </ol>

        {run.status !== 'completed' && (
          <CompleteForm onComplete={(o) => complete(run, o)} busy={busy} />
        )}
        {run.status === 'completed' && (
          <div className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2 text-xs">
            <p className="text-emerald-300">Run completed</p>
            {run.outcome && <p className="text-gray-300 mt-1">{run.outcome}</p>}
            <p className="text-[10px] text-gray-400 mt-1">
              {run.deviationCount ?? 0} deviation(s) recorded
            </p>
          </div>
        )}
        {msg && <p className="text-xs text-gray-400">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
          <ClipboardCheck className="w-4 h-4 text-teal-400" /> Protocol Runs
        </h3>
        <RunButton onClick={() => { setCreating(true); setMsg(null); }} busy={false}>
          <Plus className="w-3 h-3" /> New Run
        </RunButton>
      </div>
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="text-xs text-gray-400">No protocol runs yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {runs.map((run) => {
            const done = run.steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
            return (
              <li key={run.id}
                className="flex items-center justify-between rounded border border-white/10 bg-black/30 px-3 py-2">
                <button type="button" onClick={() => setActive(run)} className="text-left flex-1 min-w-0">
                  <span className="block text-xs text-gray-100 truncate">{run.protocolName}</span>
                  <span className="block text-[10px] text-gray-400">
                    {done}/{run.steps.length} steps · {run.status.replace('_', ' ')}
                  </span>
                </button>
                <button type="button" onClick={() => del(run.id)}
                  className="p-1 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400"
                  aria-label="Delete run">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {msg && <p className="text-xs text-gray-400">{msg}</p>}
    </div>
  );
}

function CompleteForm({ onComplete, busy }: { onComplete: (o: string) => void; busy: boolean }) {
  const [outcome, setOutcome] = useState('');
  return (
    <div className="space-y-1.5 pt-2 border-t border-white/10">
      <textarea
        value={outcome} onChange={(e) => setOutcome(e.target.value)}
        rows={2}
        placeholder="Run outcome / summary"
        className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 resize-none"
      />
      <RunButton onClick={() => onComplete(outcome)} busy={busy}>
        <Check className="w-3 h-3" /> Complete Run
      </RunButton>
    </div>
  );
}

export default ScienceProtocolRuns;
