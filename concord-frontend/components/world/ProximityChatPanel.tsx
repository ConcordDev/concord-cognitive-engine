'use client';

/**
 * ProximityChatPanel — V1.2 Wave A.
 *
 * Minimal-but-real UI for server/lib/proximity-chat.js's ephemeral,
 * spatially-scoped chat channel: a message reaches every OTHER player
 * within a radius of YOUR live server-tracked position at the moment you
 * send it — nothing persisted, nothing retrievable after the fact (see
 * that module's header comment for the full honesty rationale on why this
 * is deliberately NOT backed by a database table).
 *
 * DET-C batch 11: 'proximity:chat' / 'proximity:chat:ack' /
 * 'proximity:chat:nack' previously had zero frontend consumer anywhere —
 * the whole feature had no UI at all, not just a missing listener. This
 * panel closes that gap for real: type a message, it goes out over
 * 'proximity:chat:send'; the server's ack/nack confirms delivery count or
 * a rejection reason; incoming messages from nearby players (including
 * the sender's own echo) render in a small scrolling feed.
 *
 * Bottom-left corner trigger — mirrors PartyPanel's bottom-right shape so
 * the two don't collide.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, AlertCircle } from 'lucide-react';
import { subscribe, emit } from '@/lib/realtime/socket';

interface ProximityMessage {
  id: string;
  senderId: string;
  senderName?: string | null;
  body: string;
  radiusM: number;
  ts: string;
}

const MAX_FEED = 40;

export function ProximityChatPanel() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ProximityMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());
  const feedEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offMsg = subscribe<ProximityMessage>('proximity:chat', (msg) => {
      if (!msg?.id || seenIds.current.has(msg.id)) return;
      seenIds.current.add(msg.id);
      if (seenIds.current.size > 500) {
        const arr = Array.from(seenIds.current);
        seenIds.current = new Set(arr.slice(-300));
      }
      setMessages((prev) => [...prev, msg].slice(-MAX_FEED));
    });
    const offAck = subscribe<{ id?: string; recipientCount?: number }>('proximity:chat:ack', () => {
      setError(null);
    });
    const offNack = subscribe<{ reason?: string }>('proximity:chat:nack', (data) => {
      setError((data?.reason || 'send_failed').replace(/_/g, ' '));
    });
    return () => {
      offMsg();
      offAck();
      offNack();
    };
  }, []);

  useEffect(() => {
    if (open) feedEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [messages, open]);

  const handleSend = useCallback(() => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    emit('proximity:chat:send', { body });
    setDraft('');
    // No round-trip await — the ack/nack subscription above resolves the
    // in-flight state; a brief optimistic re-enable keeps the input from
    // feeling stuck if the ack/nack never lands (e.g. socket hiccup).
    window.setTimeout(() => setSending(false), 1500);
  }, [draft]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Nearby chat${messages.length > 0 ? ` (${messages.length} messages)` : ''}`}
        className={`fixed bottom-2 left-32 z-30 flex items-center gap-2 rounded-full border border-cyan-500/40 bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-cyan-200 shadow-lg backdrop-blur transition hover:bg-slate-900/80 ${open ? 'ring-2 ring-cyan-400/40' : ''}`}
      >
        <MessageCircle className="h-3.5 w-3.5" />
        <span>Nearby</span>
      </button>

      {open && (
        <div
          role="dialog"
          className="fixed bottom-12 left-32 z-30 flex max-h-[60vh] w-[320px] flex-col rounded-xl border border-slate-700 bg-slate-950/95 shadow-2xl backdrop-blur"
        >
          <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
              <MessageCircle className="h-4 w-4" /> Nearby Chat
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-800">
              <X className="h-3.5 w-3.5" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-3 py-2 text-[12px]">
            {messages.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-slate-500">
                Ephemeral — only players within earshot at send time see a
                message, and nothing is saved. Say something.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {messages.map((m) => (
                  <li key={m.id} className="rounded-md bg-slate-900/40 px-2 py-1.5">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate font-mono text-[10px] text-cyan-300/80">
                        {m.senderName || m.senderId.slice(0, 10)}
                      </span>
                      <span className="text-[9px] text-slate-500">
                        {new Date(m.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-slate-200">{m.body}</div>
                  </li>
                ))}
              </ul>
            )}
            <div ref={feedEndRef} />
          </div>

          {error && (
            <div className="mx-3 mb-1 flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-200">
              <AlertCircle className="h-3 w-3" />
              {error}
            </div>
          )}

          <div className="flex items-center gap-1.5 border-t border-slate-800 p-2">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !sending) handleSend();
              }}
              maxLength={280}
              placeholder="Say something nearby…"
              className="flex-1 rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-[11px] text-slate-100 focus:border-cyan-500/50 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !draft.trim()}
              aria-label="Send"
              className="rounded-md border border-cyan-500/40 bg-cyan-500/20 p-1.5 text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default ProximityChatPanel;
