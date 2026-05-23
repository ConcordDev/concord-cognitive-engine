'use client';

/**
 * CollabDocWorkspace — real-time multiplayer document workspace.
 *
 * Wires the full collab co-editing backbone end-to-end against the
 * `collab` domain macros:
 *   docCreate / docList / docState / docOp / docSync   — conflict-free co-editing
 *   docSnapshot / docHistory / docRestore             — version history
 *   cursorUpdate / presenceState / setFollow          — live cursors + follow-mode
 *   setPermission / getPermissions                    — view/comment/edit tiers
 *   addComment / listComments / resolveThread         — @-mention threaded pins
 *   notifications / markNotificationRead              — mention notifications
 *
 * Sync is poll-based (1s) over `docSync` which returns CRDT ops newer than the
 * caller's lamport clock plus the live presence roster — concurrent edits
 * converge because the backend replays the op log in a deterministic
 * (lamport, authorId) total order.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { lensRun } from '@/lib/api/client';
import { TimelineView, type TimelineEvent } from '@/components/viz';
import {
  FileText, Plus, History, Users, MessageSquare, Bell, Shield,
  Eye, RotateCcw, Check, Loader2, Send, AtSign, Crown, X, MapPin,
} from 'lucide-react';

// ── Macro response shapes ──────────────────────────────────────────────────
interface DocSummary {
  id: string; title: string; ownerId: string; isOwner: boolean;
  tier: Tier; opCount: number; snapshotCount: number;
  updatedAt: number; createdAt: number;
}
interface DocOp {
  id: string; type: 'insert' | 'delete'; authorId: string;
  pos: number; lamport: number; ts: number; text?: string; len?: number;
}
interface PresenceRow {
  userId: string; name: string; color: string; cursor: number;
  selection: { start: number; end: number } | null;
  following: string | null; updatedAt: number;
}
interface DocStateResult {
  id: string; title: string; ownerId: string; text: string;
  lamport: number; opCount: number; tier: Tier;
  canEdit: boolean; canComment: boolean; updatedAt: number;
}
interface SyncResult {
  ops: DocOp[]; lamport: number; text: string; presence: PresenceRow[];
}
interface Snapshot {
  id: string; label: string; lamport: number; opCount: number;
  authorId: string; authorName: string; createdAt: number;
  preview: string; chars: number;
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
interface PermEntry { userId: string; tier: Tier }
interface PermResult { ownerId: string; defaultTier: Tier; entries: PermEntry[]; myTier: Tier }
interface Notification {
  id: string; kind: string; docId: string; commentId: string;
  fromId: string; fromName: string; text: string; read: boolean; createdAt: number;
}
type Tier = 'view' | 'comment' | 'edit';
type Tab = 'edit' | 'history' | 'comments' | 'permissions';

async function call<T>(action: string, input: Record<string, unknown>): Promise<T | null> {
  const r = await lensRun<T>('collab', action, input);
  if (r.data.ok === false || !r.data.result) return null;
  return r.data.result;
}

function timeAgo(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return `${Math.floor(d / 86_400_000)}d ago`;
}

const TIER_RANK: Record<Tier, number> = { view: 1, comment: 2, edit: 3 };

// Diff old → new text into a single insert or delete op (covers the common
// single-edit case; bulk pastes resolve as one insert).
function diffToOp(prev: string, next: string): { type: 'insert' | 'delete'; pos: number; text?: string; len?: number } | null {
  if (prev === next) return null;
  let start = 0;
  const minLen = Math.min(prev.length, next.length);
  while (start < minLen && prev[start] === next[start]) start++;
  let endP = prev.length, endN = next.length;
  while (endP > start && endN > start && prev[endP - 1] === next[endN - 1]) { endP--; endN--; }
  const removed = prev.slice(start, endP);
  const added = next.slice(start, endN);
  if (added && !removed) return { type: 'insert', pos: start, text: added };
  if (removed && !added) return { type: 'delete', pos: start, len: removed.length };
  // Replace: delete then insert — caller applies sequentially.
  return null;
}

export function CollabDocWorkspace() {
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);
  const [docState, setDocState] = useState<DocStateResult | null>(null);
  const [tab, setTab] = useState<Tab>('edit');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  // ── Editor / CRDT sync state ─────────────────────────────────────────────
  const [text, setText] = useState('');
  const lamportRef = useRef(0);
  const textRef = useRef('');
  const editingRef = useRef(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const [presence, setPresence] = useState<PresenceRow[]>([]);
  const [following, setFollowing] = useState<string | null>(null);

  // ── Version history ──────────────────────────────────────────────────────
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapLabel, setSnapLabel] = useState('');

  // ── Comments ─────────────────────────────────────────────────────────────
  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [pinElement, setPinElement] = useState('');

  // ── Permissions ──────────────────────────────────────────────────────────
  const [perms, setPerms] = useState<PermResult | null>(null);
  const [permUser, setPermUser] = useState('');
  const [permTier, setPermTier] = useState<Tier>('comment');

  // ── Notifications ────────────────────────────────────────────────────────
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const flash = (kind: 'ok' | 'err', t: string) => {
    setMsg({ kind, text: t });
    setTimeout(() => setMsg(null), 4000);
  };

  // ── Load document list ───────────────────────────────────────────────────
  const loadDocs = useCallback(async () => {
    const r = await call<{ documents: DocSummary[] }>('docList', {});
    setDocs(r?.documents ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // ── Load notifications (poll) ────────────────────────────────────────────
  const loadNotifs = useCallback(async () => {
    const r = await call<{ notifications: Notification[]; unread: number }>('notifications', { limit: 30 });
    if (r) { setNotifs(r.notifications); setUnread(r.unread); }
  }, []);
  useEffect(() => {
    loadNotifs();
    const t = setInterval(loadNotifs, 8000);
    return () => clearInterval(t);
  }, [loadNotifs]);

  // ── Open a document ──────────────────────────────────────────────────────
  const openDoc = useCallback(async (docId: string) => {
    setActiveDocId(docId);
    setTab('edit');
    const st = await call<DocStateResult>('docState', { docId });
    if (st) {
      setDocState(st);
      setText(st.text);
      textRef.current = st.text;
      lamportRef.current = st.lamport;
    }
  }, []);

  // ── Poll-based CRDT sync (1s) + presence ─────────────────────────────────
  useEffect(() => {
    if (!activeDocId) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const r = await call<SyncResult>('docSync', { docId: activeDocId, sinceLamport: lamportRef.current });
      if (r && !stop) {
        lamportRef.current = r.lamport;
        setPresence(r.presence);
        // The user's own follow target is reflected in their presence row.
        setFollowing((prev) => {
          const me = r.presence.find((p) => p.userId === docState?.ownerId);
          return me?.following ?? prev;
        });
        // Apply remote text only when the user is not mid-keystroke, so
        // local typing isn't clobbered between sync cycles.
        if (!editingRef.current && r.text !== textRef.current) {
          setText(r.text);
          textRef.current = r.text;
        }
      }
    };
    const t = setInterval(tick, 1000);

    // Phase 4 realtime push: subscribe to the `collab:doc-op` /
    // `collab:doc-snapshot` / `collab:doc-restored` Socket.IO events the
    // server already emits (see `server/domains/collab.js#emitToDoc`).
    // On any event, run an immediate `tick()` so the local doc updates
    // without waiting for the 1s poll. The poll stays as a backstop in
    // case the WebSocket drops; with both, the sync upper-bound is 1s
    // (poll) and the typical latency on healthy ws is single-digit ms.
    let socket: ReturnType<typeof import('socket.io-client')['io']> | null = null;
    if (typeof window !== 'undefined') {
      (async () => {
        try {
          const { io } = await import('socket.io-client');
          if (stop) return;
          socket = io({ path: '/socket.io', transports: ['websocket', 'polling'], reconnection: true });
          const room = `collab:doc:${activeDocId}`;
          socket.emit('room:join', { room });
          const onOp = () => { if (!stop) void tick(); };
          socket.on('collab:doc-op', onOp);
          socket.on('collab:doc-snapshot', onOp);
          socket.on('collab:doc-restored', onOp);
          socket.on('collab:comment', onOp);
          socket.on('collab:thread-resolved', onOp);
        } catch { /* graceful fallback: poll path keeps working */ }
      })();
    }
    return () => {
      stop = true;
      clearInterval(t);
      try { socket?.disconnect(); } catch { /* ignore */ }
    };
  }, [activeDocId, docState?.ownerId]);

  // ── Heartbeat the cursor into presence (every 2s + on selection change) ──
  const heartbeatCursor = useCallback(async () => {
    if (!activeDocId || !taRef.current) return;
    const ta = taRef.current;
    await call<{ presence: PresenceRow[] }>('cursorUpdate', {
      docId: activeDocId,
      cursor: ta.selectionStart,
      selection: { start: ta.selectionStart, end: ta.selectionEnd },
    });
  }, [activeDocId]);
  useEffect(() => {
    if (!activeDocId) return;
    const t = setInterval(heartbeatCursor, 2000);
    return () => clearInterval(t);
  }, [activeDocId, heartbeatCursor]);

  // ── Editing — diff local text into a CRDT op ─────────────────────────────
  const onTextChange = useCallback(async (next: string) => {
    if (!activeDocId) return;
    editingRef.current = true;
    const prev = textRef.current;
    setText(next);
    textRef.current = next;
    const op = diffToOp(prev, next);
    if (op) {
      const r = await call<{ lamport: number; text: string }>('docOp', {
        docId: activeDocId, ...op, lamport: lamportRef.current,
      });
      if (r) lamportRef.current = r.lamport;
      else flash('err', 'Edit rejected (permission tier or document gone).');
    } else if (prev !== next) {
      // Replace: emit a delete + an insert in order.
      let common = 0;
      while (common < Math.min(prev.length, next.length) && prev[common] === next[common]) common++;
      const del = await call<{ lamport: number }>('docOp', {
        docId: activeDocId, type: 'delete', pos: common, len: prev.length - common, lamport: lamportRef.current,
      });
      if (del) lamportRef.current = del.lamport;
      const ins = await call<{ lamport: number }>('docOp', {
        docId: activeDocId, type: 'insert', pos: common, text: next.slice(common), lamport: lamportRef.current,
      });
      if (ins) lamportRef.current = ins.lamport;
    }
    setTimeout(() => { editingRef.current = false; }, 700);
  }, [activeDocId]);

  // ── Create document ──────────────────────────────────────────────────────
  const createDoc = useCallback(async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    const r = await call<{ id: string }>('docCreate', { title: newTitle.trim(), text: '' });
    setBusy(false);
    if (r) {
      setNewTitle('');
      setCreating(false);
      await loadDocs();
      await openDoc(r.id);
      flash('ok', 'Document created.');
    } else flash('err', 'Could not create document.');
  }, [newTitle, loadDocs, openDoc]);

  // ── Version history ──────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!activeDocId) return;
    const r = await call<{ snapshots: Snapshot[] }>('docHistory', { docId: activeDocId });
    setSnapshots(r?.snapshots ?? []);
  }, [activeDocId]);
  const takeSnapshot = useCallback(async () => {
    if (!activeDocId) return;
    setBusy(true);
    const r = await call<{ label: string }>('docSnapshot', { docId: activeDocId, label: snapLabel.trim() });
    setBusy(false);
    if (r) { setSnapLabel(''); await loadHistory(); flash('ok', `Saved "${r.label}".`); }
    else flash('err', 'Snapshot failed (edit tier required).');
  }, [activeDocId, snapLabel, loadHistory]);
  const restoreSnapshot = useCallback(async (snapshotId: string) => {
    if (!activeDocId) return;
    setBusy(true);
    const r = await call<{ restoredTo: string; text: string; lamport: number }>('docRestore', { docId: activeDocId, snapshotId });
    setBusy(false);
    if (r) {
      setText(r.text); textRef.current = r.text; lamportRef.current = r.lamport;
      await loadHistory();
      flash('ok', `Restored to "${r.restoredTo}".`);
    } else flash('err', 'Restore failed.');
  }, [activeDocId, loadHistory]);

  // ── Comments ─────────────────────────────────────────────────────────────
  const loadComments = useCallback(async () => {
    if (!activeDocId) return;
    const r = await call<{ threads: CommentThread[] }>('listComments', { docId: activeDocId, includeResolved: true });
    setThreads(r?.threads ?? []);
  }, [activeDocId]);
  const postComment = useCallback(async () => {
    if (!activeDocId || !newComment.trim()) return;
    setBusy(true);
    const r = await call<{ comment: Comment }>('addComment', {
      docId: activeDocId, text: newComment.trim(),
      ...(pinElement.trim() ? { elementId: pinElement.trim() } : {}),
    });
    setBusy(false);
    if (r) {
      setNewComment(''); setPinElement('');
      await loadComments();
      flash('ok', r.comment.mentions.length ? `Posted — notified ${r.comment.mentions.length} @mention(s).` : 'Comment posted.');
    } else flash('err', 'Comment failed (comment tier required).');
  }, [activeDocId, newComment, pinElement, loadComments]);
  const postReply = useCallback(async (parentId: string) => {
    if (!activeDocId || !replyText.trim()) return;
    setBusy(true);
    const r = await call<{ comment: Comment }>('addComment', {
      docId: activeDocId, parentId, text: replyText.trim(),
    });
    setBusy(false);
    if (r) { setReplyText(''); setReplyTo(null); await loadComments(); flash('ok', 'Reply posted.'); }
    else flash('err', 'Reply failed.');
  }, [activeDocId, replyText, loadComments]);
  const toggleResolve = useCallback(async (threadId: string, resolved: boolean) => {
    if (!activeDocId) return;
    const r = await call<{ resolved: boolean }>('resolveThread', { docId: activeDocId, threadId, reopen: resolved });
    if (r) await loadComments();
  }, [activeDocId, loadComments]);

  // ── Permissions ──────────────────────────────────────────────────────────
  const loadPerms = useCallback(async () => {
    if (!activeDocId) return;
    const r = await call<PermResult>('getPermissions', { docId: activeDocId });
    setPerms(r);
  }, [activeDocId]);
  const grantPerm = useCallback(async () => {
    if (!activeDocId || !permUser.trim()) return;
    setBusy(true);
    const r = await call<{ permissions: Record<string, Tier> }>('setPermission', {
      docId: activeDocId, userId: permUser.trim(), tier: permTier,
    });
    setBusy(false);
    if (r) { setPermUser(''); await loadPerms(); flash('ok', `Granted ${permTier} to ${permUser.trim()}.`); }
    else flash('err', 'Only the owner can change permissions.');
  }, [activeDocId, permUser, permTier, loadPerms]);
  const setDefaultTier = useCallback(async (tier: Tier) => {
    if (!activeDocId) return;
    const r = await call<{ defaultTier: Tier }>('setPermission', { docId: activeDocId, isDefault: true, tier });
    if (r) { await loadPerms(); flash('ok', `Default access set to ${tier}.`); }
  }, [activeDocId, loadPerms]);

  // ── Follow-mode ──────────────────────────────────────────────────────────
  const toggleFollow = useCallback(async (targetId: string) => {
    if (!activeDocId) return;
    const next = following === targetId ? null : targetId;
    const r = await call<{ following: string | null }>('setFollow', {
      docId: activeDocId, ...(next ? { targetId: next } : {}),
    });
    if (r) {
      setFollowing(r.following);
      flash('ok', r.following ? 'Following — your view tracks theirs.' : 'Stopped following.');
    }
  }, [activeDocId, following]);

  // When following someone, mirror their cursor into the editor selection.
  useEffect(() => {
    if (!following || !taRef.current) return;
    const target = presence.find((p) => p.userId === following);
    if (target && taRef.current && document.activeElement !== taRef.current) {
      taRef.current.setSelectionRange(target.cursor, target.cursor);
    }
  }, [following, presence]);

  // ── Tab-driven data loading ──────────────────────────────────────────────
  useEffect(() => {
    if (!activeDocId) return;
    if (tab === 'history') loadHistory();
    if (tab === 'comments') loadComments();
    if (tab === 'permissions') loadPerms();
  }, [tab, activeDocId, loadHistory, loadComments, loadPerms]);

  const markRead = useCallback(async (id?: string) => {
    await call('markNotificationRead', id ? { notificationId: id } : { all: true });
    await loadNotifs();
  }, [loadNotifs]);

  const historyEvents = useMemo<TimelineEvent[]>(() =>
    snapshots.map((s) => ({
      id: s.id, label: s.label, time: s.createdAt,
      tone: 'info' as const,
      detail: `${s.chars} chars · ${s.opCount} ops · ${s.authorName}`,
    })), [snapshots]);

  const canEdit = docState ? docState.canEdit : false;
  const canComment = docState ? docState.canComment : false;

  // ── Render: document list ────────────────────────────────────────────────
  if (!activeDocId) {
    return (
      <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-4 space-y-3">
        <header className="flex items-center justify-between border-b border-blue-500/10 pb-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">Multiplayer documents</h3>
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
              CRDT co-edit
            </span>
          </div>
          <NotifBell unread={unread} show={showNotifs} setShow={setShowNotifs} notifs={notifs} markRead={markRead} />
        </header>

        {creating ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createDoc()}
              placeholder="Document title"
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-sm text-white"
            />
            <button onClick={createDoc} disabled={busy || !newTitle.trim()}
              className="px-3 py-1.5 rounded bg-blue-500/20 text-blue-300 text-xs font-semibold disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create'}
            </button>
            <button onClick={() => { setCreating(false); setNewTitle(''); }} className="text-zinc-500" aria-label="Cancel">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-500/15 text-blue-300 text-xs font-semibold hover:bg-blue-500/25">
            <Plus className="w-3.5 h-3.5" /> New document
          </button>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-zinc-500 text-xs py-6 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading documents…
          </div>
        ) : docs.length === 0 ? (
          <p className="text-xs text-zinc-500 py-6 text-center">
            No shared documents yet. Create one to start co-editing in real time.
          </p>
        ) : (
          <div className="space-y-1.5">
            {docs.map((d) => (
              <button key={d.id} onClick={() => openDoc(d.id)}
                className="w-full flex items-center justify-between p-2.5 rounded border border-zinc-800 bg-zinc-900/40 hover:border-blue-500/40 hover:bg-zinc-800/60 text-left transition-all">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-100 truncate flex items-center gap-1.5">
                    {d.isOwner && <Crown className="w-3 h-3 text-amber-400 shrink-0" />}
                    {d.title}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    {d.opCount} edits · {d.snapshotCount} versions · updated {timeAgo(d.updatedAt)}
                  </div>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase shrink-0 ml-2 bg-zinc-800 text-zinc-400">
                  {d.tier}
                </span>
              </button>
            ))}
          </div>
        )}
        {msg && <Toast msg={msg} />}
      </div>
    );
  }

  // ── Render: open document ────────────────────────────────────────────────
  const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
    { id: 'edit', label: 'Editor', icon: FileText },
    { id: 'history', label: 'Versions', icon: History },
    { id: 'comments', label: 'Comments', icon: MessageSquare },
    { id: 'permissions', label: 'Access', icon: Shield },
  ];

  return (
    <div className="rounded-lg border border-blue-500/20 bg-zinc-950/60 p-4 space-y-3">
      <header className="flex items-center justify-between border-b border-blue-500/10 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => { setActiveDocId(null); setDocState(null); loadDocs(); }}
            className="text-zinc-500 hover:text-zinc-300 text-xs">← Docs</button>
          <FileText className="h-4 w-4 text-blue-400 shrink-0" />
          <h3 className="text-sm font-semibold text-white truncate">{docState?.title ?? 'Document'}</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase bg-zinc-800 text-zinc-400 shrink-0">
            {docState?.tier ?? 'view'}
          </span>
        </div>
        <NotifBell unread={unread} show={showNotifs} setShow={setShowNotifs} notifs={notifs} markRead={markRead} />
      </header>

      {/* Presence roster — live cursors + follow-mode */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <Users className="w-3.5 h-3.5 text-zinc-500" />
        <span className="text-[10px] text-zinc-500">{presence.length} here:</span>
        {presence.length === 0 && <span className="text-[10px] text-zinc-600">just you</span>}
        {presence.map((p) => (
          <button key={p.userId} onClick={() => toggleFollow(p.userId)}
            title={`cursor @ ${p.cursor}${following === p.userId ? ' · following' : ' · click to follow'}`}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border transition-all"
            style={{
              color: p.color,
              borderColor: following === p.userId ? p.color : `${p.color}40`,
              backgroundColor: `${p.color}1a`,
            }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p.color }} />
            {p.name}
            {following === p.userId && <Eye className="w-2.5 h-2.5" />}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-zinc-800">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t.id ? 'border-blue-400 text-blue-300' : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}>
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      {/* Editor */}
      {tab === 'edit' && (
        <div className="space-y-2">
          {!canEdit && (
            <p className="text-[10px] text-amber-400 flex items-center gap-1">
              <Eye className="w-3 h-3" /> Read-only — your tier is {docState?.tier}.
            </p>
          )}
          <textarea
            ref={taRef}
            value={text}
            readOnly={!canEdit}
            onChange={(e) => onTextChange(e.target.value)}
            onSelect={heartbeatCursor}
            placeholder={canEdit ? 'Start typing — edits sync to everyone in this room…' : 'You have view-only access.'}
            rows={12}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-3 text-sm text-zinc-200 font-mono leading-relaxed resize-y focus:outline-none focus:border-blue-500/50 disabled:opacity-60"
          />
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            <span>{text.length} chars · lamport {lamportRef.current} · {docState?.opCount ?? 0} ops</span>
            {following && (
              <span className="text-blue-300 flex items-center gap-1">
                <Eye className="w-3 h-3" /> following {presence.find((p) => p.userId === following)?.name ?? following}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Version history */}
      {tab === 'history' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input value={snapLabel} onChange={(e) => setSnapLabel(e.target.value)}
              placeholder="Version label (optional)" disabled={!canEdit}
              className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs text-white disabled:opacity-50" />
            <button onClick={takeSnapshot} disabled={busy || !canEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-500/20 text-blue-300 text-xs font-semibold disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
              Save version
            </button>
          </div>
          {snapshots.length > 0 && <TimelineView events={historyEvents} height={90} />}
          {snapshots.length === 0 ? (
            <p className="text-xs text-zinc-500 py-4 text-center">No saved versions yet.</p>
          ) : (
            <div className="space-y-1.5">
              {snapshots.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-2.5 rounded border border-zinc-800 bg-zinc-900/40">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-100 truncate">{s.label}</div>
                    <div className="text-[10px] text-zinc-500">
                      {s.authorName} · {timeAgo(s.createdAt)} · {s.chars} chars
                    </div>
                    {s.preview && <div className="text-[10px] text-zinc-600 truncate mt-0.5 font-mono">{s.preview}</div>}
                  </div>
                  <button onClick={() => restoreSnapshot(s.id)} disabled={busy || !canEdit}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-zinc-800 text-zinc-300 text-[10px] font-semibold hover:bg-zinc-700 disabled:opacity-40 shrink-0 ml-2">
                    <RotateCcw className="w-3 h-3" /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Comments — threaded, @-mention, per-element pins */}
      {tab === 'comments' && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <input value={pinElement} onChange={(e) => setPinElement(e.target.value)}
                placeholder="Pin to element (optional)" disabled={!canComment}
                className="w-44 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-white disabled:opacity-50" />
              <span className="text-[10px] text-zinc-500 flex items-center gap-1">
                <AtSign className="w-3 h-3" /> use @handle to mention + notify
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input value={newComment} onChange={(e) => setNewComment(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && postComment()}
                placeholder={canComment ? 'Add a comment…' : 'Comment tier required'} disabled={!canComment}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs text-white disabled:opacity-50" />
              <button onClick={postComment} disabled={busy || !canComment || !newComment.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-500/20 text-blue-300 text-xs font-semibold disabled:opacity-40">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Post
              </button>
            </div>
          </div>
          {threads.length === 0 ? (
            <p className="text-xs text-zinc-500 py-4 text-center">No comments yet.</p>
          ) : (
            <div className="space-y-2">
              {threads.map((th) => (
                <div key={th.threadId}
                  className={`rounded border p-2.5 ${th.resolved ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/40'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                      {th.elementId && (
                        <span className="flex items-center gap-0.5 text-cyan-400">
                          <MapPin className="w-3 h-3" /> {th.elementId}
                        </span>
                      )}
                      <span>{th.commentCount} message{th.commentCount !== 1 ? 's' : ''}</span>
                    </div>
                    <button onClick={() => toggleResolve(th.threadId, th.resolved)} disabled={!canComment}
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold disabled:opacity-40 ${
                        th.resolved ? 'bg-zinc-800 text-zinc-400' : 'bg-emerald-500/20 text-emerald-300'
                      }`}>
                      <Check className="w-3 h-3" /> {th.resolved ? 'Reopen' : 'Resolve'}
                    </button>
                  </div>
                  {th.comments.map((c) => (
                    <div key={c.id} className={`text-xs text-zinc-300 py-1 ${c.parentId ? 'pl-4 border-l border-zinc-700 ml-1' : ''}`}>
                      <span className="font-semibold text-zinc-100">{c.authorName}</span>
                      <span className="text-[10px] text-zinc-600 ml-1.5">{timeAgo(c.createdAt)}</span>
                      <p className="text-zinc-300 mt-0.5">{renderMentions(c.text)}</p>
                    </div>
                  ))}
                  {replyTo === th.threadId ? (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <input autoFocus value={replyText} onChange={(e) => setReplyText(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && postReply(th.comments[th.comments.length - 1].id)}
                        placeholder="Reply…"
                        className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-[11px] text-white" />
                      <button onClick={() => postReply(th.comments[th.comments.length - 1].id)} disabled={busy}
                        className="px-2 py-1 rounded bg-blue-500/20 text-blue-300 text-[10px] font-semibold disabled:opacity-40">Send</button>
                      <button onClick={() => { setReplyTo(null); setReplyText(''); }} className="text-zinc-500" aria-label="Cancel reply">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    canComment && (
                      <button onClick={() => { setReplyTo(th.threadId); setReplyText(''); }}
                        className="text-[10px] text-blue-400 hover:text-blue-300 mt-1">Reply</button>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Permissions */}
      {tab === 'permissions' && (
        <div className="space-y-3">
          {perms && (
            <>
              <div className="text-[11px] text-zinc-400">
                Owner: <span className="font-mono text-zinc-200">{perms.ownerId}</span>
                {' · '}your tier: <span className="font-mono text-blue-300">{perms.myTier}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500">Default access for anyone not listed:</span>
                {(['view', 'comment', 'edit'] as Tier[]).map((t) => (
                  <button key={t} onClick={() => setDefaultTier(t)}
                    disabled={perms.myTier !== 'edit' || perms.ownerId === ''}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      perms.defaultTier === t ? 'bg-blue-500/30 text-blue-200' : 'bg-zinc-800 text-zinc-400'
                    } disabled:opacity-40`}>
                    {t}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input value={permUser} onChange={(e) => setPermUser(e.target.value)}
                  placeholder="User ID to grant"
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-3 py-1.5 text-xs text-white" />
                <select value={permTier} onChange={(e) => setPermTier(e.target.value as Tier)}
                  className="bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-white">
                  <option value="view">view</option>
                  <option value="comment">comment</option>
                  <option value="edit">edit</option>
                </select>
                <button onClick={grantPerm} disabled={busy || !permUser.trim()}
                  className="px-3 py-1.5 rounded bg-blue-500/20 text-blue-300 text-xs font-semibold disabled:opacity-40">
                  {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Grant'}
                </button>
              </div>
              {perms.entries.length === 0 ? (
                <p className="text-xs text-zinc-500 py-2 text-center">No per-user grants — everyone gets {perms.defaultTier}.</p>
              ) : (
                <div className="space-y-1">
                  {perms.entries.map((e) => (
                    <div key={e.userId} className="flex items-center justify-between p-2 rounded border border-zinc-800 bg-zinc-900/40">
                      <span className="text-xs font-mono text-zinc-200 truncate">{e.userId}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono uppercase shrink-0 ml-2"
                        style={{
                          color: TIER_RANK[e.tier] === 3 ? '#34d399' : TIER_RANK[e.tier] === 2 ? '#60a5fa' : '#a1a1aa',
                          backgroundColor: '#27272a',
                        }}>
                        {e.tier}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {msg && <Toast msg={msg} />}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function renderMentions(text: string) {
  const parts = text.split(/(@[A-Za-z0-9_][A-Za-z0-9_.-]{1,63})/g);
  return parts.map((p, i) =>
    p.startsWith('@')
      ? <span key={i} className="text-blue-400 font-medium">{p}</span>
      : <span key={i}>{p}</span>,
  );
}

function NotifBell({
  unread, show, setShow, notifs, markRead,
}: {
  unread: number; show: boolean; setShow: (v: boolean) => void;
  notifs: Notification[]; markRead: (id?: string) => void;
}) {
  return (
    <div className="relative">
      <button onClick={() => setShow(!show)}
        className="relative p-1.5 rounded hover:bg-zinc-800 text-zinc-400" aria-label="Notifications">
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-0.5 rounded-full bg-blue-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {show && (
        <div className="absolute right-0 top-full mt-1 w-72 max-h-80 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl z-20 p-2 space-y-1">
          <div className="flex items-center justify-between px-1 pb-1 border-b border-zinc-800">
            <span className="text-[11px] font-semibold text-zinc-300">Notifications</span>
            {unread > 0 && (
              <button onClick={() => markRead()} className="text-[10px] text-blue-400">Mark all read</button>
            )}
          </div>
          {notifs.length === 0 ? (
            <p className="text-[11px] text-zinc-500 py-3 text-center">Nothing yet.</p>
          ) : (
            notifs.map((n) => (
              <button key={n.id} onClick={() => markRead(n.id)}
                className={`w-full text-left p-1.5 rounded text-[11px] ${n.read ? 'text-zinc-500' : 'bg-blue-500/10 text-zinc-200'}`}>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] px-1 py-px rounded bg-zinc-800 text-zinc-400 uppercase font-mono">{n.kind}</span>
                  {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />}
                </div>
                <p className="mt-0.5 leading-snug">{n.text}</p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Toast({ msg }: { msg: { kind: 'ok' | 'err'; text: string } }) {
  return (
    <div className={`px-3 py-2 rounded text-[11px] flex items-center gap-2 border ${
      msg.kind === 'ok'
        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
        : 'bg-red-500/10 text-red-300 border-red-500/30'
    }`}>
      {msg.kind === 'ok' ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {msg.text}
    </div>
  );
}
