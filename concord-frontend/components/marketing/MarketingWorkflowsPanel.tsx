'use client';

/**
 * MarketingWorkflowsPanel — trigger → delay → branch nurture automation.
 * Wires: workflow-create, workflow-update, workflow-list, workflow-delete,
 * workflow-enroll, workflow-runs.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Workflow, Trash2, Play, X, UserPlus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';
import { cn } from '@/lib/utils';

type StepType = 'trigger' | 'delay' | 'send_email' | 'branch' | 'tag' | 'goal';
const STEP_TYPES: StepType[] = ['trigger', 'delay', 'send_email', 'branch', 'tag', 'goal'];

interface WfStep { type: StepType; label: string; delayHours: number; emailId: string | null; condition: string | null }
interface Workflow {
  id: string; name: string; description: string | null; triggerType: string;
  steps: WfStep[]; stepCount: number; status: string;
  enrolled: number; completed: number; completionRate: number;
}
interface WfRunTrace { type: string; label: string; atHour: number; branch?: string }
interface WfRun { id: string; workflowId: string; contact: string; durationHours: number; reachedGoal: boolean; stepsRun: number; trace: WfRunTrace[] }

export function MarketingWorkflowsPanel() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [busy, setBusy] = useState(false);

  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fSteps, setFSteps] = useState<WfStep[]>([]);

  const [enrollTarget, setEnrollTarget] = useState<string | null>(null);
  const [contact, setContact] = useState('');

  const [runsFor, setRunsFor] = useState<string | null>(null);
  const [runs, setRuns] = useState<WfRun[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('marketing', 'workflow-list', {});
    setWorkflows(r.data?.result?.workflows || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openCreate = () => {
    setEditing(null); setCreating(true);
    setFName(''); setFDesc(''); setFSteps([]);
  };
  const openEdit = (w: Workflow) => {
    setEditing(w); setCreating(true);
    setFName(w.name); setFDesc(w.description || ''); setFSteps(w.steps.map((s) => ({ ...s })));
  };

  const addStep = (type: StepType) =>
    setFSteps((s) => [...s, { type, label: '', delayHours: 0, emailId: null, condition: null }]);
  const updateStep = (i: number, patch: Partial<WfStep>) =>
    setFSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));
  const removeStep = (i: number) => setFSteps((s) => s.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!fName.trim()) { setError('Workflow name is required.'); return; }
    setBusy(true); setError(null);
    const payload = { name: fName.trim(), description: fDesc.trim(), steps: fSteps };
    const r = editing
      ? await lensRun('marketing', 'workflow-update', { id: editing.id, ...payload })
      : await lensRun('marketing', 'workflow-create', payload);
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setCreating(false);
    await refresh();
  };

  const setStatus = async (id: string, status: string) => {
    const r = await lensRun('marketing', 'workflow-update', { id, status });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    await refresh();
  };

  const del = async (id: string) => {
    const r = await lensRun('marketing', 'workflow-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    await refresh();
  };

  const enroll = async () => {
    if (!enrollTarget || !contact.trim()) { setError('Contact is required.'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('marketing', 'workflow-enroll', { id: enrollTarget, contact: contact.trim() });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Enroll failed'); return; }
    setEnrollTarget(null); setContact('');
    await refresh();
  };

  const viewRuns = async (id: string) => {
    setRunsFor(id);
    const r = await lensRun('marketing', 'workflow-runs', { id });
    setRuns(r.data?.result?.runs || []);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <Workflow className="w-3.5 h-3.5 text-orange-400" /> Automation workflows
        </h3>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> New workflow
        </button>
      </div>

      {workflows.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No workflows yet. Chain trigger → delay → email → branch steps.</p>
      ) : (
        <ul className="space-y-2">
          {workflows.map((w) => (
            <li key={w.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{w.name}</p>
                  <p className="text-[11px] text-zinc-500">
                    {w.stepCount} steps · {w.enrolled} enrolled · {w.completionRate}% completed · {w.status}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => openEdit(w)}
                    className="text-[11px] text-zinc-300 hover:text-white px-2 py-1 rounded border border-zinc-700">Edit</button>
                  {w.status !== 'active'
                    ? <button type="button" onClick={() => setStatus(w.id, 'active')}
                        className="text-[11px] text-emerald-300 hover:text-emerald-200 px-2 py-1 rounded border border-emerald-800/60">Activate</button>
                    : <button type="button" onClick={() => setStatus(w.id, 'paused')}
                        className="text-[11px] text-amber-300 hover:text-amber-200 px-2 py-1 rounded border border-amber-800/60">Pause</button>}
                  <button type="button" onClick={() => setEnrollTarget(w.id)} disabled={w.status !== 'active'}
                    className="flex items-center gap-1 text-[11px] text-blue-300 hover:text-blue-200 px-2 py-1 rounded border border-blue-800/60 disabled:opacity-40">
                    <UserPlus className="w-3 h-3" /> Enroll
                  </button>
                  <button type="button" onClick={() => viewRuns(w.id)}
                    className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-white px-2 py-1 rounded border border-zinc-700">
                    <Play className="w-3 h-3" /> Runs
                  </button>
                  <button type="button" onClick={() => del(w.id)} aria-label="Delete workflow"
                    className="text-rose-400 hover:text-rose-300 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {w.steps.map((st, i) => (
                  <span key={i} className="text-[10px] bg-zinc-800 text-zinc-300 rounded px-1.5 py-0.5">
                    {st.label || st.type}{st.type === 'delay' ? ` (${st.delayHours}h)` : ''}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Builder modal */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCreating(false)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3"
            onClick={(ev) => ev.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">{editing ? 'Edit' : 'New'} workflow</h4>
              <button type="button" onClick={() => setCreating(false)} aria-label="Close"><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            <input placeholder="Workflow name" value={fName} onChange={(e) => setFName(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Description" value={fDesc} onChange={(e) => setFDesc(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            <div className="flex flex-wrap gap-1">
              {STEP_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => addStep(t)}
                  className="text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded px-2 py-1">+ {t.replace('_', ' ')}</button>
              ))}
            </div>
            {fSteps.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic">Add steps to define the nurture sequence.</p>
            ) : (
              <ul className="space-y-1.5">
                {fSteps.map((st, i) => (
                  <li key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">{i + 1}. {st.type.replace('_', ' ')}</span>
                      <button type="button" onClick={() => removeStep(i)} aria-label="Remove step"
                        className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3 h-3" /></button>
                    </div>
                    <input value={st.label} onChange={(e) => updateStep(i, { label: e.target.value })}
                      placeholder="Step label" className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
                    {st.type === 'delay' && (
                      <input type="number" min={0} value={st.delayHours}
                        onChange={(e) => updateStep(i, { delayHours: Number(e.target.value) || 0 })}
                        placeholder="Delay hours" className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
                    )}
                    {st.type === 'branch' && (
                      <input value={st.condition || ''} onChange={(e) => updateStep(i, { condition: e.target.value })}
                        placeholder="Branch condition" className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setCreating(false)}
                className="text-xs text-zinc-400 hover:text-white px-3 py-1.5">Cancel</button>
              <button type="button" onClick={save} disabled={busy}
                className={cn('text-xs font-medium rounded-lg px-3 py-1.5 text-white',
                  busy ? 'bg-zinc-700' : 'bg-orange-600 hover:bg-orange-500')}>
                {busy ? 'Saving…' : 'Save workflow'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Enroll modal */}
      {enrollTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setEnrollTarget(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3"
            onClick={(ev) => ev.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <h4 className="text-sm font-semibold text-white">Enroll a contact</h4>
            <input value={contact} onChange={(e) => setContact(e.target.value)}
              placeholder="contact@example.com" className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEnrollTarget(null)}
                className="text-xs text-zinc-400 hover:text-white px-3 py-1.5">Cancel</button>
              <button type="button" onClick={enroll} disabled={busy}
                className={cn('text-xs font-medium rounded-lg px-3 py-1.5 text-white',
                  busy ? 'bg-zinc-700' : 'bg-blue-600 hover:bg-blue-500')}>
                {busy ? 'Enrolling…' : 'Enroll'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Runs modal */}
      {runsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setRunsFor(null)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3"
            onClick={(ev) => ev.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">Workflow runs ({runs.length})</h4>
              <button type="button" onClick={() => setRunsFor(null)} aria-label="Close"><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            {runs.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic">No runs yet. Enroll a contact to simulate the sequence.</p>
            ) : (
              <ul className="space-y-3">
                {runs.map((run) => {
                  const events: TimelineEvent[] = run.trace.map((t, i) => ({
                    id: `${run.id}-${i}`,
                    label: t.label || t.type,
                    time: t.atHour * 3_600_000,
                    tone: t.type === 'goal' ? 'good' : t.type === 'branch' ? 'warn' : 'info',
                    detail: t.branch ? `branch: ${t.branch}` : t.type,
                  }));
                  return (
                    <li key={run.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs text-zinc-200">{run.contact}</span>
                        <span className={cn('text-[10px]', run.reachedGoal ? 'text-emerald-300' : 'text-zinc-500')}>
                          {run.reachedGoal ? 'reached goal' : 'in progress'} · {run.durationHours}h
                        </span>
                      </div>
                      <TimelineView events={events} height={90} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
