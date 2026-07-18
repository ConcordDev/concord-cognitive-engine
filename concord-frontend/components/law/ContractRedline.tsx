'use client';

/**
 * ContractRedline — real-time multi-party collaborative contract
 * redlining. Closes the WAVE4 law-lens gap ("No real-time multi-party
 * collaborative redlining") by REUSING the generic scope-parameterized
 * Yjs CRDT layer (server/lib/yjs-realtime.js — the same layer the `code`
 * and `collab` lenses already use, whose own docstring invites reuse "by
 * any future realtime editor") under a new `law:contract` scope, and the
 * `collab` domain's already-real presence/comment primitives. No parallel
 * realtime transport is built here.
 *
 * Wiring, concretely:
 *   - Live co-editing draft: `useYjsDoc({ scope: 'law:contract', docId:
 *     contractId })` (the same hook CollabDocWorkspace uses) binds a
 *     shared `Y.Text('content')` seeded from the real contract body
 *     (`law.contract-redline-init` — server/domains/law.js, which reuses
 *     the exact `clauseTextBlock` helper `contract-version-save` uses).
 *   - Presence/cursors: `collab.cursorUpdate` against a linked "shadow"
 *     collab doc (`law.contract-redline-link` persists the doc id onto
 *     the contract so it survives re-opening the tab). Presence is never
 *     persisted beyond the collab domain's existing in-memory roster —
 *     restart honesty is the collab lens's own established invariant,
 *     reused unchanged here.
 *   - Redline suggestions + discussion: `collab.addComment` /
 *     `listComments` / `resolveThread` against the same shadow doc.
 *     Suggestions are tagged `elementId: 'redline'` with an optional
 *     text-selection anchor — a convention on top of the real comment
 *     schema, not a new comment type collab.js has to know about.
 *   - Tracked changes (accept/reject): a client-side review-decision
 *     overlay (concord-frontend/lib/law/tracked-changes.ts) on the
 *     REAL line-level LCS diff `law.contract-diff` already produces
 *     (server/domains/law.js#lineDiff). Nothing here recomputes or
 *     invents a diff — it only tracks a per-line accept/reject decision
 *     over the ops array the existing macro returns unchanged.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import {
  Users, MessageSquare, Check, X, Loader2, GitCompare, Sparkles, Send, MapPin,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useYjsDoc } from '@/lib/hooks/useYjsDoc';
import {
  buildTrackedChanges, decideChange, decideAll, summarizeReview,
  type TrackedChange, type ReviewDecision, type DiffOp,
} from '@/lib/law/tracked-changes';

interface RedlineInit { contractId: string; scope: string; body: string; collabDocId: string | null }
interface PresenceRow {
  userId: string; name: string; color: string; cursor: number;
  selection: { start: number; end: number } | null; following: string | null; updatedAt: number;
}
interface Comment {
  id: string; threadId: string; parentId: string | null;
  elementId: string | null; anchor: { start: number; end: number } | null;
  authorId: string; authorName: string; text: string;
  mentions: string[]; resolved: boolean; createdAt: number;
}
interface CommentThread {
  threadId: string; elementId: string | null;
  anchor: { start: number; end: number } | null;
  resolved: boolean; commentCount: number; comments: Comment[]; updatedAt: number;
}
interface VersionMeta { version: number; label: string; clauseCount: number; savedBy: string; savedAt: string; charCount: number }
interface DiffResult { from: string; to: string; ops: DiffOp[]; added: number; removed: number; unchanged: number }

export function ContractRedline({ contractId, contractTitle }: { contractId: string; contractTitle?: string }) {
  // ── Bootstrap: seed text + link/create the shadow collab doc ──────────────
  const [initReady, setInitReady] = useState(false);
  const [scope, setScope] = useState('law:contract');
  const [collabDocId, setCollabDocId] = useState<string | null>(null);

  const [text, setText] = useState('');
  const textRef = useRef('');
  const editingRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInitReady(false);
    setCollabDocId(null);
    setText('');
    textRef.current = '';
    (async () => {
      const r = await lensRun<RedlineInit>('law', 'contract-redline-init', { id: contractId });
      if (cancelled || !r.data?.ok || !r.data.result) return;
      const init = r.data.result;
      let docId = init.collabDocId;
      if (!docId) {
        const created = await lensRun<{ id: string }>('collab', 'docCreate', {
          title: `Redline — ${contractTitle || contractId}`,
        });
        if (cancelled) return;
        if (created.data?.ok && created.data.result) {
          docId = created.data.result.id;
          await lensRun('law', 'contract-redline-link', { id: contractId, collabDocId: docId });
        }
      }
      if (cancelled) return;
      setScope(init.scope);
      setCollabDocId(docId);
      setText(init.body);
      textRef.current = init.body;
      setInitReady(true);
    })();
    return () => { cancelled = true; };
  }, [contractId, contractTitle]);

  // ── Yjs CRDT: shared Y.Text('content') for the redline draft ──────────────
  const { doc: yDoc, synced: yDocSynced } = useYjsDoc({
    scope, docId: contractId, enabled: initReady && !!contractId,
  });
  const yTextRef = useRef<Y.Text | null>(null);
  const yApplyingRemoteRef = useRef(false);
  useEffect(() => {
    if (!yDoc) { yTextRef.current = null; return; }
    const yText = yDoc.getText('content');
    yTextRef.current = yText;
    const observer = () => {
      if (editingRef.current) return;
      const next = yText.toString();
      if (next === textRef.current) return;
      yApplyingRemoteRef.current = true;
      setText(next);
      textRef.current = next;
      yApplyingRemoteRef.current = false;
    };
    yText.observe(observer);
    if (yDocSynced) observer();
    return () => { try { yText.unobserve(observer); } catch { /* ignore */ } };
  }, [yDoc, yDocSynced]);

  const onTextChange = useCallback((next: string) => {
    editingRef.current = true;
    setText(next);
    textRef.current = next;
    if (!yApplyingRemoteRef.current && yTextRef.current) {
      try {
        const ytext = yTextRef.current;
        const current = ytext.toString();
        if (current !== next) {
          ytext.doc?.transact(() => {
            ytext.delete(0, current.length);
            ytext.insert(0, next);
          });
        }
      } catch { /* never block editing on a CRDT error */ }
    }
    setTimeout(() => { editingRef.current = false; }, 700);
  }, []);

  // ── Presence — reuses collab.cursorUpdate against the shadow doc ──────────
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const heartbeat = useCallback(async () => {
    if (!collabDocId || !taRef.current) return;
    const ta = taRef.current;
    const r = await lensRun<{ presence: PresenceRow[] }>('collab', 'cursorUpdate', {
      docId: collabDocId,
      cursor: ta.selectionStart,
      selection: { start: ta.selectionStart, end: ta.selectionEnd },
    });
    if (r.data?.ok && r.data.result) setPresence(r.data.result.presence);
  }, [collabDocId]);
  useEffect(() => {
    if (!collabDocId) return;
    void heartbeat();
    const t = setInterval(heartbeat, 2500);
    return () => clearInterval(t);
  }, [collabDocId, heartbeat]);

  // ── Redline discussion — reuses collab.addComment/listComments/resolveThread ─
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [commentText, setCommentText] = useState('');
  const [suggestMode, setSuggestMode] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadThreads = useCallback(async () => {
    if (!collabDocId) return;
    const r = await lensRun<{ threads: CommentThread[] }>('collab', 'listComments', {
      docId: collabDocId, includeResolved: true,
    });
    if (r.data?.ok) setThreads(r.data.result?.threads || []);
  }, [collabDocId]);
  useEffect(() => { void loadThreads(); }, [loadThreads]);

  async function postComment() {
    if (!collabDocId || !commentText.trim()) return;
    setBusy(true);
    const ta = taRef.current;
    const anchor = suggestMode && ta && ta.selectionStart !== ta.selectionEnd
      ? { start: ta.selectionStart, end: ta.selectionEnd } : null;
    await lensRun('collab', 'addComment', {
      docId: collabDocId, text: commentText.trim(),
      ...(suggestMode ? { elementId: 'redline' } : {}),
      ...(anchor ? { anchor } : {}),
    });
    setBusy(false);
    setCommentText('');
    await loadThreads();
  }
  async function toggleResolve(threadId: string, resolved: boolean) {
    if (!collabDocId) return;
    await lensRun('collab', 'resolveThread', { docId: collabDocId, threadId, reopen: resolved });
    await loadThreads();
  }

  // ── Tracked changes (accept/reject) over the REAL contract-diff ───────────
  const [versions, setVersions] = useState<VersionMeta[]>([]);
  const [fromVersion, setFromVersion] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [changes, setChanges] = useState<TrackedChange[]>([]);
  const [diffBusy, setDiffBusy] = useState(false);

  const loadVersions = useCallback(async () => {
    const r = await lensRun<{ versions: VersionMeta[] }>('law', 'contract-version-list', { id: contractId });
    if (r.data?.ok) {
      const vs = r.data.result?.versions || [];
      setVersions(vs);
      setFromVersion((prev) => prev ?? (vs.length ? vs[vs.length - 1].version : null));
    }
  }, [contractId]);
  useEffect(() => { void loadVersions(); setDiff(null); setChanges([]); }, [loadVersions]);

  async function runDiff() {
    if (fromVersion == null) return;
    setDiffBusy(true);
    const r = await lensRun<DiffResult>('law', 'contract-diff', { id: contractId, fromVersion });
    setDiffBusy(false);
    if (r.data?.ok && r.data.result) {
      setDiff(r.data.result);
      setChanges(buildTrackedChanges(r.data.result.ops));
    }
  }
  function decide(index: number, decision: ReviewDecision) {
    setChanges((prev) => decideChange(prev, index, decision));
  }
  function decideAllChanges(decision: ReviewDecision) {
    setChanges((prev) => decideAll(prev, decision));
  }
  const summary = summarizeReview(changes);

  if (!initReady) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Live co-editing draft + presence roster */}
      <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-neon-cyan" />
            <h3 className="text-sm font-semibold text-white">Live redline draft</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-gray-400 font-mono">
              {yDocSynced ? 'CRDT synced' : 'connecting…'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <Users className="w-3.5 h-3.5 text-gray-400" />
            {presence.length === 0 ? (
              <span className="text-[10px] text-gray-400">just you</span>
            ) : presence.map((p) => (
              <span key={p.userId}
                className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                style={{ color: p.color, backgroundColor: `${p.color}1a` }}>
                {p.name}
              </span>
            ))}
          </div>
        </div>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onSelect={heartbeat}
          rows={10}
          placeholder="Redline draft syncs live to everyone editing this contract…"
          className="w-full bg-black/50 border border-white/15 rounded-lg p-2.5 text-xs text-gray-200 font-mono leading-relaxed resize-y focus:outline-none focus:border-neon-cyan/50"
        />
        <p className="text-[10px] text-gray-500">
          A shared co-editing draft — not the authoritative clause list. Reconcile agreed
          language into the Clauses tab, then use Versions → Diff to produce a formal redline.
        </p>
      </div>

      {/* Redline suggestions / discussion threads */}
      <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-amber-300" />
          <h3 className="text-sm font-semibold text-white">Redline discussion</h3>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          <button onClick={() => setSuggestMode(true)}
            className={cn('px-2 py-0.5 rounded', suggestMode ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5')}>
            Suggest redline
          </button>
          <button onClick={() => setSuggestMode(false)}
            className={cn('px-2 py-0.5 rounded', !suggestMode ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5')}>
            General comment
          </button>
          {suggestMode && <span>select text in the draft above to pin a range (optional)</span>}
        </div>
        <div className="flex items-center gap-2">
          <input value={commentText} onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && postComment()}
            placeholder={suggestMode ? 'Propose a change…' : 'Add a comment…'}
            className="flex-1 bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
          <button onClick={postComment} disabled={busy || !commentText.trim()}
            className="px-2.5 py-1.5 rounded bg-neon-cyan/20 text-neon-cyan text-xs font-semibold disabled:opacity-40 inline-flex items-center gap-1">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
          </button>
        </div>
        {threads.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic py-2 text-center">No redline discussion yet.</p>
        ) : (
          <div className="space-y-1.5">
            {threads.map((th) => (
              <div key={th.threadId}
                className={cn('rounded border p-2', th.resolved ? 'border-neon-green/20 bg-neon-green/5' : 'border-white/10 bg-black/40')}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                    {th.elementId === 'redline' && (
                      <span className="flex items-center gap-0.5 text-amber-300">
                        <GitCompare className="w-3 h-3" /> suggested redline
                      </span>
                    )}
                    {th.anchor && (
                      <span className="flex items-center gap-0.5 text-cyan-400">
                        <MapPin className="w-3 h-3" /> chars {th.anchor.start}–{th.anchor.end}
                      </span>
                    )}
                  </div>
                  <button onClick={() => toggleResolve(th.threadId, th.resolved)}
                    className={cn('text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1',
                      th.resolved ? 'bg-white/10 text-gray-400' : 'bg-neon-green/20 text-neon-green')}>
                    <Check className="w-2.5 h-2.5" /> {th.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                </div>
                {th.comments.map((c) => (
                  <p key={c.id} className="text-[11px] text-gray-300">
                    <span className="font-semibold text-white">{c.authorName}</span>{': '}{c.text}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tracked changes — accept/reject over the real contract-diff */}
      <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
        <div className="flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-neon-cyan" />
          <h3 className="text-sm font-semibold text-white">Tracked changes</h3>
          <span className="text-[9px] text-gray-400">accept/reject review over contract-diff</span>
        </div>
        {versions.length === 0 ? (
          <p className="text-[11px] text-gray-400 italic">
            No saved versions yet — save one on the Versions tab to enable a tracked-changes review.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400">Compare saved version</span>
              <select value={fromVersion ?? ''} onChange={(e) => setFromVersion(Number(e.target.value))}
                className="bg-black/50 border border-white/15 rounded px-1.5 py-1 text-[11px] text-white">
                {versions.map((v) => <option key={v.version} value={v.version}>v{v.version} — {v.label}</option>)}
              </select>
              <span className="text-[10px] text-gray-400">→ current</span>
              <button onClick={runDiff} disabled={diffBusy || fromVersion == null}
                className="px-2.5 py-1 text-[11px] rounded bg-neon-cyan/20 text-neon-cyan disabled:opacity-40 inline-flex items-center gap-1">
                {diffBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitCompare className="w-3 h-3" />}
                Diff
              </button>
            </div>

            {diff && (
              <div className="border border-white/10 rounded-lg overflow-hidden">
                <div className="flex items-center gap-3 bg-black/50 px-2 py-1 text-[10px]">
                  <span className="text-gray-400">{diff.from} → {diff.to}</span>
                  <span className="text-neon-green">+{diff.added}</span>
                  <span className="text-rose-400">−{diff.removed}</span>
                  {changes.length > 0 && (
                    <span className="ml-auto flex items-center gap-2">
                      <span data-testid="redline-review-summary" className="text-gray-400">
                        {summary.accepted} accepted · {summary.rejected} rejected · {summary.pending} pending
                      </span>
                      <button onClick={() => decideAllChanges('accepted')} className="text-neon-green hover:underline">Accept all</button>
                      <button onClick={() => decideAllChanges('rejected')} className="text-rose-400 hover:underline">Reject all</button>
                    </span>
                  )}
                </div>
                <div className="max-h-64 overflow-auto text-[10px] font-mono leading-relaxed p-2 bg-black/30">
                  {diff.ops.map((o, i) => {
                    const change = changes.find((c) => c.index === i);
                    return (
                      <div key={i} className={cn('flex items-center gap-2 px-1 rounded',
                        o.op === 'add' && (change?.decision === 'rejected' ? 'bg-rose-500/5 text-gray-500 line-through' : 'bg-neon-green/10 text-neon-green'),
                        o.op === 'remove' && (change?.decision === 'rejected' ? 'bg-neon-green/5 text-gray-500 line-through' : 'bg-rose-500/10 text-rose-300 line-through'),
                        o.op === 'same' && 'text-gray-400')}>
                        <span className="select-none opacity-50 w-3 shrink-0">
                          {o.op === 'add' ? '+' : o.op === 'remove' ? '−' : ' '}
                        </span>
                        <span className="flex-1">{o.text || ' '}</span>
                        {change && (
                          <span className="flex items-center gap-1 shrink-0">
                            <button aria-label={`Accept change ${i}`} onClick={() => decide(i, 'accepted')}
                              className={cn('p-0.5 rounded', change.decision === 'accepted' ? 'bg-neon-green/30 text-neon-green' : 'text-gray-500 hover:text-neon-green')}>
                              <Check className="w-3 h-3" />
                            </button>
                            <button aria-label={`Reject change ${i}`} onClick={() => decide(i, 'rejected')}
                              className={cn('p-0.5 rounded', change.decision === 'rejected' ? 'bg-rose-500/30 text-rose-300' : 'text-gray-500 hover:text-rose-300')}>
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
