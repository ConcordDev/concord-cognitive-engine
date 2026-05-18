'use client';

import { useState, useEffect, useCallback } from 'react';
import { callBrowserAgentMacro, type BrowserBudget } from '@/lib/api/browser-agent';
import { X, Loader2, Bot, ShieldCheck } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  budget: (BrowserBudget & { concurrentActive?: number }) | null;
  onCreated: () => void;
}

const APPROVAL_OPTIONS = [
  { value: 'off',                label: 'Off — never pause' },
  { value: 'destructive_only',   label: 'Destructive only (recommended)' },
  { value: 'every_step',         label: 'Every step (debug)' },
];

export function BrowserTaskCreate({ open, onClose, budget, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('');
  const [startingUrl, setStartingUrl] = useState('');
  const [approvalMode, setApprovalMode] = useState<'off'|'destructive_only'|'every_step'>('destructive_only');
  const [maxSteps, setMaxSteps] = useState(30);
  const [maxCostCents, setMaxCostCents] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(''); setGoal(''); setStartingUrl(''); setMaxSteps(30); setMaxCostCents(null); setError(null); setBusy(false);
      if (budget?.approval_mode_default) setApprovalMode(budget.approval_mode_default);
    }
  }, [open, budget]);

  const submit = useCallback(async () => {
    if (!title.trim() || !goal.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await callBrowserAgentMacro<{ id?: string; reason?: string }>('task_create', {
        title, goal,
        startingUrl: startingUrl || undefined,
        approvalMode, maxSteps,
        maxCostCents,
      });
      if (r.ok) onCreated();
      else setError(r.reason || 'create_failed');
    } catch (e: unknown) {
      setError((e as Error)?.message || 'create_failed');
    } finally { setBusy(false); }
  }, [title, goal, startingUrl, approvalMode, maxSteps, maxCostCents, onCreated]);

  if (!open) return null;
  const concurrentBlocked = budget && budget.concurrentActive != null && budget.concurrentActive >= (budget.concurrent_task_max || 3);

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-24 p-4">
      <div className="bg-zinc-900 border border-white/10 rounded-lg w-full max-w-xl">
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-cyan-400" /> New browser task
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          {concurrentBlocked && (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded p-2">
              You're at the concurrent-task cap ({budget?.concurrent_task_max}). Pause or cancel a running task first, or raise the cap in budget settings.
            </div>
          )}
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="Task name (e.g. 'Scrape HN front page')" className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white" />
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={4} placeholder="Describe what the agent should do, step by step if you like." className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white resize-none" />
          <input value={startingUrl} onChange={(e) => setStartingUrl(e.target.value)} placeholder="Starting URL (optional)" className="w-full px-2 py-1.5 text-sm bg-white/5 border border-white/10 rounded text-white" />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-white/40 flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> Approval mode</label>
              <select value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as typeof approvalMode)} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white">
                {APPROVAL_OPTIONS.map((o) => <option key={o.value} value={o.value} className="bg-black">{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-white/40">Max steps</label>
              <input type="number" min="1" max="500" value={maxSteps} onChange={(e) => setMaxSteps(Number(e.target.value) || 30)} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-white/40">Max cost (¢) — leave blank for default {budget?.per_task_default_cents ?? 100}¢</label>
              <input type="number" min="1" value={maxCostCents ?? ''} onChange={(e) => setMaxCostCents(e.target.value ? Number(e.target.value) : null)} placeholder={String(budget?.per_task_default_cents ?? 100)} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
            </div>
          </div>
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 p-3 border-t border-white/10">
          <button onClick={onClose} className="px-3 py-1.5 rounded hover:bg-white/10 text-white/70 text-sm">Cancel</button>
          <button
            onClick={submit}
            disabled={busy || !title.trim() || !goal.trim() || concurrentBlocked}
            className="px-4 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 flex items-center gap-2"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bot className="w-3.5 h-3.5" />}
            Launch agent
          </button>
        </div>
      </div>
    </div>
  );
}
