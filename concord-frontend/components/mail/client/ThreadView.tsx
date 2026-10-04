'use client';

/**
 * ThreadView — one conversation, Gmail-style: every message as a card (the
 * newest and any unread expanded), sanitized HTML in a script-free sandboxed
 * frame with remote images held back until asked, downloadable attachments,
 * and per-message Reply / Reply all / Forward.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  Archive, ArrowLeft, Download, Forward, Inbox, Loader2, MailOpen, Paperclip, Reply, ReplyAll, ShieldAlert,
  Star, Tag, Trash2, Undo2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  fmtFullDate, fmtSize, gmail, senderName, type FullMessage, type GmailLabel, type MailAttachment,
} from './gmail';

export type ThreadAction = 'archive' | 'inbox' | 'trash' | 'untrash' | 'read' | 'unread' | 'star' | 'unstar' | 'spam' | 'not-spam';

function HtmlBody({ html, showImages }: { html: string; showImages: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const clean = DOMPurify.sanitize(html, showImages ? { WHOLE_DOCUMENT: true } : { WHOLE_DOCUMENT: true, FORBID_TAGS: ['img', 'picture', 'source'] });
  const doc = `<base target="_blank"><style>body{margin:0;font:14px/1.55 -apple-system,system-ui,sans-serif;color:#e4e4e7;background:transparent;word-wrap:break-word}a{color:#5eead4}img{max-width:100%;height:auto}blockquote{border-left:2px solid #3f3f46;margin:0;padding-left:12px;color:#a1a1aa}</style>${clean}`;
  const fit = () => {
    const body = ref.current?.contentDocument?.body;
    if (body) setHeight(Math.min(Math.max(body.scrollHeight + 8, 60), 4000));
  };
  return <iframe ref={ref} title="Message body" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcDoc={doc} onLoad={fit} style={{ height }} className="w-full border-0 bg-transparent" />;
}

function AttachmentChip({ messageId, a }: { messageId: string; a: MailAttachment }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const download = async () => {
    setBusy(true); setFailed(false);
    const r = await gmail.attachment(messageId, a.attachmentId);
    setBusy(false);
    if (!r.ok) { setFailed(true); return; }
    const bytes = Uint8Array.from(atob(r.data.data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: a.mimeType }));
    const link = document.createElement('a');
    link.href = url; link.download = a.filename; link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button type="button" onClick={() => void download()} title={`Download ${a.filename}`}
      className={cn('flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12px] transition-colors', failed ? 'border-rose-500/40 text-rose-300' : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/25')}>
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
      <span className="max-w-[14rem] truncate">{a.filename}</span>
      <span className="text-zinc-500">{fmtSize(a.size)}</span>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 text-zinc-500" />}
    </button>
  );
}

function MessageCard({ m, expanded, onToggle, onReply, showImages, onShowImages }: {
  m: FullMessage; expanded: boolean; onToggle: () => void;
  onReply: (mode: 'reply' | 'replyAll' | 'forward', m: FullMessage) => void;
  showImages: boolean; onShowImages: () => void;
}) {
  const hasRemoteImages = /<img\b/i.test(m.html || '');
  return (
    <article className={cn('rounded-2xl border transition-colors', expanded ? 'border-white/10 bg-[#111]' : 'border-white/5 bg-white/[0.02] hover:border-white/15')}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-400/15 text-[13px] font-semibold text-teal-200">
          {senderName(m.from).slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('truncate text-[13px]', m.unread ? 'font-semibold text-zinc-50' : 'font-medium text-zinc-200')}>{senderName(m.from)}</span>
            <span className="ml-auto shrink-0 text-[11px] text-zinc-500">{fmtFullDate(m.internalDate, m.date)}</span>
          </span>
          {expanded
            ? <span className="block truncate text-[11px] text-zinc-500">to {m.to}{m.cc ? `, cc ${m.cc}` : ''}</span>
            : <span className="block truncate text-[12px] text-zinc-500">{m.snippet}</span>}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 pl-[3.75rem]">
          {m.html && hasRemoteImages && !showImages && (
            <button type="button" onClick={onShowImages} className="mb-2 flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1 text-[11px] text-zinc-400 transition-colors hover:text-zinc-100">
              <ShieldAlert className="h-3 w-3" /> Images are hidden to block tracking. Show images
            </button>
          )}
          {m.html ? <HtmlBody html={m.html} showImages={showImages} /> : <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-zinc-200">{m.text || m.snippet}</pre>}
          {m.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {m.attachments.map((a) => <AttachmentChip key={a.attachmentId} messageId={m.id} a={a} />)}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {([['reply', Reply, 'Reply'], ['replyAll', ReplyAll, 'Reply all'], ['forward', Forward, 'Forward']] as const).map(([mode, Icon, label]) => (
              <button key={mode} type="button" onClick={() => onReply(mode, m)} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3.5 py-1.5 text-[12px] text-zinc-300 transition-colors hover:border-white/25 hover:text-zinc-50">
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

export function ThreadView({ threadId, folder, labels, onBack, onAction, onReply, onLabel, reloadKey }: {
  threadId: string;
  folder: string;
  labels: GmailLabel[];
  onBack: () => void;
  onAction: (a: ThreadAction) => void;
  onReply: (mode: 'reply' | 'replyAll' | 'forward', m: FullMessage) => void;
  onLabel: (labelId: string, on: boolean) => void;
  reloadKey: number;
}) {
  const [messages, setMessages] = useState<FullMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showImages, setShowImages] = useState(false);
  const [labelMenu, setLabelMenu] = useState(false);

  const load = useCallback(async () => {
    const r = await gmail.thread(threadId);
    if (!r.ok) { setError(r.error); return; }
    const msgs = r.data.thread.messages;
    setError(null);
    setMessages(msgs);
    setOpen(new Set(msgs.filter((m, i) => m.unread || i === msgs.length - 1).map((m) => m.id)));
  }, [threadId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => { if (!cancelled) { setMessages(null); setShowImages(false); return load(); } });
    return () => { cancelled = true; };
  }, [load, reloadKey]);

  if (error) return <p role="alert" className="p-6 text-sm text-rose-300">Could not open this conversation ({error.replace(/_/g, ' ')}).</p>;
  if (!messages) return <div role="status" aria-busy="true" className="flex items-center gap-2 p-6 text-sm text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Opening conversation…</div>;

  const labelIds = new Set(messages.flatMap((m) => m.labelIds));
  const starred = labelIds.has('STARRED');
  const inTrash = folder === 'TRASH' || labelIds.has('TRASH');
  const inSpam = folder === 'SPAM' || labelIds.has('SPAM');
  const userLabels = labels.filter((l) => l.type === 'user');
  const tool = 'rounded-full p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100';

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-white/5 px-3 py-2">
        <button type="button" aria-label="Back to list (u)" onClick={onBack} className={tool}><ArrowLeft className="h-4 w-4" /></button>
        {inTrash ? (
          <button type="button" aria-label="Restore from Trash" onClick={() => onAction('untrash')} className={tool}><Undo2 className="h-4 w-4" /></button>
        ) : (
          <>
            {labelIds.has('INBOX')
              ? <button type="button" aria-label="Archive (e)" onClick={() => onAction('archive')} className={tool}><Archive className="h-4 w-4" /></button>
              : <button type="button" aria-label="Move to Inbox" onClick={() => onAction('inbox')} className={tool}><Inbox className="h-4 w-4" /></button>}
            <button type="button" aria-label={inSpam ? 'Not spam' : 'Report spam'} onClick={() => onAction(inSpam ? 'not-spam' : 'spam')} className={tool}><ShieldAlert className="h-4 w-4" /></button>
            <button type="button" aria-label="Delete (#)" onClick={() => onAction('trash')} className={tool}><Trash2 className="h-4 w-4" /></button>
          </>
        )}
        <button type="button" aria-label="Mark unread" onClick={() => onAction('unread')} className={tool}><MailOpen className="h-4 w-4" /></button>
        <div className="relative">
          <button type="button" aria-label="Labels" aria-expanded={labelMenu} onClick={() => setLabelMenu((v) => !v)} className={tool}><Tag className="h-4 w-4" /></button>
          {labelMenu && (
            <div role="menu" className="absolute left-0 top-10 z-20 w-56 rounded-xl border border-white/10 bg-[#18181b] p-1.5 shadow-xl">
              {userLabels.length === 0 && <p className="px-2 py-1.5 text-[12px] text-zinc-500">No labels yet. Create one in the sidebar.</p>}
              {userLabels.map((l) => {
                const on = labelIds.has(l.id);
                return (
                  <button key={l.id} role="menuitemcheckbox" aria-checked={on} type="button" onClick={() => { onLabel(l.id, !on); setLabelMenu(false); }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-zinc-300 hover:bg-white/5">
                    <span className={cn('h-3 w-3 rounded border', on ? 'border-teal-400 bg-teal-400' : 'border-zinc-600')} /> {l.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button type="button" aria-label={starred ? 'Unstar (s)' : 'Star (s)'} onClick={() => onAction(starred ? 'unstar' : 'star')} className={cn(tool, 'ml-auto')}>
          <Star className={cn('h-4 w-4', starred && 'fill-amber-400 text-amber-400')} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        <h2 className="mb-3 font-vault text-2xl leading-snug text-zinc-100">{messages[0]?.subject}</h2>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {[...labelIds].filter((id) => labels.some((l) => l.id === id && l.type === 'user')).map((id) => (
            <span key={id} className="rounded-full bg-teal-400/10 px-2 py-0.5 text-[11px] text-teal-200">{labels.find((l) => l.id === id)?.name}</span>
          ))}
        </div>
        {messages.map((m) => (
          <MessageCard key={m.id} m={m} expanded={open.has(m.id)}
            onToggle={() => setOpen((cur) => { const n = new Set(cur); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n; })}
            onReply={onReply} showImages={showImages} onShowImages={() => setShowImages(true)} />
        ))}
      </div>
    </div>
  );
}
