'use client';

import { useCallback, useState } from 'react';
import { callBrowserAgentMacro, type BrowserApproval } from '@/lib/api/browser-agent';
import { ShieldAlert, Check, X, Loader2 } from 'lucide-react';

interface Props { approvals: BrowserApproval[]; onDecided: () => void; }

const REASON_LABEL: Record<string, string> = {
  destructive_action: 'Destructive action',
  external_purchase: 'External purchase',
  captcha_detected: 'CAPTCHA detected',
  authentication_needed: 'Authentication needed',
  budget_overrun: 'Budget overrun',
};

export function BrowserApprovalsPanel({ approvals, onDecided }: Props) {
  const [busy, setBusy] = useState<number | null>(null);

  const decide = useCallback(async (approvalId: number, decision: 'approved' | 'rejected') => {
    setBusy(approvalId);
    try {
      await callBrowserAgentMacro('approval_decide', { approvalId, decision });
      onDecided();
    } finally { setBusy(null); }
  }, [onDecided]);

  return (
    <div className="p-3 space-y-2">
      <h3 className="text-xs uppercase tracking-wide text-white/40 flex items-center gap-1">
        <ShieldAlert className="w-3 h-3" /> Pending approvals
      </h3>
      {approvals.length === 0 ? (
        <div className="text-xs text-white/30 italic">None — agents are running clean.</div>
      ) : (
        approvals.map((a) => {
          let action: { kind?: string; url?: string; element_text?: string; value?: string } = {};
          try { action = JSON.parse(a.proposed_action_json); } catch { /* ok */ }
          return (
            <div key={a.id} className="border border-amber-400/30 bg-amber-500/5 rounded p-2 space-y-2">
              <div className="text-xs font-semibold text-amber-300">{REASON_LABEL[a.reason] || a.reason}</div>
              <div className="text-xs text-white/80">
                {a.task_title && <div className="text-white/60">In task: <span className="text-white">{a.task_title}</span></div>}
                <div className="font-mono mt-1">{action.kind || 'action'}{action.url ? ` → ${action.url}` : ''}</div>
                {action.element_text && <div className="text-white/60 mt-0.5">"{action.element_text}"</div>}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => decide(a.id, 'approved')}
                  disabled={busy === a.id}
                  className="flex-1 py-1 rounded bg-green-500/20 hover:bg-green-500/30 text-green-300 text-xs font-medium disabled:opacity-40 flex items-center justify-center gap-1"
                >
                  {busy === a.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Approve
                </button>
                <button
                  onClick={() => decide(a.id, 'rejected')}
                  disabled={busy === a.id}
                  className="flex-1 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-medium disabled:opacity-40 flex items-center justify-center gap-1"
                >
                  <X className="w-3 h-3" /> Reject
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
