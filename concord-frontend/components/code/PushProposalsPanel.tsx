'use client';

/**
 * PushProposalsPanel — the AI patch → human review → GitHub push loop.
 * "Draft" asks the code domain for a VERIFIED patch against a real repo
 * (push-proposal-create runs propose-verified-patch; an edit set that fails
 * its own checks is refused, never turned into a proposal). Nothing reaches
 * GitHub until the user presses Push on a pending proposal
 * (push-proposal-approve), and it only ever pushes to a new branch, never
 * the base. Reject discards without calling GitHub.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, GitPullRequestDraft, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { cn } from '@/lib/utils';

interface Proposal {
  id: string;
  repo: string;
  baseRef: string;
  branchName: string;
  status: 'pending' | 'pushed' | 'rejected' | 'conflict' | 'push_failed' | string;
  fileCount: number;
  edits: Array<{ filename: string; reason: string | null }>;
  createdAt: string;
  rejectReason: string | null;
  pushResult: {
    ok: boolean;
    branch: string;
    committed: Array<{ filename: string; commitSha: string | null; htmlUrl: string | null }>;
    conflicts: Array<{ filename: string }>;
    failed: Array<{ filename: string; error: string }>;
  } | null;
}

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-300',
  pushed: 'bg-emerald-500/15 text-emerald-300',
  rejected: 'bg-zinc-700/50 text-zinc-400',
  conflict: 'bg-rose-500/15 text-rose-300',
  push_failed: 'bg-rose-500/15 text-rose-300',
};

const field = 'w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-gray-100 focus:border-cyan-500/50 focus:outline-none';

export function PushProposalsPanel() {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [form, setForm] = useState({ repo: '', ref: 'main', branchName: '', taskQuery: '' });
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ proposals: Proposal[] }>('code', 'push-proposal-list', {});
    if (!r.data.ok) setListError(r.data.error === 'no_user' ? 'Sign in to draft and push patches.' : r.data.error || 'Could not load proposals.');
    else { setListError(null); setProposals([...(r.data.result?.proposals || [])].reverse()); }
    setLoading(false);
  }, []);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      await load();
      const r = await lensRun<{ repos?: Array<{ fullName: string }> }>('github', 'repos', {});
      const names = (r.data.result?.repos || []).map((x) => x.fullName);
      setRepos(names);
      setForm((f) => (f.repo || !names[0] ? f : { ...f, repo: names[0] }));
    });
  }, [load]);

  const draft = async () => {
    if (!form.repo || !form.taskQuery.trim() || !form.branchName.trim()) {
      setDraftError('Pick a repo, describe the change and name a new branch.');
      return;
    }
    setDrafting(true); setDraftError(null);
    try {
      const r = await lensRun('code', 'push-proposal-create', {
        repo: form.repo, ref: form.ref.trim() || 'main', branchName: form.branchName.trim(), taskQuery: form.taskQuery.trim(),
      });
      if (!r.data.ok) { setDraftError(r.data.error || 'The patch did not pass verification.'); return; }
      setForm((f) => ({ ...f, taskQuery: '', branchName: '' }));
      useUIStore.getState().addToast({ type: 'success', message: 'Verified patch drafted. Review it, then push or reject.' });
      await load();
    } finally { setDrafting(false); }
  };

  const act = async (id: string, kind: 'approve' | 'reject') => {
    setActing(id);
    try {
      const r = await lensRun<{ proposal: Proposal }>('code', kind === 'approve' ? 'push-proposal-approve' : 'push-proposal-reject', { id });
      const status = r.data.result?.proposal?.status;
      if (kind === 'approve') {
        useUIStore.getState().addToast(status === 'pushed'
          ? { type: 'success', message: `Pushed to ${r.data.result?.proposal?.branchName}.` }
          : { type: 'error', message: `Push did not complete: ${(status || r.data.error || 'failed').replace(/_/g, ' ')}.` });
      }
      await load();
    } finally { setActing(null); }
  };

  return (
    <section className="border-t border-white/10 p-2 text-xs">
      <header className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 font-semibold text-gray-200"><GitPullRequestDraft className="h-3.5 w-3.5 text-cyan-300" /> AI patch proposals</span>
        <button type="button" aria-label="Refresh proposals" onClick={() => void load()} className="rounded p-1 text-gray-400 transition-colors hover:bg-white/10">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </header>

      <div className="space-y-1.5 rounded border border-white/10 bg-white/[0.02] p-2">
        {repos.length > 0 ? (
          <select aria-label="Repository" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} className={field}>
            {repos.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        ) : (
          <input aria-label="Repository" placeholder="owner/repo" value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} className={field} />
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <input aria-label="Base branch" placeholder="Base branch" value={form.ref} onChange={(e) => setForm({ ...form, ref: e.target.value })} className={field} />
          <input aria-label="New branch" placeholder="New branch" value={form.branchName} onChange={(e) => setForm({ ...form, branchName: e.target.value })} className={field} />
        </div>
        <textarea aria-label="Describe the change" rows={3} placeholder="Describe the change, e.g. add input validation to the signup handler" value={form.taskQuery} onChange={(e) => setForm({ ...form, taskQuery: e.target.value })} className={cn(field, 'resize-y')} />
        <button type="button" onClick={() => void draft()} disabled={drafting} className="flex w-full items-center justify-center gap-1.5 rounded bg-cyan-500 px-2 py-1.5 text-[11px] font-bold text-black transition-colors hover:bg-cyan-400 disabled:opacity-50">
          {drafting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {drafting ? 'Writing and verifying…' : 'Draft verified patch'}
        </button>
        {draftError && <p role="alert" className="text-[11px] text-rose-400">{draftError.replace(/_/g, ' ')}</p>}
      </div>

      {listError && <p role="alert" className="mt-2 text-[11px] text-rose-400">{listError}</p>}
      {!loading && !listError && proposals.length === 0 && (
        <p className="mt-2 text-[11px] text-gray-500">No proposals yet. Nothing is pushed until you approve one here.</p>
      )}

      <ul className="mt-2 space-y-1.5">
        {proposals.map((p) => (
          <li key={p.id} className="rounded border border-white/10 bg-black/20 p-2 transition-colors hover:border-white/20">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[11px] text-gray-200" title={`${p.repo}: ${p.baseRef} → ${p.branchName}`}>{p.repo.split('/')[1] || p.repo} · {p.branchName}</span>
              <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase', STATUS_TONE[p.status] || STATUS_TONE.rejected)}>{p.status.replace(/_/g, ' ')}</span>
            </div>
            <ul className="mt-1 space-y-0.5">
              {p.edits.map((e) => (
                <li key={e.filename} className="truncate text-[10px] text-gray-400" title={e.reason || undefined}>
                  <span className="font-mono text-gray-300">{e.filename}</span>{e.reason ? ` · ${e.reason}` : ''}
                </li>
              ))}
            </ul>
            {p.pushResult && (
              <div className="mt-1 space-y-0.5 text-[10px]">
                {p.pushResult.committed.map((c) => c.htmlUrl && (
                  <a key={c.filename} href={c.htmlUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-emerald-300 hover:underline">
                    <ExternalLink className="h-3 w-3" /> {c.filename}
                  </a>
                ))}
                {p.pushResult.conflicts.map((c) => <p key={c.filename} className="text-rose-300">Conflict: {c.filename} changed upstream</p>)}
                {p.pushResult.failed.map((f) => <p key={f.filename} className="text-rose-300">{f.filename}: {f.error.replace(/_/g, ' ')}</p>)}
              </div>
            )}
            {p.status === 'pending' && (
              <div className="mt-1.5 flex gap-1.5">
                <button type="button" onClick={() => void act(p.id, 'approve')} disabled={acting === p.id} className="flex flex-1 items-center justify-center gap-1 rounded bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/30 disabled:opacity-50">
                  {acting === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Push to branch
                </button>
                <button type="button" onClick={() => void act(p.id, 'reject')} disabled={acting === p.id} className="flex items-center justify-center gap-1 rounded border border-white/10 px-2 py-1 text-[11px] text-gray-300 transition-colors hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-50">
                  <X className="h-3 w-3" /> Reject
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
