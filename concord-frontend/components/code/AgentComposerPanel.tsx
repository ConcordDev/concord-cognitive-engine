'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Loader2, Send, FileDiff, ShieldCheck, XCircle, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import MultiFileAgentReview, { type MultiFileEdit } from './MultiFileAgentReview';

interface ChangeReceipt { path: string; before: string | null; after: string | null }

interface AgentTask {
  id: string; number: string;
  projectId: string; prompt: string;
  status: 'running' | 'completed' | 'cancelled' | 'failed';
  startedAt: string; finishedAt: string | null;
  plan: Array<{ action: string; summary: string }>;
  filesChanged: string[];
  source?: string;
  error?: string;
  changeReceipts?: ChangeReceipt[];
}

/**
 * Agent (Composer) — S5 honesty rebuild (PR #1707, F4).
 *
 * The old panel's "done" button flipped a RUNNING task to COMPLETED
 * with zero file changes — a false completion claim in the product's
 * own chrome. That button is gone. A task now terminates honestly:
 *
 * - "Propose edits" runs the real multi-file planner against the
 *   project's files and opens the per-file diff review; applying
 *   accepted edits writes them, and only then is completion requested.
 * - Completion itself is GATED ON THE SERVER: agent-task-finish
 *   re-fingerprints the project and refuses when nothing changed
 *   since the task started. The changed-file list and the receipts
 *   shown on a completed task are derived server-side from content
 *   hashes — this panel cannot invent them, and neither can any other
 *   caller.
 * - "Verify & complete" exists for work done by hand: same gate.
 * - Failed and cancelled are explicit, with the reason shown.
 * - A running task's plan is labelled what it is — a proposal, not
 *   progress — until edits actually land.
 */
export function AgentComposerPanel({ projectId }: { projectId: string | null }) {
  const [list, setList] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [taskMsg, setTaskMsg] = useState<Record<string, string>>({});
  const [review, setReview] = useState<{ task: AgentTask; edits: MultiFileEdit[]; loading: boolean } | null>(null);
  const [applying, setApplying] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is a stable closure; only projectId should retrigger
  useEffect(() => { refresh(); }, [projectId]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'code', action: 'agent-tasks-list', input: {} });
      const all = (r.data?.result?.tasks || []) as AgentTask[];
      setList(projectId ? all.filter(t => t.projectId === projectId) : all);
    } catch (e) { console.error('[Agent] list', e); }
    finally { setLoading(false); }
  }

  async function start() {
    if (!projectId || !prompt.trim()) return;
    setBusy(true);
    try {
      const r = await lensRun({ domain: 'code', action: 'agent-task-start', input: { projectId, prompt: prompt.trim() } });
      if (r.data?.ok === false) { alert(r.data?.error); return; }
      setPrompt('');
      await refresh();
    } catch (e) { console.error('[Agent] start', e); }
    finally { setBusy(false); }
  }

  function say(taskId: string, msg: string) {
    setTaskMsg(prev => ({ ...prev, [taskId]: msg }));
  }

  /** Ask the server to finish a task. Returns true when it accepted. */
  async function finish(task: AgentTask, status: 'completed' | 'cancelled' | 'failed', reason?: string): Promise<boolean> {
    try {
      const r = await lensRun({ domain: 'code', action: 'agent-task-finish', input: { id: task.id, status, ...(reason ? { reason } : {}) } });
      if (r.data?.ok === false) {
        if (status === 'completed') {
          say(task.id, 'Not completed: no files have changed since this task started. Propose edits and apply them, edit files yourself, or end the task as failed/cancelled — a task that changed nothing cannot be marked completed.');
        } else {
          say(task.id, `Could not mark ${status}: ${r.data?.error || 'the server refused'}`);
        }
        await refresh();
        return false;
      }
      await refresh();
      return true;
    } catch (e) {
      console.error('[Agent] finish', e);
      say(task.id, 'The finish request failed.');
      return false;
    }
  }

  async function proposeEdits(task: AgentTask) {
    if (!projectId) return;
    setReview({ task, edits: [], loading: true });
    try {
      const treeRes = await lensRun({ domain: 'code', action: 'files-tree', input: { projectId } });
      const tree = (treeRes.data?.result?.tree || []) as Array<{ path: string; language: string }>;
      const files: Array<{ name: string; language: string; content: string }> = [];
      for (const node of tree.slice(0, 12)) {
        const read = await lensRun({ domain: 'code', action: 'files-read', input: { projectId, path: node.path } });
        const content = read.data?.result?.content;
        if (typeof content === 'string') files.push({ name: node.path, language: node.language || 'plaintext', content });
      }
      if (files.length === 0) {
        setReview(null);
        say(task.id, 'This project has no files to plan against yet.');
        return;
      }
      const planRes = await lensRun({ domain: 'code', action: 'multi-file-plan', input: { prompt: task.prompt, files, maxEdits: 6 } });
      if (planRes.data?.ok === false) {
        setReview(null);
        say(task.id, `The planner could not propose edits: ${planRes.data?.error || 'unavailable'}`);
        return;
      }
      const edits = (planRes.data?.result?.edits || []) as MultiFileEdit[];
      if (edits.length === 0) {
        setReview(null);
        say(task.id, 'The planner proposed no changes for this task. Nothing was applied.');
        return;
      }
      setReview({ task, edits, loading: false });
    } catch (e) {
      console.error('[Agent] propose', e);
      setReview(null);
      say(task.id, 'Proposing edits failed — the request did not complete.');
    }
  }

  async function applyEdits(accepted: MultiFileEdit[]) {
    if (!review || !projectId) return;
    const task = review.task;
    setApplying(true);
    const failedWrites: string[] = [];
    try {
      for (const edit of accepted) {
        const r = await lensRun({ domain: 'code', action: 'files-write', input: { projectId, path: edit.filename, content: edit.after } });
        if (r.data?.ok === false) failedWrites.push(edit.filename);
      }
    } finally {
      setApplying(false);
    }
    setReview(null);
    if (failedWrites.length > 0) {
      say(task.id, `Some edits could not be written: ${failedWrites.join(', ')}. The task stays running.`);
      await refresh();
      return;
    }
    // The writes landed — now ask for completion. The server verifies
    // the diff against the task's start fingerprints before certifying.
    await finish(task, 'completed');
  }

  if (!projectId) return <div className="p-3 text-xs text-gray-400 italic">Open a project to use the agent.</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-2 py-1.5 border-b border-white/10 flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-blue-400" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Agent (Composer)</span>
        <span className="text-[10px] text-gray-400">{list.length}</span>
      </div>
      <div className="p-2 border-b border-white/10 space-y-1.5">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="Describe a multi-file task — Refactor auth to JWT and add tests…"
          rows={3}
          className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        />
        <button onClick={start} disabled={busy || !prompt.trim()} className="w-full px-2 py-1.5 text-xs rounded bg-blue-500 text-white font-bold hover:bg-blue-400 disabled:opacity-40 inline-flex items-center justify-center gap-1">
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}Compose
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-3 text-xs text-gray-400"><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Loading…</div>
        ) : list.length === 0 ? (
          <div className="p-3 text-xs text-gray-400 italic">No tasks yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {list.map(t => (
              <li key={t.id} className="p-2">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={cn('text-[9px] uppercase px-1 py-0.5 rounded font-mono',
                    t.status === 'running'   ? 'bg-blue-500/20 text-blue-300' :
                    t.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' :
                    t.status === 'cancelled' ? 'bg-gray-500/20 text-gray-300' :
                                                'bg-rose-500/20 text-rose-300',
                  )}>{t.status}</span>
                  <span className="font-mono text-[10px] text-gray-400">{t.number}</span>
                  {t.source === 'brain' && <span className="text-[9px] text-blue-300">· brain</span>}
                </div>
                <div className="text-xs text-white">{t.prompt}</div>
                {t.status === 'running' && (
                  <div className="mt-1 text-[10px] text-gray-400">
                    Running since {new Date(t.startedAt).toLocaleTimeString()} — the plan below is a proposal; nothing is applied to your files until you review and accept edits.
                  </div>
                )}
                {t.plan.length > 0 && (
                  <ol className="mt-1 ml-3 text-[11px] text-gray-300 space-y-0.5 list-decimal">
                    {t.plan.map((p, i) => <li key={i}><span className="text-[9px] uppercase text-blue-300 mr-1">{p.action}</span>{p.summary}</li>)}
                  </ol>
                )}
                {t.status === 'running' && (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <button onClick={() => proposeEdits(t)} className="px-1.5 py-0.5 text-[9px] rounded bg-blue-500/20 text-blue-200 hover:bg-blue-500/30 inline-flex items-center gap-0.5"><FileDiff className="w-3 h-3" />Propose edits</button>
                    <button onClick={() => void finish(t, 'completed')} className="px-1.5 py-0.5 text-[9px] rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 inline-flex items-center gap-0.5"><ShieldCheck className="w-3 h-3" />Verify &amp; complete</button>
                    <button onClick={() => void finish(t, 'failed', 'Marked failed by the user — no completed work claimed.')} className="px-1.5 py-0.5 text-[9px] rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 inline-flex items-center gap-0.5"><XCircle className="w-3 h-3" />Mark failed</button>
                    <button onClick={() => void finish(t, 'cancelled')} className="px-1.5 py-0.5 text-[9px] rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 inline-flex items-center gap-0.5"><X className="w-3 h-3" />cancel</button>
                  </div>
                )}
                {taskMsg[t.id] && (
                  <div role="alert" className="mt-1.5 px-2 py-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200">{taskMsg[t.id]}</div>
                )}
                {t.status === 'completed' && t.changeReceipts && t.changeReceipts.length > 0 ? (
                  <div className="mt-1 text-[10px] text-gray-400">
                    <div>Files changed (verified against the task-start record): {t.changeReceipts.map(c => c.path).join(', ')}</div>
                    <div className="font-mono text-[9px] text-gray-500">
                      {t.changeReceipts.map(c => `${c.path}: ${c.before ?? 'new'} → ${c.after ?? 'deleted'}`).join(' · ')}
                    </div>
                  </div>
                ) : t.filesChanged?.length > 0 ? (
                  <div className="mt-1 text-[10px] text-gray-400">Files changed: {t.filesChanged.join(', ')}</div>
                ) : null}
                {t.status === 'failed' && t.error && (
                  <div className="mt-1 text-[11px] text-rose-300">{t.error}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {review && (
        <MultiFileAgentReview
          open
          onClose={() => setReview(null)}
          prompt={review.task.prompt}
          edits={review.edits}
          loading={review.loading || applying}
          onApply={applyEdits}
          onRegenerate={() => void proposeEdits(review.task)}
        />
      )}
    </div>
  );
}

export default AgentComposerPanel;
