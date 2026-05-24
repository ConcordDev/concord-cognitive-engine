'use client';

/* eslint-disable react-hooks/exhaustive-deps */

/**
 * InspectionChecklists — authored NEC inspection checklist templates per
 * job type (rough-in, service, final, EV charger). Instantiate a checklist,
 * mark each item pass/fail/critical, get a live verdict. Persists via the
 * electrical.checklist* macros.
 */

import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ClipboardCheck, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface ChecklistItem { id: string; name: string; necCode: string; passed: boolean | null; critical: boolean; notes: string }
interface Checklist { id: string; template: string; label: string; jobName: string; items: ChecklistItem[] }
interface Template { key: string; label: string; itemCount: number }
interface Progress { checked: number; total: number; passed: number; failed: number; criticalFailures: number; verdict: string }

export function InspectionChecklists() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [newTpl, setNewTpl] = useState('rough_in');
  const [jobName, setJobName] = useState('');

  const refreshTemplates = useCallback(async () => {
    const r = await lensRun<{ templates: Template[] }>('electrical', 'checklistTemplates', {});
    const list = r.data.result?.templates || [];
    setTemplates(list);
    if (list.length) setNewTpl((cur) => list.some((t) => t.key === cur) ? cur : list[0].key);
  }, []);
  const refreshChecklists = useCallback(async () => {
    const r = await lensRun<{ checklists: Checklist[] }>('electrical', 'checklistList', {});
    const list = r.data.result?.checklists || [];
    setChecklists(list);
    if (list.length && !activeId) setActiveId(list[0].id);
  }, [activeId]);

  useEffect(() => { refreshTemplates(); refreshChecklists(); }, []);

  const active = checklists.find((c) => c.id === activeId) || null;

  const createChecklist = useMutation({
    mutationFn: async () => {
      const r = await lensRun<Checklist>('electrical', 'checklistCreate', { template: newTpl, jobName: jobName || undefined });
      await refreshChecklists();
      if (r.data.result) setActiveId(r.data.result.id);
      setJobName('');
    },
  });

  const setItem = useMutation({
    mutationFn: async (args: { itemId: string; passed?: boolean; critical?: boolean; notes?: string }) => {
      if (!activeId) return;
      const r = await lensRun<{ checklist: Checklist; progress: Progress }>('electrical', 'checklistSetItem', {
        checklistId: activeId, ...args,
      });
      if (r.data.result) {
        setChecklists((cs) => cs.map((c) => c.id === activeId ? r.data.result!.checklist : c));
        setProgress((p) => ({ ...p, [activeId]: r.data.result!.progress }));
      }
    },
  });

  const deleteChecklist = useMutation({
    mutationFn: async (checklistId: string) => {
      await lensRun('electrical', 'checklistDelete', { checklistId });
      setActiveId(null);
      await refreshChecklists();
    },
  });

  const prog = activeId ? progress[activeId] : null;

  return (
    <div className="overflow-hidden rounded-xl border border-rose-500/20 bg-gradient-to-br from-zinc-950 via-rose-950/10 to-zinc-950">
      <header className="flex items-center gap-2 border-b border-rose-500/20 bg-zinc-900/40 px-4 py-2">
        <ClipboardCheck className="h-4 w-4 text-rose-400" />
        <span className="text-sm font-semibold text-white">Inspection checklists</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">electrical.checklist*</span>
      </header>

      <div className="p-4 space-y-3">
        {/* create from template */}
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-rose-500/15 bg-zinc-950/40 p-3">
          <label className="flex-1 min-w-[160px]"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Template</span>
            <select value={newTpl} onChange={(e) => setNewTpl(e.target.value)} className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white">
              {templates.map((t) => <option key={t.key} value={t.key}>{t.label} ({t.itemCount} items)</option>)}
            </select>
          </label>
          <label className="flex-1 min-w-[160px]"><span className="block text-[10px] uppercase tracking-wider text-zinc-400">Job name (optional)</span>
            <input value={jobName} onChange={(e) => setJobName(e.target.value)} placeholder="e.g. 123 Oak St — Rough-In" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-white" />
          </label>
          <button type="button" onClick={() => createChecklist.mutate()} disabled={createChecklist.isPending} className="rounded bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-50">
            {createChecklist.isPending ? <Loader2 className="mx-auto h-3.5 w-3.5 animate-spin" /> : 'Create checklist'}
          </button>
        </div>

        {checklists.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {checklists.map((c) => (
              <button key={c.id} type="button" onClick={() => setActiveId(c.id)} className={`rounded px-2.5 py-1 text-xs ${activeId === c.id ? 'bg-rose-500/20 text-rose-200 border border-rose-500/40' : 'border border-zinc-800 text-zinc-400 hover:text-white'}`}>
                {c.jobName}
              </button>
            ))}
          </div>
        )}

        {checklists.length === 0 && <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-400">No checklists yet. Pick a template above to instantiate one.</div>}

        {active && (
          <div className="space-y-2">
            {prog && (
              <div className={`rounded-lg border-2 px-3 py-2 ${prog.verdict === 'PASS' ? 'border-emerald-500/40 bg-emerald-500/10' : prog.verdict.startsWith('FAIL') ? 'border-rose-500/40 bg-rose-500/10' : prog.verdict === 'CONDITIONAL' ? 'border-amber-500/40 bg-amber-500/10' : 'border-zinc-700 bg-zinc-900/40'}`}>
                <div className="flex items-center justify-between">
                  <span className={`font-mono text-lg font-bold ${prog.verdict === 'PASS' ? 'text-emerald-100' : prog.verdict.startsWith('FAIL') ? 'text-rose-100' : prog.verdict === 'CONDITIONAL' ? 'text-amber-100' : 'text-zinc-300'}`}>{prog.verdict}</span>
                  <span className="text-[11px] text-zinc-400">{prog.checked}/{prog.total} checked · {prog.passed} pass · {prog.failed} fail · {prog.criticalFailures} critical</span>
                </div>
              </div>
            )}

            {active.items.map((it) => (
              <div key={it.id} className={`rounded border px-2 py-1.5 ${it.passed === true ? 'border-emerald-500/15 bg-emerald-500/5' : it.passed === false ? 'border-rose-500/25 bg-rose-500/5' : 'border-zinc-800 bg-zinc-950/40'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] text-zinc-100">{it.name}</div>
                    <div className="font-mono text-[9px] text-zinc-400">NEC {it.necCode}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button type="button" onClick={() => setItem.mutate({ itemId: it.id, passed: true })} className={`rounded px-1.5 py-0.5 text-[10px] ${it.passed === true ? 'bg-emerald-500 text-black' : 'border border-zinc-700 text-zinc-400 hover:text-emerald-300'}`}>Pass</button>
                    <button type="button" onClick={() => setItem.mutate({ itemId: it.id, passed: false })} className={`rounded px-1.5 py-0.5 text-[10px] ${it.passed === false ? 'bg-rose-500 text-white' : 'border border-zinc-700 text-zinc-400 hover:text-rose-300'}`}>Fail</button>
                    <label className="flex items-center gap-1 rounded border border-zinc-700 px-1 py-0.5 text-[10px] text-rose-300">
                      <input type="checkbox" checked={it.critical} onChange={(e) => setItem.mutate({ itemId: it.id, critical: e.target.checked })} />Crit
                    </label>
                  </div>
                </div>
                <input value={it.notes} onChange={(e) => setItem.mutate({ itemId: it.id, notes: e.target.value })} placeholder="Notes…" className="mt-1 w-full rounded border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-300" />
              </div>
            ))}

            <button type="button" onClick={() => deleteChecklist.mutate(active.id)} className="text-[10px] text-zinc-400 hover:text-rose-400">Delete this checklist</button>
          </div>
        )}
      </div>
    </div>
  );
}
