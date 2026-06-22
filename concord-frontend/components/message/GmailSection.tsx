'use client';

/**
 * GmailSection — a real Gmail client surface for the message lens (Track C).
 *
 * Talks to the live gmail.* macros (list / get / modify / trash / labels /
 * send / connect), which ride the SSRF-guarded connector egress with per-user
 * OAuth tokens. When the user hasn't granted access the macros return the
 * honest `no_token` / `connector_not_configured` reason and we render the
 * Connect-Gmail state instead of faking an inbox.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import {
  Mail, RefreshCw, Star, Archive, Trash2, PenSquare, Search,
  Loader2, X, Send, Inbox, ChevronLeft, AlertCircle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  labelIds: string[];
  unread: boolean;
  starred: boolean;
  from: string;
  to?: string;
  cc?: string;
  subject: string;
  date: string;
  internalDate?: number | null;
  text?: string;
  html?: string;
}
interface GmailLabel { id: string; name: string; type: string }

const NOT_CONNECTED = new Set(['no_token', 'connector_not_configured', 'gmail_disabled']);
const SYSTEM_CHIPS = [
  { id: 'INBOX', label: 'Inbox' },
  { id: 'STARRED', label: 'Starred' },
  { id: 'SENT', label: 'Sent' },
  { id: 'IMPORTANT', label: 'Important' },
];

function senderName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : from).trim() || from;
}
function fmtDate(d: string): string {
  const t = d ? new Date(d) : null;
  if (!t || isNaN(t.getTime())) return '';
  const now = new Date();
  return t.toDateString() === now.toDateString()
    ? t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : t.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function GmailSection() {
  const [collapsed, setCollapsed] = useState(true);
  const [messages, setMessages] = useState<GmailMessage[]>([]);
  const [labels, setLabels] = useState<GmailLabel[]>([]);
  const [activeLabel, setActiveLabel] = useState('INBOX');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GmailMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const loadInbox = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await lensRun('gmail', 'list', { labelIds: [activeLabel], q: query || undefined, maxResults: 25 });
      if (r.data?.ok) {
        setConnected(true);
        setMessages((r.data.result?.messages as GmailMessage[]) ?? []);
      } else {
        const reason = r.data?.error || 'list_failed';
        if (NOT_CONNECTED.has(reason)) { setConnected(false); }
        else { setConnected(true); setError(reason); }
      }
    } catch {
      setError('network_error');
    } finally {
      setLoading(false);
    }
  }, [activeLabel, query]);

  const loadLabels = useCallback(async () => {
    try {
      const r = await lensRun('gmail', 'labels', {});
      if (r.data?.ok) setLabels((r.data.result?.labels as GmailLabel[]) ?? []);
    } catch { /* best-effort */ }
  }, []);

  useEffect(() => {
    if (collapsed) return;
    void loadInbox();
    void loadLabels();
  }, [collapsed, loadInbox, loadLabels]);

  const openMessage = useCallback(async (m: GmailMessage) => {
    setSelected(m);
    try {
      const r = await lensRun('gmail', 'get', { messageId: m.id });
      if (r.data?.ok) setSelected(r.data.result?.message as GmailMessage);
      if (m.unread) {
        void lensRun('gmail', 'modify', { messageId: m.id, action: 'read' });
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, unread: false } : x)));
      }
    } catch { /* keep the list-row copy */ }
  }, []);

  const act = useCallback(async (m: GmailMessage, action: 'star' | 'unstar' | 'archive', e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (action === 'star' || action === 'unstar') {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, starred: action === 'star' } : x)));
      void lensRun('gmail', 'modify', { messageId: m.id, action });
    } else {
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
      if (selected?.id === m.id) setSelected(null);
      void lensRun('gmail', 'modify', { messageId: m.id, action: 'archive' });
    }
  }, [selected]);

  const trash = useCallback(async (m: GmailMessage, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    if (selected?.id === m.id) setSelected(null);
    void lensRun('gmail', 'trash', { messageId: m.id });
  }, [selected]);

  const connect = useCallback(async () => {
    try {
      const r = await lensRun('gmail', 'connect', { redirect: window.location.pathname });
      const url = r.data?.result?.authorizeUrl as string | undefined;
      if (url) window.location.href = url;
    } catch { /* best-effort */ }
  }, []);

  const chips = useMemo(() => {
    const userLabels = labels.filter((l) => l.type === 'user').slice(0, 6).map((l) => ({ id: l.id, label: l.name }));
    return [...SYSTEM_CHIPS, ...userLabels];
  }, [labels]);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-sm text-gray-300"
      >
        <Mail className="w-4 h-4 text-rose-400" />
        <span className="font-medium">Gmail</span>
        <span className="text-xs text-gray-500">— real inbox (connect to load)</span>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-[#0d1117] overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-[#0a0c10]">
        <Mail className="w-4 h-4 text-rose-400" />
        <span className="text-sm font-semibold text-white">Gmail</span>
        {connected && (
          <div className="ml-2 flex-1 flex items-center gap-1 bg-white/5 rounded px-2 py-1">
            <Search className="w-3 h-3 text-gray-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void loadInbox(); }}
              placeholder="Search mail"
              className="flex-1 bg-transparent text-xs text-gray-200 outline-none"
            />
          </div>
        )}
        <button aria-label="Refresh" onClick={() => void loadInbox()} disabled={loading} className="p-1.5 rounded hover:bg-white/10 text-gray-300">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
        {connected && (
          <button onClick={() => setComposing(true)} className="flex items-center gap-1 px-2 py-1 rounded bg-rose-500/20 text-rose-300 text-xs hover:bg-rose-500/30">
            <PenSquare className="w-3.5 h-3.5" /> Compose
          </button>
        )}
        <button aria-label="Collapse Gmail" onClick={() => setCollapsed(true)} className="p-1.5 rounded hover:bg-white/10 text-gray-400">
          <X className="w-3.5 h-3.5" />
        </button>
      </header>

      {/* Not connected */}
      {connected === false && (
        <div className="p-6 text-center space-y-3">
          <Mail className="w-8 h-8 text-rose-400/60 mx-auto" />
          <p className="text-sm text-gray-300">Connect your Gmail to read and send mail here.</p>
          <p className="text-xs text-gray-500">Concord requests read + send access; tokens are encrypted at rest and used only for your inbox.</p>
          <button onClick={() => void connect()} className="px-4 py-2 rounded bg-rose-500/30 text-rose-200 text-sm hover:bg-rose-500/40">
            Connect Gmail
          </button>
        </div>
      )}

      {connected && (
        <>
          {/* Label chips */}
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/10 overflow-x-auto">
            {chips.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveLabel(c.id)}
                className={cn('px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap',
                  activeLabel === c.id ? 'bg-rose-500/30 text-rose-200' : 'bg-white/5 text-gray-400 hover:bg-white/10')}
              >
                {c.label}
              </button>
            ))}
          </div>

          <div className="flex" style={{ height: 380 }}>
            {/* Inbox list */}
            <ul className={cn('overflow-y-auto border-r border-white/10', selected ? 'w-2/5' : 'w-full')}>
              {loading && (
                <li className="flex items-center justify-center py-8 text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /></li>
              )}
              {!loading && error && (
                <li className="flex items-center gap-2 px-4 py-6 text-amber-300 text-xs"><AlertCircle className="w-4 h-4" /> {error}</li>
              )}
              {!loading && !error && messages.length === 0 && (
                <li className="flex flex-col items-center justify-center py-10 text-gray-500 text-xs gap-2"><Inbox className="w-6 h-6" /> No messages</li>
              )}
              {messages.map((m) => (
                <li
                  key={m.id}
                  onClick={() => void openMessage(m)}
                  className={cn('group px-3 py-2 border-b border-white/5 cursor-pointer hover:bg-white/[0.04]',
                    selected?.id === m.id && 'bg-white/[0.06]', m.unread && 'bg-rose-500/[0.04]')}
                >
                  <div className="flex items-center gap-2">
                    <button aria-label={m.starred ? 'Unstar' : 'Star'} onClick={(e) => void act(m, m.starred ? 'unstar' : 'star', e)} className="shrink-0">
                      <Star className={cn('w-3.5 h-3.5', m.starred ? 'fill-amber-400 text-amber-400' : 'text-gray-600 hover:text-gray-400')} />
                    </button>
                    <span className={cn('flex-1 truncate text-xs', m.unread ? 'font-semibold text-white' : 'text-gray-300')}>{senderName(m.from)}</span>
                    <span className="text-[10px] text-gray-500 shrink-0">{fmtDate(m.date)}</span>
                  </div>
                  <div className={cn('truncate text-xs mt-0.5', m.unread ? 'text-gray-100' : 'text-gray-400')}>{m.subject}</div>
                  <div className="truncate text-[11px] text-gray-500 mt-0.5 flex items-center gap-1">
                    <span className="flex-1 truncate">{m.snippet}</span>
                    <span className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                      <button aria-label="Archive" onClick={(e) => void act(m, 'archive', e)} className="p-0.5 hover:text-gray-200"><Archive className="w-3 h-3" /></button>
                      <button aria-label="Delete" onClick={(e) => void trash(m, e)} className="p-0.5 hover:text-rose-300"><Trash2 className="w-3 h-3" /></button>
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            {/* Message detail */}
            {selected && (
              <div className="flex-1 overflow-y-auto p-4">
                <button aria-label="Back" onClick={() => setSelected(null)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 mb-2 lg:hidden">
                  <ChevronLeft className="w-3.5 h-3.5" /> Back
                </button>
                <h2 className="text-base font-semibold text-white">{selected.subject}</h2>
                <div className="mt-1 text-xs text-gray-400">
                  <div><span className="text-gray-500">From:</span> {selected.from}</div>
                  {selected.to && <div><span className="text-gray-500">To:</span> {selected.to}</div>}
                  <div className="text-gray-500">{fmtDate(selected.date)}</div>
                </div>
                <div className="mt-3 border-t border-white/10 pt-3">
                  {selected.html ? (
                    <div
                      className="prose prose-invert prose-sm max-w-none text-sm text-gray-200"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selected.html, { FORBID_TAGS: ['style', 'script'], FORBID_ATTR: ['onerror', 'onload'] }) }}
                    />
                  ) : (
                    <pre className="whitespace-pre-wrap break-words font-sans text-sm text-gray-200">{selected.text || selected.snippet}</pre>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {composing && <ComposeModal onClose={() => setComposing(false)} onSent={() => { setComposing(false); void loadInbox(); }} />}
    </div>
  );
}

function ComposeModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const send = async () => {
    if (!to.trim()) { setErr('Recipient required'); return; }
    setSending(true); setErr(null);
    try {
      const r = await lensRun('gmail', 'send', { mail: { to: to.trim(), subject, body } });
      if (r.data?.ok) onSent();
      else setErr(r.data?.error || 'send_failed');
    } catch {
      setErr('network_error');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg rounded-t-lg sm:rounded-lg border border-white/10 bg-[#0d1117] p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">New message</h3>
          <button aria-label="Close" onClick={onClose} className="p-1 rounded hover:bg-white/10 text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200" />
        <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" rows={8} className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 resize-none" />
        {err && <p className="text-xs text-amber-300">{err}</p>}
        <div className="flex justify-end">
          <button onClick={() => void send()} disabled={sending} className="flex items-center gap-1.5 px-4 py-2 rounded bg-rose-500/30 text-rose-200 text-sm hover:bg-rose-500/40 disabled:opacity-50">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send
          </button>
        </div>
      </div>
    </div>
  );
}
