'use client';

import { useState, useEffect, useCallback } from 'react';
import { callBrowserAgentMacro, type BrowserBudget } from '@/lib/api/browser-agent';
import { Loader2, Save, Settings } from 'lucide-react';

interface Props { budget: (BrowserBudget & Record<string, unknown>) | null; onSaved: () => void; }

export function BrowserBudgetSettings({ budget, onSaved }: Props) {
  const [draft, setDraft] = useState({
    dailyCentsCap: 500,
    monthlyCentsCap: 5000,
    perTaskDefaultCents: 100,
    concurrentTaskMax: 3,
    approvalModeDefault: 'destructive_only' as 'off' | 'destructive_only' | 'every_step',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (budget) {
      setDraft({
        dailyCentsCap: budget.daily_cents_cap,
        monthlyCentsCap: budget.monthly_cents_cap,
        perTaskDefaultCents: budget.per_task_default_cents,
        concurrentTaskMax: budget.concurrent_task_max,
        approvalModeDefault: budget.approval_mode_default,
      });
    }
  }, [budget]);

  const save = useCallback(async () => {
    setBusy(true);
    try { await callBrowserAgentMacro('budget_update', draft); onSaved(); }
    finally { setBusy(false); }
  }, [draft, onSaved]);

  return (
    <div className="p-3 space-y-3">
      <h3 className="text-xs uppercase tracking-wide text-white/40 flex items-center gap-1">
        <Settings className="w-3 h-3" /> Budget settings
      </h3>
      <div>
        <label className="text-xs text-white/60">Daily cap (¢)</label>
        <input type="number" min="0" value={draft.dailyCentsCap} onChange={(e) => setDraft({ ...draft, dailyCentsCap: Number(e.target.value) || 0 })} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
      </div>
      <div>
        <label className="text-xs text-white/60">Monthly cap (¢)</label>
        <input type="number" min="0" value={draft.monthlyCentsCap} onChange={(e) => setDraft({ ...draft, monthlyCentsCap: Number(e.target.value) || 0 })} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
      </div>
      <div>
        <label className="text-xs text-white/60">Per-task default (¢)</label>
        <input type="number" min="0" value={draft.perTaskDefaultCents} onChange={(e) => setDraft({ ...draft, perTaskDefaultCents: Number(e.target.value) || 0 })} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
      </div>
      <div>
        <label className="text-xs text-white/60">Concurrent task max</label>
        <input type="number" min="0" max="20" value={draft.concurrentTaskMax} onChange={(e) => setDraft({ ...draft, concurrentTaskMax: Number(e.target.value) || 0 })} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white" />
      </div>
      <div>
        <label className="text-xs text-white/60">Default approval mode</label>
        <select value={draft.approvalModeDefault} onChange={(e) => setDraft({ ...draft, approvalModeDefault: e.target.value as typeof draft.approvalModeDefault })} className="w-full mt-1 px-2 py-1 text-sm bg-white/5 border border-white/10 rounded text-white">
          <option value="off" className="bg-black">Off</option>
          <option value="destructive_only" className="bg-black">Destructive only (recommended)</option>
          <option value="every_step" className="bg-black">Every step</option>
        </select>
      </div>
      <button onClick={save} disabled={busy} className="w-full py-2 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-sm flex items-center justify-center gap-2 disabled:opacity-40">
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
        Save
      </button>
    </div>
  );
}
