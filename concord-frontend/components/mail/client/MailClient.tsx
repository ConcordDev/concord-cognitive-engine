'use client';

/**
 * MailClient — a full email client over the user's own Gmail (gmail.* macros)
 * with Concord player mail as one more mailbox. Three panes: mailboxes and
 * labels, the conversation list (search, bulk actions, paging), and the
 * threaded reader. Compose / reply / reply-all / forward open a floating
 * composer; Send waits five seconds so it can be undone, then really sends.
 * Gmail keyboard shortcuts are registered with the lens palette.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertCircle, Archive, ChevronLeft, ChevronRight, File, Inbox, Loader2, Mail, MailOpen, Plus, RefreshCw, Search,
  Send, ShieldAlert, Star, Tag, Trash2, Undo2, X, Gamepad2, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useUIStore } from '@/store/ui';
import { MailFolderPanel } from '@/components/mail/MailFolderPanel';
import { ComposeMailPanel } from '@/components/mail/ComposeMailPanel';
import {
  NOT_CONNECTED, SYSTEM_FOLDERS, fmtListDate, forwardDraft, gmail, replyDraft, senderName,
  type Draft, type FullMessage, type GmailLabel, type Outgoing, type ThreadSummary,
} from './gmail';
import { ComposeSheet, type ComposeInit } from './ComposeSheet';
import { ThreadView, type ThreadAction } from './ThreadView';

const FOLDER_ICON: Record<string, typeof Inbox> = {
  INBOX: Inbox, STARRED: Star, IMPORTANT: AlertTriangle, SENT: Send, DRAFT: File, ALL: Mail, SPAM: ShieldAlert, TRASH: Trash2,
};
const UNDO_MS = 5000;
const emptyDraft = (): Outgoing => ({ to: '', cc: '', bcc: '', subject: '', body: '', attachments: [] });
const toast = (type: 'success' | 'error' | 'info', message: string) => useUIStore.getState().addToast({ type, message });

/** How a thread action changes the current list: does the row leave it? */
function leavesFolder(action: ThreadAction, folder: string): boolean {
  if (action === 'trash' || action === 'spam') return folder !== 'ALL' || action === 'spam';
  if (action === 'archive') return folder === 'INBOX';
  if (action === 'untrash') return folder === 'TRASH';
  if (action === 'not-spam') return folder === 'SPAM';
  if (action === 'unstar') return folder === 'STARRED';
  return false;
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('min-h-0 overflow-hidden rounded-2xl border border-white/10 bg-[#111]', className)}>{children}</section>;
}

export function MailClient({ composeSignal = 0 }: { composeSignal?: number }) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [me, setMe] = useState('');
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [folder, setFolder] = useState('INBOX');
  const [query, setQuery] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [pages, setPages] = useState<Array<string | undefined>>([undefined]);
  const [pageIdx, setPageIdx] = useState(0);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [estimate, setEstimate] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [composers, setComposers] = useState<ComposeInit[]>([]);
  const [pending, setPending] = useState<{ m: Outgoing; init: ComposeInit; deadline: number } | null>(null);
  const [reloadThread, setReloadThread] = useState(0);
  const [newLabel, setNewLabel] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notice, setNotice] = useState<{ message: string; undo?: () => void } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((message: string, undo?: () => void) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ message, undo });
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);

  const isConcord = folder === 'CONCORD';
  const isDrafts = folder === 'DRAFT';

  const handleFail = useCallback((error: string) => {
    if (NOT_CONNECTED.has(error)) { setConnected(false); return true; }
    return false;
  }, []);

  const loadList = useCallback(async () => {
    if (isConcord) return;
    setLoading(true); setListError(null);
    if (isDrafts) {
      const r = await gmail.drafts();
      setLoading(false);
      if (!r.ok) { if (!handleFail(r.error)) setListError(r.error); return; }
      setConnected(true); setDrafts(r.data.drafts);
      return;
    }
    const r = await gmail.threads({ label: folder, q: query || undefined, pageToken: pages[pageIdx], maxResults: 25 });
    setLoading(false);
    if (!r.ok) { if (!handleFail(r.error)) { setConnected(true); setListError(r.error); } return; }
    setConnected(true);
    setThreads(r.data.threads);
    setNextToken(r.data.nextPageToken);
    setEstimate(r.data.resultSizeEstimate);
  }, [folder, query, pages, pageIdx, isConcord, isDrafts, handleFail]);

  useEffect(() => { void Promise.resolve().then(loadList); }, [loadList]);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      const [p, l] = await Promise.all([gmail.profile(), gmail.labels()]);
      if (p.ok) setMe(p.data.profile.emailAddress);
      if (l.ok) setLabels(l.data.labels);
    });
  }, [connected]);

  const openFolder = (id: string) => {
    setFolder(id); setOpenId(null); setSelected(new Set()); setPages([undefined]); setPageIdx(0); setCursor(0);
    if (id !== folder) { setQuery(''); setSearchDraft(''); }
  };

  const runSearch = () => { setQuery(searchDraft.trim()); setPages([undefined]); setPageIdx(0); setOpenId(null); setSelected(new Set()); };

  const openThread = (t: ThreadSummary) => {
    setOpenId(t.id);
    if (t.unread) {
      setThreads((xs) => xs.map((x) => (x.id === t.id ? { ...x, unread: false } : x)));
      void gmail.modify(t.id, 'read');
    }
  };

  const applyAction = useCallback(async (ids: string[], action: ThreadAction) => {
    if (!ids.length) return;
    const leaving = leavesFolder(action, folder);
    const before = threads;
    setThreads((xs) => (leaving
      ? xs.filter((x) => !ids.includes(x.id))
      : xs.map((x) => (ids.includes(x.id) ? {
        ...x,
        unread: action === 'unread' ? true : x.unread,
        starred: action === 'star' ? true : action === 'unstar' ? false : x.starred,
      } : x))));
    if (leaving && openId && ids.includes(openId)) setOpenId(null);
    setSelected(new Set());
    const results = await Promise.all(ids.map((id) => (action === 'trash' ? gmail.trash(id) : action === 'untrash' ? gmail.untrash(id) : gmail.modify(id, action))));
    const failed = results.filter((r) => !r.ok).length;
    if (failed) { setThreads(before); toast('error', `${failed} conversation${failed === 1 ? '' : 's'} could not be updated.`); return; }
    const verb: Record<string, string> = { archive: 'Archived', trash: 'Moved to Trash', untrash: 'Restored', spam: 'Reported as spam', 'not-spam': 'Moved to Inbox', inbox: 'Moved to Inbox', unread: 'Marked unread' };
    if (verb[action]) {
      const reverse = action === 'archive' ? 'inbox' : action === 'trash' ? 'untrash' : action === 'spam' ? 'not-spam' : null;
      showNotice(`${verb[action]}${ids.length > 1 ? ` · ${ids.length} conversations` : ''}`, reverse
        ? () => { void Promise.all(ids.map((id) => (reverse === 'untrash' ? gmail.untrash(id) : gmail.modify(id, reverse)))).then(() => loadList()); }
        : undefined);
    }
    if (action === 'unread' && openId && ids.includes(openId)) setOpenId(null);
    if (!leaving && openId && ids.includes(openId)) setReloadThread((k) => k + 1);
  }, [folder, threads, openId, loadList, showNotice]);

  const setLabel = useCallback(async (threadId: string, labelId: string, on: boolean) => {
    const r = await gmail.label(threadId, on ? [labelId] : [], on ? [] : [labelId]);
    if (!r.ok) { toast('error', 'Label change failed.'); return; }
    setReloadThread((k) => k + 1);
    if (!on && folder === labelId) setThreads((xs) => xs.filter((x) => x.id !== threadId));
  }, [folder]);

  const createLabel = async () => {
    const name = (newLabel || '').trim();
    if (!name) { setNewLabel(null); return; }
    const r = await gmail.createLabel(name);
    if (!r.ok) { toast('error', `Could not create label: ${r.error.replace(/_/g, ' ')}`); return; }
    setLabels((xs) => [...xs, r.data.label]);
    setNewLabel(null);
  };

  const openComposer = useCallback((init: Omit<ComposeInit, 'key'>) => {
    setComposers((xs) => [...xs.slice(-1), { ...init, key: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }]);
  }, []);

  const reply = useCallback((mode: 'reply' | 'replyAll' | 'forward', m: FullMessage) => {
    if (mode === 'forward') openComposer({ mode, draft: forwardDraft(m), forwardFrom: { messageId: m.id, attachments: m.attachments } });
    else openComposer({ mode, draft: replyDraft(m, me, mode === 'replyAll') });
  }, [me, openComposer]);

  const reallySend = useCallback(async (m: Outgoing) => {
    const r = await gmail.send(m);
    if (!r.ok) { toast('error', `Not sent: ${r.error.replace(/_/g, ' ')}. Your message was kept as a draft.`); void gmail.saveDraft(m); return; }
    if (m.draftId) void gmail.deleteDraft(m.draftId);
    toast('success', 'Message sent');
    if (folder === 'SENT' || folder === 'DRAFT' || (m.threadId && openId === m.threadId)) { void loadList(); setReloadThread((k) => k + 1); }
  }, [folder, openId, loadList]);

  const queueSend = useCallback((m: Outgoing, init: ComposeInit) => {
    setComposers((xs) => xs.filter((c) => c.key !== init.key));
    if (timerRef.current) clearTimeout(timerRef.current);
    setPending({ m, init, deadline: Date.now() + UNDO_MS });
    timerRef.current = setTimeout(() => { setPending(null); void reallySend(m); }, UNDO_MS);
  }, [reallySend]);

  const undoSend = () => {
    if (!pending) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    openComposer({ ...pending.init, draft: pending.m });
    setPending(null);
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);
  const lastSignal = useRef(composeSignal);
  useEffect(() => {
    if (composeSignal !== lastSignal.current) {
      lastSignal.current = composeSignal;
      if (isConcord) return;
      queueMicrotask(() => openComposer({ mode: 'new', draft: emptyDraft() }));
    }
  }, [composeSignal, isConcord, openComposer]);

  const openDraft = (d: Draft) => {
    const msg = d.message;
    openComposer({ mode: 'draft', draft: { to: msg.to, cc: msg.cc, bcc: '', subject: msg.subject === '(no subject)' ? '' : msg.subject, body: msg.text, attachments: [], threadId: msg.threadId, draftId: d.id } });
  };

  const current = threads[Math.min(cursor, Math.max(0, threads.length - 1))];
  const openThreadObj = useMemo(() => threads.find((t) => t.id === openId), [threads, openId]);
  useLensCommand([
    { id: 'mail-compose', keys: 'c', description: 'Compose', category: 'actions', action: () => openComposer({ mode: 'new', draft: emptyDraft() }) },
    { id: 'mail-search', keys: '/', description: 'Search mail', category: 'navigation', action: () => searchRef.current?.focus() },
    { id: 'mail-next', keys: 'j', description: 'Next conversation', category: 'navigation', action: () => { const i = Math.min(cursor + 1, threads.length - 1); setCursor(i); if (openId && threads[i]) openThread(threads[i]); } },
    { id: 'mail-prev', keys: 'k', description: 'Previous conversation', category: 'navigation', action: () => { const i = Math.max(cursor - 1, 0); setCursor(i); if (openId && threads[i]) openThread(threads[i]); } },
    { id: 'mail-open', keys: 'o', description: 'Open conversation', category: 'navigation', action: () => { if (current) openThread(current); } },
    { id: 'mail-back', keys: 'u', description: 'Back to list', category: 'navigation', action: () => setOpenId(null) },
    { id: 'mail-archive', keys: 'e', description: 'Archive', category: 'actions', action: () => { const id = openId || (selected.size ? null : current?.id); void applyAction(id ? [id] : [...selected], 'archive'); } },
    { id: 'mail-trash', keys: 'shift+3', description: 'Delete (#)', category: 'actions', action: () => { const id = openId || (selected.size ? null : current?.id); void applyAction(id ? [id] : [...selected], 'trash'); } },
    { id: 'mail-star', keys: 's', description: 'Star / unstar', category: 'actions', action: () => { const t = openThreadObj || current; if (t) void applyAction([t.id], t.starred ? 'unstar' : 'star'); } },
    { id: 'mail-unread', keys: 'shift+u', description: 'Mark unread', category: 'actions', action: () => { const t = openThreadObj || current; if (t) void applyAction([t.id], 'unread'); } },
    { id: 'mail-select', keys: 'x', description: 'Select conversation', category: 'editing', action: () => { if (current) setSelected((s) => { const n = new Set(s); if (n.has(current.id)) n.delete(current.id); else n.add(current.id); return n; }); } },
    { id: 'mail-inbox', keys: 'g i', description: 'Go to Inbox', category: 'navigation', action: () => openFolder('INBOX') },
    { id: 'mail-sent', keys: 'g t', description: 'Go to Sent', category: 'navigation', action: () => openFolder('SENT') },
    { id: 'mail-drafts', keys: 'g d', description: 'Go to Drafts', category: 'navigation', action: () => openFolder('DRAFT') },
    { id: 'mail-starred', keys: 'g s', description: 'Go to Starred', category: 'navigation', action: () => openFolder('STARRED') },
  ], { lensId: 'mail' });

  const userLabels = labels.filter((l) => l.type === 'user').sort((a, b) => a.name.localeCompare(b.name));
  const allSelected = threads.length > 0 && threads.every((t) => selected.has(t.id));
  const tool = 'rounded-full p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 disabled:opacity-30';
  const folderName = isConcord ? 'Concord mail' : SYSTEM_FOLDERS.find((f) => f.id === folder)?.label || labels.find((l) => l.id === folder)?.name || folder;

  const sidebar = (
    <nav aria-label="Mailboxes" className="flex flex-col gap-0.5 p-2">
      {SYSTEM_FOLDERS.map((f) => {
        const Icon = FOLDER_ICON[f.id] || Mail;
        const on = folder === f.id;
        return (
          <button key={f.id} type="button" onClick={() => openFolder(f.id)} aria-current={on ? 'page' : undefined}
            className={cn('flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors', on ? 'bg-white/10 text-zinc-50' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200')}>
            <Icon className="h-4 w-4" /> {f.label}
          </button>
        );
      })}
      <p className="mt-4 px-3 text-[11px] uppercase tracking-wider text-zinc-500">Labels</p>
      {userLabels.map((l) => (
        <button key={l.id} type="button" onClick={() => openFolder(l.id)} aria-current={folder === l.id ? 'page' : undefined}
          className={cn('flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-left text-[13px] transition-colors', folder === l.id ? 'bg-white/10 text-zinc-50' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200')}>
          <Tag className="h-3.5 w-3.5" /> <span className="truncate">{l.name}</span>
        </button>
      ))}
      {newLabel != null ? (
        <input autoFocus aria-label="New label name" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void createLabel(); if (e.key === 'Escape') setNewLabel(null); }} onBlur={() => void createLabel()}
          className="mx-2 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-[12px] text-zinc-100 focus:border-teal-400/50 focus:outline-none" />
      ) : connected !== false && (
        <button type="button" onClick={() => setNewLabel('')} className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[12px] text-zinc-500 transition-colors hover:text-zinc-200">
          <Plus className="h-3.5 w-3.5" /> New label
        </button>
      )}
      <p className="mt-4 px-3 text-[11px] uppercase tracking-wider text-zinc-500">In Concord</p>
      <button type="button" onClick={() => openFolder('CONCORD')} aria-current={isConcord ? 'page' : undefined}
        className={cn('flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-colors', isConcord ? 'bg-white/10 text-zinc-50' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200')}>
        <Gamepad2 className="h-4 w-4" /> Player mail
      </button>
      {me && <p className="mt-4 truncate px-3 text-[11px] text-zinc-500" title={me}>{me}</p>}
    </nav>
  );

  const connectCard = (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <Mail className="h-8 w-8 text-teal-300" />
      <h3 className="font-vault text-2xl text-zinc-100">Bring your inbox here</h3>
      <p className="max-w-sm text-sm text-zinc-400">Connect Gmail to read, search, reply, label and send from Concord. Access uses your own Google sign-in and can be revoked at any time.</p>
      <button type="button" onClick={() => void gmail.connect().then((r) => { if (r.ok) window.location.href = r.data.authorizeUrl; else toast('error', 'Gmail is not configured on this server yet.'); })}
        className="mt-2 rounded-full bg-teal-400 px-5 py-2 text-sm font-medium text-black transition-colors hover:bg-teal-300">
        Connect Gmail
      </button>
      <button type="button" onClick={() => openFolder('CONCORD')} className="text-[12px] text-zinc-500 hover:text-zinc-200">Or open your Concord player mail</button>
    </div>
  );

  let main: ReactNode;
  if (isConcord) {
    main = <ConcordMailbox />;
  } else if (connected === false) {
    main = <Panel className="h-full">{connectCard}</Panel>;
  } else {
    const list = (
      <Panel className={cn('flex h-full flex-col', openId && 'hidden lg:flex')}>
        <div className="flex shrink-0 items-center gap-1 border-b border-white/5 px-2 py-2">
          {!isDrafts && (
            <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(threads.map((t) => t.id)))} className="mx-2 accent-teal-400" />
          )}
          {selected.size > 0 ? (
            <>
              <span className="mr-1 text-[12px] text-zinc-400">{selected.size}</span>
              {folder === 'TRASH'
                ? <button type="button" aria-label="Restore selected" onClick={() => void applyAction([...selected], 'untrash')} className={tool}><Undo2 className="h-4 w-4" /></button>
                : <>
                  <button type="button" aria-label="Archive selected" onClick={() => void applyAction([...selected], 'archive')} className={tool}><Archive className="h-4 w-4" /></button>
                  <button type="button" aria-label="Report selected as spam" onClick={() => void applyAction([...selected], folder === 'SPAM' ? 'not-spam' : 'spam')} className={tool}><ShieldAlert className="h-4 w-4" /></button>
                  <button type="button" aria-label="Delete selected" onClick={() => void applyAction([...selected], 'trash')} className={tool}><Trash2 className="h-4 w-4" /></button>
                </>}
              <button type="button" aria-label="Mark selected read" onClick={() => void applyAction([...selected], 'read')} className={tool}><MailOpen className="h-4 w-4" /></button>
              <button type="button" aria-label="Mark selected unread" onClick={() => void applyAction([...selected], 'unread')} className={tool}><Mail className="h-4 w-4" /></button>
            </>
          ) : (
            <button type="button" aria-label="Refresh" onClick={() => void loadList()} className={tool}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          )}
          {!isDrafts && (
            <div className="ml-auto flex items-center gap-1 text-[12px] text-zinc-500">
              <span className="hidden sm:inline">{threads.length ? `${pageIdx * 25 + 1}–${pageIdx * 25 + threads.length}${estimate > threads.length ? ` of ~${estimate}` : ''}` : ''}</span>
              <button type="button" aria-label="Newer" disabled={pageIdx === 0} onClick={() => setPageIdx((i) => Math.max(0, i - 1))} className={tool}><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" aria-label="Older" disabled={!nextToken} onClick={() => { setPages((p) => { const n = p.slice(0, pageIdx + 1); n.push(nextToken || undefined); return n; }); setPageIdx((i) => i + 1); }} className={tool}><ChevronRight className="h-4 w-4" /></button>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listError && (
            <p role="alert" className="flex items-center gap-2 p-4 text-[13px] text-rose-300"><AlertCircle className="h-4 w-4" /> Could not load {folderName}: {listError.replace(/_/g, ' ')}</p>
          )}
          {!listError && loading && threads.length === 0 && drafts.length === 0 && (
            <div role="status" aria-busy="true" className="space-y-px p-2">
              {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.03]" />)}
            </div>
          )}
          {isDrafts ? (
            !loading && drafts.length === 0 ? <p className="p-8 text-center text-sm text-zinc-500">No drafts.</p> : (
              <ul>
                {drafts.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => openDraft(d)} className="flex w-full items-baseline gap-3 border-b border-white/5 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]">
                      <span className="w-40 shrink-0 truncate text-[13px] text-rose-300">Draft{d.message.to ? ` · ${senderName(d.message.to)}` : ''}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-300">{d.message.subject} <span className="text-zinc-500">— {d.message.snippet}</span></span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : !loading && !listError && threads.length === 0 ? (
            <p className="p-8 text-center text-sm text-zinc-500">{query ? `No conversations match “${query}”.` : `${folderName} is empty.`}</p>
          ) : (
            <ul aria-label={`${folderName} conversations`}>
              {threads.map((t, i) => (
                <li key={t.id} className={cn('group flex items-center gap-2 border-b border-white/5 px-2 transition-colors', openId === t.id ? 'bg-teal-400/[0.07]' : i === cursor ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]')}>
                  <input type="checkbox" aria-label={`Select ${t.subject}`} checked={selected.has(t.id)} onChange={() => setSelected((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} className="ml-2 accent-teal-400" />
                  <button type="button" aria-label={t.starred ? 'Unstar' : 'Star'} onClick={() => void applyAction([t.id], t.starred ? 'unstar' : 'star')} className="p-1">
                    <Star className={cn('h-4 w-4', t.starred ? 'fill-amber-400 text-amber-400' : 'text-zinc-600 hover:text-zinc-300')} />
                  </button>
                  <button type="button" onClick={() => { setCursor(i); openThread(t); }} className="flex min-w-0 flex-1 items-baseline gap-3 py-3 pr-2 text-left">
                    <span className={cn('w-36 shrink-0 truncate text-[13px] sm:w-44', t.unread ? 'font-semibold text-zinc-50' : 'text-zinc-400')}>
                      {folder === 'SENT' ? `To: ${t.participants.slice(-1)[0] || ''}` : t.participants.slice(-3).join(', ')}
                      {t.messageCount > 1 && <span className="ml-1 text-[11px] font-normal text-zinc-500">{t.messageCount}</span>}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      <span className={t.unread ? 'font-semibold text-zinc-100' : 'text-zinc-300'}>{t.subject}</span>
                      <span className="text-zinc-500"> — {t.snippet}</span>
                    </span>
                    <span className={cn('shrink-0 text-[11px]', t.unread ? 'font-semibold text-zinc-200' : 'text-zinc-500')}>{fmtListDate(t.lastInternalDate, t.lastDate)}</span>
                  </button>
                  <span className="hidden shrink-0 items-center gap-0.5 pr-2 group-hover:flex">
                    <button type="button" aria-label="Archive" onClick={() => void applyAction([t.id], 'archive')} className="rounded p-1 text-zinc-500 hover:text-zinc-100"><Archive className="h-3.5 w-3.5" /></button>
                    <button type="button" aria-label="Delete" onClick={() => void applyAction([t.id], 'trash')} className="rounded p-1 text-zinc-500 hover:text-zinc-100"><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    );
    main = (
      <div className={cn('grid h-full min-h-0 gap-3', openId ? 'lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]' : '')}>
        {list}
        {openId && (
          <Panel className="h-full">
            <ThreadView threadId={openId} folder={folder} labels={labels} reloadKey={reloadThread}
              onBack={() => setOpenId(null)}
              onAction={(a) => void applyAction([openId], a)}
              onReply={reply}
              onLabel={(labelId, on) => void setLabel(openId, labelId, on)} />
          </Panel>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!isConcord && connected !== false && (
        <form onSubmit={(e) => { e.preventDefault(); runSearch(); }} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 focus-within:border-teal-400/40">
          <Search className="h-4 w-4 text-zinc-500" />
          <input ref={searchRef} aria-label="Search mail" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search mail — from:ana has:attachment after:2026/01/01" className="min-w-0 flex-1 bg-transparent text-[14px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none" />
          {query && <button type="button" aria-label="Clear search" onClick={() => { setSearchDraft(''); setQuery(''); }} className="text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>}
          <kbd className="hidden rounded border border-white/10 px-1.5 text-[10px] text-zinc-500 sm:inline">/</kbd>
        </form>
      )}
      <div className="grid min-h-[34rem] gap-3 md:grid-cols-[13rem_minmax(0,1fr)]" style={{ height: 'calc(100vh - 17rem)' }}>
        <Panel className="hidden overflow-y-auto md:block">{sidebar}</Panel>
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex gap-1 overflow-x-auto md:hidden">
            {[...SYSTEM_FOLDERS.slice(0, 5), { id: 'CONCORD', label: 'Player mail' }].map((f) => (
              <button key={f.id} type="button" onClick={() => openFolder(f.id)} className={cn('shrink-0 rounded-full px-3 py-1 text-[12px]', folder === f.id ? 'bg-white/10 text-zinc-50' : 'text-zinc-500')}>{f.label}</button>
            ))}
          </div>
          <div className="min-h-0 flex-1">{main}</div>
        </div>
      </div>
      {(pending || notice) && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full border border-white/10 bg-[#18181b] px-5 py-2.5 text-[13px] text-zinc-200 shadow-xl">
          {pending ? 'Sending…' : notice?.message}
          {pending
            ? <button type="button" onClick={undoSend} className="font-medium text-teal-300 hover:text-teal-200">Undo</button>
            : notice?.undo && <button type="button" onClick={() => { notice.undo?.(); setNotice(null); }} className="font-medium text-teal-300 hover:text-teal-200">Undo</button>}
        </div>
      )}
      {composers.map((c, i) => (
        <ComposeSheet key={c.key} init={c} offset={composers.length - 1 - i}
          onClose={() => setComposers((xs) => xs.filter((x) => x.key !== c.key))}
          onSend={(m) => queueSend(m, c)} onDraftSaved={(msg) => { toast('success', msg); if (isDrafts) void loadList(); }} />
      ))}
    </div>
  );
}

const CONCORD_TABS = [
  { id: 'inbox', label: 'Inbox' },
  { id: 'sent', label: 'Sent' },
  { id: 'compose', label: 'Compose' },
] as const;

export function ConcordMailbox() {
  const [tab, setTab] = useState<'inbox' | 'sent' | 'compose'>('inbox');
  return (
    <Panel className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-white/5 px-3 py-2">
        <div role="tablist" aria-label="Mail folders" className="flex gap-1">
          {CONCORD_TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={cn('rounded-full px-3 py-1 text-[12px] transition-colors', tab === t.id ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200')}>{t.label}</button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-zinc-500">Player-to-player mail with items, CC and cash on delivery</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'compose' ? <ComposeMailPanel onSent={() => setTab('sent')} /> : <MailFolderPanel folder={tab} onCompose={() => setTab('compose')} />}
      </div>
    </Panel>
  );
}
