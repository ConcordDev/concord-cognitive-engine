'use client';

/**
 * WorkflowBuilder — no-code event→action wiring. A workflow has a
 * trigger and an ordered list of action steps. Backed by `app-maker`
 * workflow.* macros.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Zap, Plus, Trash2, ArrowDown, Save, Loader2, Power } from 'lucide-react';

interface Step { id?: string; action: string; target: string; config?: Record<string, unknown> }
interface Workflow { id: string; name: string; trigger: string; enabled: boolean; steps: Step[] }

export function WorkflowBuilder({
  projectId,
  onChanged,
}: {
  projectId: string;
  onChanged: () => void;
}) {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [triggers, setTriggers] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    const r = await lensRun('app-maker', 'projectGet', { projectId });
    if (r.data?.ok) setWorkflows(r.data.result?.project?.workflows ?? []);
  }

  useEffect(() => {
    lensRun('app-maker', 'workflowOptions', {}).then((r) => {
      if (r.data?.ok) {
        setTriggers(r.data.result?.triggers ?? []);
        setActions(r.data.result?.actions ?? []);
      }
    });
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function newWorkflow() {
    setEditing({
      id: '', name: 'New Workflow', trigger: triggers[0] ?? 'button_click', enabled: true,
      steps: [{ action: actions[0] ?? 'show_toast', target: '' }],
    });
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const r = await lensRun('app-maker', 'workflowSave', {
      projectId,
      workflow: {
        id: editing.id || undefined,
        name: editing.name, trigger: editing.trigger, enabled: editing.enabled,
        steps: editing.steps.map((s) => ({ action: s.action, target: s.target, params: s.config ?? {} })),
      },
    });
    setSaving(false);
    if (r.data?.ok) { setEditing(null); await refresh(); onChanged(); }
  }

  async function remove(id: string) {
    const r = await lensRun('app-maker', 'workflowDelete', { projectId, workflowId: id });
    if (r.data?.ok) { await refresh(); onChanged(); }
  }

  function patchStep(idx: number, patch: Partial<Step>) {
    if (!editing) return;
    setEditing({ ...editing, steps: editing.steps.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-pink-300">
            <Zap className="h-4 w-4" /> Workflows
          </h3>
          <button onClick={newWorkflow} className="inline-flex items-center gap-1 rounded bg-pink-600 px-2 py-1 text-[11px] text-white hover:bg-pink-500">
            <Plus className="h-3 w-3" /> Workflow
          </button>
        </div>
        <ul className="space-y-1.5">
          {workflows.map((w) => (
            <li key={w.id} className="rounded border border-pink-900/30 bg-pink-950/10 px-2.5 py-2 text-[11px]">
              <div className="flex items-center gap-2">
                <Power className={`h-3 w-3 ${w.enabled ? 'text-emerald-400' : 'text-pink-800'}`} />
                <button onClick={() => setEditing(w)} className="font-medium text-pink-100 hover:underline">{w.name}</button>
                <span className="rounded bg-pink-900/40 px-1.5 py-0.5 text-[9px] text-pink-300">{w.trigger}</span>
                <span className="text-pink-700">{w.steps.length} step{w.steps.length === 1 ? '' : 's'}</span>
                <button aria-label="Delete" onClick={() => remove(w.id)} className="ml-auto text-rose-400 hover:text-rose-300">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </li>
          ))}
          {!workflows.length && <li className="text-[11px] text-pink-700">No workflows yet — wire a trigger to an action.</li>}
        </ul>
      </div>

      {editing && (
        <div className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-3">
          <div className="mb-2 flex items-center gap-2">
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              className="flex-1 rounded border border-pink-900/40 bg-black/40 px-2 py-1 font-mono text-sm text-pink-100"
            />
            <label className="flex items-center gap-1 text-[10px] text-pink-400">
              <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
              enabled
            </label>
          </div>
          <label className="mb-2 block">
            <span className="mb-0.5 block text-[10px] uppercase text-pink-700">When (trigger)</span>
            <select
              value={editing.trigger}
              onChange={(e) => setEditing({ ...editing, trigger: e.target.value })}
              className="w-full rounded border border-pink-900/40 bg-black/40 px-1.5 py-1 text-[11px] text-pink-100"
            >
              {triggers.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div className="text-[10px] uppercase text-pink-700">Then (actions)</div>
          {editing.steps.map((s, i) => (
            <div key={i}>
              {i > 0 && <ArrowDown className="mx-auto my-0.5 h-3 w-3 text-pink-700" />}
              <div className="flex items-center gap-1.5 rounded border border-pink-900/30 bg-black/30 p-1.5">
                <select
                  value={s.action}
                  onChange={(e) => patchStep(i, { action: e.target.value })}
                  className="rounded border border-pink-900/40 bg-black/40 px-1 py-0.5 text-[11px] text-pink-100"
                >
                  {actions.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
                <input
                  value={s.target}
                  onChange={(e) => patchStep(i, { target: e.target.value })}
                  placeholder="target (table / page / state)"
                  className="flex-1 rounded border border-pink-900/40 bg-black/40 px-1.5 py-0.5 text-[11px] text-pink-100"
                />
                <button
                  onClick={() => setEditing({ ...editing, steps: editing.steps.filter((_, x) => x !== i) })}
                  className="text-rose-400 hover:text-rose-300"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setEditing({ ...editing, steps: [...editing.steps, { action: actions[0] ?? 'show_toast', target: '' }] })}
              className="rounded bg-pink-950/40 px-2 py-1 text-[11px] text-pink-300 hover:text-pink-100"
            >
              + Action
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded bg-pink-600 px-2.5 py-1 text-[11px] text-white hover:bg-pink-500 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
            </button>
            <button onClick={() => setEditing(null)} className="rounded px-2 py-1 text-[11px] text-pink-600 hover:text-pink-400">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
