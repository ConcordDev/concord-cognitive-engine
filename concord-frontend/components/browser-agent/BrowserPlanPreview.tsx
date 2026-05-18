'use client';

import { useEffect, useState, useCallback } from 'react';
import { callBrowserAgentMacro } from '@/lib/api/browser-agent';
import { Loader2, Check, X, Sparkles, ListChecks, RefreshCw } from 'lucide-react';

interface PlanStep { step: number; action: string; target?: string; expected?: string; ifFails?: string; thought?: string; }

interface Plan {
  id: number; revision: number; status: string; author: string;
  steps: PlanStep[];
  created_at: number;
}

interface Props {
  open: boolean;
  taskId: string | null;
  onClose: () => void;
  onApproved: () => void;
}

export function BrowserPlanPreview({ open, taskId, onClose, onApproved }: Props) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!taskId) return;
    const r = await callBrowserAgentMacro<{ plans?: Plan[] }>('plan_list', { taskId });
    setPlans(r?.plans || []);
  }, [taskId]);

  const compose = useCallback(async () => {
    if (!taskId) return;
    setComposing(true); setError(null);
    try {
      const r = await callBrowserAgentMacro('ai_compose_plan', { taskId });
      if (!r.ok) setError(r.reason || 'compose_failed');
      else load();
    } finally { setComposing(false); }
  }, [taskId, load]);

  const decide = useCallback(async (planId: number, decision: 'approved' | 'rejected') => {
    setBusy(true); setError(null);
    try {
      const r = await callBrowserAgentMacro('plan_decide', { planId, decision });
      if (r.ok) { onApproved(); onClose(); }
      else setError(r.reason || 'decide_failed');
    } finally { setBusy(false); }
  }, [onApproved, onClose]);

  useEffect(() => {
    if (open && taskId) {
      load();
      // Auto-compose if no plans exist yet
      (async () => {
        const r = await callBrowserAgentMacro<{ plans?: Plan[] }>('plan_list', { taskId });
        if (!r?.plans?.length) compose();
      })();
    }
  }, [open, taskId, load, compose]);

  if (!open) return null;
  const latest = plans.find((p) => p.status === 'pending') || plans[0];

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-20 p-4">
      <div className="bg-zinc-900 border border-cyan-500/30 rounded-lg w-full max-w-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center justify-between p-3 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-cyan-400" /> Agent plan
            {latest && <span className="text-xs text-white/40 font-normal">rev {latest.revision}</span>}
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={compose} disabled={composing} className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-white/70 flex items-center gap-1">
              {composing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Re-plan
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-2">
          {composing && (
            <div className="text-center py-8 text-white/60 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Composing plan…
            </div>
          )}
          {!composing && !latest && (
            <div className="text-center text-white/40 text-sm py-8">No plan yet. Click Re-plan to compose one.</div>
          )}
          {!composing && latest && latest.steps.length > 0 && (
            <ol className="space-y-2">
              {latest.steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3 p-2 bg-white/5 rounded">
                  <span className="text-cyan-300 font-mono text-xs mt-0.5 w-6 flex-shrink-0">{step.step ?? i + 1}.</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white font-medium">
                      <span className="uppercase text-xs text-white/60 mr-2">{step.action}</span>
                      {step.target && <span className="text-white/80">{step.target}</span>}
                    </div>
                    {step.expected && <div className="text-xs text-white/60 mt-0.5">Expected: {step.expected}</div>}
                    {step.ifFails && <div className="text-xs text-amber-300/80 mt-0.5">If fails: {step.ifFails}</div>}
                    {step.thought && <div className="text-xs text-white/40 italic mt-0.5">{step.thought}</div>}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {error && <div className="text-xs text-red-400">{error}</div>}
        </div>
        {latest?.status === 'pending' && (
          <div className="flex justify-end gap-2 p-3 border-t border-white/10">
            <button onClick={() => decide(latest.id, 'rejected')} disabled={busy} className="px-3 py-1.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-300 text-sm disabled:opacity-40 flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> Reject
            </button>
            <button onClick={() => decide(latest.id, 'approved')} disabled={busy} className="px-4 py-1.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm font-medium disabled:opacity-40 flex items-center gap-2">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Approve + run
            </button>
          </div>
        )}
        {latest && latest.status !== 'pending' && (
          <div className="p-3 border-t border-white/10 text-xs text-white/40 text-center">
            Plan status: <span className="uppercase">{latest.status}</span>
          </div>
        )}
      </div>
    </div>
  );
}
