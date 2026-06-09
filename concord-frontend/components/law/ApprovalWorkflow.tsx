'use client';

/**
 * ApprovalWorkflow — route a contract through named reviewers, record
 * approve/reject decisions, and gate signature on a cleared workflow.
 * Backlog item 3. Wires law.approval-route / -decide / -status.
 */

import { useCallback, useEffect, useState } from 'react';
import { Users, Plus, Check, X, Loader2, ShieldCheck, Ban } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Approval {
  id: string; reviewer: string; order: number;
  state: 'pending' | 'approved' | 'rejected'; note: string; decidedAt: string | null;
}
interface ApprovalStatus {
  approvals: Approval[]; pending: number; approved: number; rejected: number; cleared: boolean;
}

export function ApprovalWorkflow({ contractId, onChange }: { contractId: string; onChange?: () => void }) {
  const [status, setStatus] = useState<ApprovalStatus | null>(null);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await lensRun('law', 'approval-status', { id: contractId });
    if (r.data?.ok) setStatus(r.data.result as ApprovalStatus);
  }, [contractId]);

  useEffect(() => { void load(); setReviewers([]); }, [load]);

  function addReviewer() {
    const v = draft.trim();
    if (!v || reviewers.includes(v)) return;
    setReviewers([...reviewers, v]);
    setDraft('');
  }

  async function route() {
    if (reviewers.length === 0) return;
    setBusy(true);
    const r = await lensRun('law', 'approval-route', { id: contractId, reviewers });
    setBusy(false);
    if (r.data?.ok) { setReviewers([]); await load(); onChange?.(); }
  }

  async function decide(approvalId: string, decision: 'approved' | 'rejected') {
    setBusy(true);
    const note = decision === 'rejected' ? (prompt('Rejection note (optional)?') || '') : '';
    const r = await lensRun('law', 'approval-decide', { id: contractId, approvalId, decision, note });
    setBusy(false);
    if (r.data?.ok) { await load(); onChange?.(); }
  }

  const all = status?.approvals || [];

  return (
    <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Users className="w-4 h-4 text-indigo-300" />
        <h3 className="text-sm font-semibold text-white">Approval Workflow</h3>
        {status && all.length > 0 && (
          status.cleared
            ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-neon-green/20 text-neon-green inline-flex items-center gap-1"><ShieldCheck className="w-2.5 h-2.5" />Cleared for signature</span>
            : status.rejected > 0
              ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 inline-flex items-center gap-1"><Ban className="w-2.5 h-2.5" />Blocked</span>
              : <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">{status.pending} pending</span>
        )}
      </div>

      {all.length === 0 ? (
        <>
          <p className="text-[11px] text-gray-400">Route this contract through named reviewers before signature.</p>
          <div className="flex flex-wrap gap-1">
            {reviewers.map((r) => (
              <span key={r} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-400/15 text-indigo-300 inline-flex items-center gap-1">
                {r}
                <button onClick={() => setReviewers(reviewers.filter((x) => x !== r))}><X className="w-2.5 h-2.5" /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addReviewer(); }}
              placeholder="Reviewer name (e.g. Legal, Finance)…"
              className="flex-1 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
            <button onClick={addReviewer}
              className="px-2.5 py-1.5 text-xs rounded bg-white/10 text-gray-300 hover:bg-white/20 inline-flex items-center gap-1">
              <Plus className="w-3 h-3" />Add
            </button>
            <button onClick={route} disabled={busy || reviewers.length === 0}
              className="px-3 py-1.5 text-xs rounded bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 disabled:opacity-50 inline-flex items-center gap-1">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
              Start routing
            </button>
          </div>
        </>
      ) : (
        <ol className="space-y-1">
          {all.map((ap) => (
            <li key={ap.id} className="flex items-center gap-2 bg-black/40 rounded px-2 py-1.5">
              <span className="text-[10px] text-gray-400">#{ap.order}</span>
              <span className="text-xs text-white flex-1 truncate">{ap.reviewer}</span>
              {ap.note && <span className="text-[9px] text-gray-400 italic truncate max-w-[120px]">{ap.note}</span>}
              {ap.state === 'pending' ? (
                <div className="flex gap-1">
                  <button aria-label="Confirm" onClick={() => decide(ap.id, 'approved')} disabled={busy}
                    className="p-1 rounded bg-neon-green/15 text-neon-green hover:bg-neon-green/25 disabled:opacity-50">
                    <Check className="w-3 h-3" />
                  </button>
                  <button onClick={() => decide(ap.id, 'rejected')} disabled={busy}
                    className="p-1 rounded bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 disabled:opacity-50">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <span className={cn('text-[10px] px-1.5 py-0.5 rounded',
                  ap.state === 'approved' ? 'bg-neon-green/20 text-neon-green' : 'bg-rose-500/20 text-rose-300')}>
                  {ap.state}
                </span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
