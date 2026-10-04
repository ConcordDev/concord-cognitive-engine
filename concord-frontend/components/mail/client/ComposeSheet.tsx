'use client';

/**
 * ComposeSheet — Gmail-style floating composer: To / Cc / Bcc, subject, body,
 * file attachments, draft save and discard. Replies arrive pre-threaded
 * (threadId + In-Reply-To + References); forwards can carry the original
 * attachments, fetched from Gmail. Sending is handed to the parent so it can
 * offer Undo before the message actually goes out.
 */

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Loader2, Maximize2, Minimize2, Paperclip, Send, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtSize, gmail, type MailAttachment, type Outgoing } from './gmail';

export const MAX_ATTACH_BYTES = 7 * 1024 * 1024;

export interface ComposeInit {
  key: string;
  mode: 'new' | 'reply' | 'replyAll' | 'forward' | 'draft';
  draft: Outgoing;
  forwardFrom?: { messageId: string; attachments: MailAttachment[] };
}

const field = 'w-full bg-transparent px-0 py-1.5 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none';

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function ComposeSheet({ init, offset = 0, onClose, onSend, onDraftSaved }: {
  init: ComposeInit;
  offset?: number;
  onClose: () => void;
  onSend: (m: Outgoing) => void;
  onDraftSaved: (msg: string) => void;
}) {
  const [m, setM] = useState<Outgoing>(init.draft);
  const [showCc, setShowCc] = useState(!!(init.draft.cc || init.draft.bcc));
  const [minimized, setMinimized] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'attach' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (init.mode === 'reply' || init.mode === 'replyAll') {
      const el = bodyRef.current;
      if (el) { el.focus(); el.setSelectionRange(0, 0); }
    }
  }, [init.mode]);

  useEffect(() => {
    const fwd = init.forwardFrom;
    if (!fwd || fwd.attachments.length === 0) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setBusy('attach');
      const got = await Promise.all(fwd.attachments.map(async (a) => {
        const r = await gmail.attachment(fwd.messageId, a.attachmentId);
        return r.ok ? { filename: a.filename, mimeType: a.mimeType, data: r.data.data, size: a.size } : null;
      }));
      if (cancelled) return;
      const ok = got.filter(Boolean) as Outgoing['attachments'];
      setM((cur) => ({ ...cur, attachments: [...cur.attachments, ...ok] }));
      if (ok.length < fwd.attachments.length) setError('Some original attachments could not be downloaded and were left out.');
      setBusy(null);
    });
    return () => { cancelled = true; };
  }, [init.forwardFrom]);

  const set = (patch: Partial<Outgoing>) => { setM((cur) => ({ ...cur, ...patch })); setDirty(true); };
  const totalBytes = m.attachments.reduce((s, a) => s + a.size, 0);

  const addFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (fileRef.current) fileRef.current.value = '';
    if (!files.length) return;
    const incoming = files.reduce((s, f) => s + f.size, 0);
    if (totalBytes + incoming > MAX_ATTACH_BYTES) { setError(`Attachments are limited to ${fmtSize(MAX_ATTACH_BYTES)} per message.`); return; }
    setBusy('attach'); setError(null);
    try {
      const added = await Promise.all(files.map(async (f) => ({ filename: f.name, mimeType: f.type || 'application/octet-stream', data: await readFile(f), size: f.size })));
      set({ attachments: [...m.attachments, ...added] });
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(null); }
  };

  const saveDraft = async (thenClose: boolean) => {
    setBusy('draft'); setError(null);
    const r = await gmail.saveDraft(m);
    setBusy(null);
    if (!r.ok) { setError(`Draft not saved: ${r.error.replace(/_/g, ' ')}`); return false; }
    setM((cur) => ({ ...cur, draftId: r.data.draft.id }));
    setDirty(false);
    onDraftSaved('Saved to Drafts');
    if (thenClose) onClose();
    return true;
  };

  const close = async () => {
    const hasContent = m.to.trim() || m.subject.trim() || m.body.trim() || m.attachments.length;
    if (dirty && hasContent) { await saveDraft(true); return; }
    onClose();
  };

  const discard = async () => {
    if (m.draftId) await gmail.deleteDraft(m.draftId);
    onClose();
  };

  const send = () => {
    if (!m.to.trim()) { setError('Add at least one recipient.'); return; }
    if (busy === 'attach') { setError('Wait for attachments to finish loading.'); return; }
    onSend(m);
  };

  const title = init.mode === 'forward' ? 'Forward' : init.mode === 'reply' || init.mode === 'replyAll' ? 'Reply' : init.mode === 'draft' ? 'Draft' : 'New message';

  return (
    <div role="dialog" aria-label={title} style={offset ? { marginRight: `${offset * 36}rem` } : undefined}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); send(); }
        if (e.key === 'Escape') { e.preventDefault(); void close(); }
      }}
      className={cn('fixed bottom-0 right-4 z-40 flex w-[min(560px,calc(100vw-2rem))] flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-[#141416] shadow-[0_-12px_48px_rgba(0,0,0,0.5)] transition-[height] sm:right-8',
        minimized ? 'h-11' : 'h-[min(560px,calc(100vh-6rem))]')}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-white/5 bg-white/[0.03] px-4">
        <button type="button" onClick={() => setMinimized((v) => !v)} className="flex-1 truncate text-left text-[13px] font-medium text-zinc-200">
          {m.subject.trim() || title}
        </button>
        <button type="button" aria-label={minimized ? 'Expand' : 'Minimize'} onClick={() => setMinimized((v) => !v)} className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200">
          {minimized ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
        </button>
        <button type="button" aria-label="Close and save draft" onClick={() => void close()} className="rounded p-1 text-zinc-500 transition-colors hover:text-zinc-200"><X className="h-4 w-4" /></button>
      </header>
      {!minimized && (
        <>
          <div className="flex flex-col divide-y divide-white/5 px-4">
            <div className="flex items-center gap-2">
              <span className="w-8 text-[12px] text-zinc-500">To</span>
              <input aria-label="To" value={m.to} onChange={(e) => set({ to: e.target.value })} className={field} placeholder="name@example.com, …" autoFocus={init.mode === 'new' || init.mode === 'forward'} />
              {!showCc && <button type="button" onClick={() => setShowCc(true)} className="text-[12px] text-zinc-500 hover:text-zinc-200">Cc Bcc</button>}
            </div>
            {showCc && (
              <>
                <div className="flex items-center gap-2"><span className="w-8 text-[12px] text-zinc-500">Cc</span><input aria-label="Cc" value={m.cc} onChange={(e) => set({ cc: e.target.value })} className={field} /></div>
                <div className="flex items-center gap-2"><span className="w-8 text-[12px] text-zinc-500">Bcc</span><input aria-label="Bcc" value={m.bcc} onChange={(e) => set({ bcc: e.target.value })} className={field} /></div>
              </>
            )}
            <input aria-label="Subject" placeholder="Subject" value={m.subject} onChange={(e) => set({ subject: e.target.value })} className={field} />
          </div>
          <textarea ref={bodyRef} aria-label="Message body" value={m.body} onChange={(e) => set({ body: e.target.value })}
            className="min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-[13px] leading-relaxed text-zinc-100 focus:outline-none" />
          {m.attachments.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 px-4 pb-2">
              {m.attachments.map((a, i) => (
                <li key={`${a.filename}-${i}`} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-zinc-300">
                  <Paperclip className="h-3 w-3" /> <span className="max-w-[12rem] truncate">{a.filename}</span> <span className="text-zinc-500">{fmtSize(a.size)}</span>
                  <button type="button" aria-label={`Remove ${a.filename}`} onClick={() => set({ attachments: m.attachments.filter((_, j) => j !== i) })} className="text-zinc-500 hover:text-rose-300"><X className="h-3 w-3" /></button>
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="px-4 pb-2 text-[12px] text-rose-300">{error}</p>}
          <footer className="flex shrink-0 items-center gap-2 border-t border-white/5 px-3 py-2.5">
            <button type="button" onClick={send} className="inline-flex items-center gap-1.5 rounded-full bg-teal-400 px-4 py-1.5 text-[13px] font-medium text-black transition-colors hover:bg-teal-300">
              <Send className="h-3.5 w-3.5" /> Send
            </button>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void addFiles(e)} />
            <button type="button" aria-label="Attach files" onClick={() => fileRef.current?.click()} className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100">
              {busy === 'attach' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </button>
            <span className="text-[11px] text-zinc-500">{m.attachments.length ? `${fmtSize(totalBytes)} of ${fmtSize(MAX_ATTACH_BYTES)}` : '⌘↵ to send'}</span>
            <button type="button" onClick={() => void saveDraft(false)} disabled={busy === 'draft'} className="ml-auto rounded-full px-3 py-1.5 text-[12px] text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 disabled:opacity-50">
              {busy === 'draft' ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" aria-label="Discard draft" onClick={() => void discard()} className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-white/5 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>
          </footer>
        </>
      )}
    </div>
  );
}
