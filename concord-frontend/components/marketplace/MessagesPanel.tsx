'use client';

/**
 * MessagesPanel — buyer↔seller conversation threads.
 *
 * A two-pane inbox: thread list on the left, an open conversation on
 * the right. Threads can be bound to an order. The seller sends from
 * the composer; buyer-side messages are simulated for QA via a "from"
 * toggle. All data flows through the marketplace `messages-threads` /
 * `messages-thread-open` / `messages-send` macros.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Loader2, Send, Plus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ThreadSummary {
  id: string;
  number: string;
  orderId: string;
  subject: string;
  buyerName: string;
  messageCount: number;
  unread: boolean;
  lastMessageAt: string;
}

interface Message {
  id: string;
  from: 'buyer' | 'seller';
  text: string;
  at: string;
  read: boolean;
}

interface Thread extends ThreadSummary {
  messages: Message[];
}

interface OrderOption {
  id: string;
  number: string;
  buyerName: string;
}

export function MessagesPanel() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [active, setActive] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [from, setFrom] = useState<'buyer' | 'seller'>('seller');
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [newThread, setNewThread] = useState({ subject: '', orderId: '', buyerName: '' });
  const [showNew, setShowNew] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('marketplace', 'messages-threads', {});
      if (r.data?.ok) setThreads((r.data.result?.threads || []) as ThreadSummary[]);
    } catch (e) {
      console.error('[Messages] threads failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    lensRun('marketplace', 'orders-list', { status: 'all' })
      .then((r) => {
        if (r.data?.ok) {
          setOrders(
            ((r.data.result?.orders || []) as Array<{ id: string; number: string; buyerName: string }>).map(
              (o) => ({ id: o.id, number: o.number, buyerName: o.buyerName }),
            ),
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [active]);

  async function openThread(id: string, orderId?: string) {
    try {
      const input: Record<string, unknown> = {};
      if (id) input.id = id;
      if (orderId) input.orderId = orderId;
      const r = await lensRun('marketplace', 'messages-thread-open', input);
      if (r.data?.ok) {
        setActive((r.data.result?.thread as Thread) || null);
        await refresh();
      }
    } catch (e) {
      console.error('[Messages] open failed', e);
    }
  }

  async function createThread() {
    try {
      const input: Record<string, unknown> = { subject: newThread.subject.trim() };
      if (newThread.orderId) input.orderId = newThread.orderId;
      if (newThread.buyerName.trim()) input.buyerName = newThread.buyerName.trim();
      const r = await lensRun('marketplace', 'messages-thread-open', input);
      if (r.data?.ok) {
        setActive((r.data.result?.thread as Thread) || null);
        setShowNew(false);
        setNewThread({ subject: '', orderId: '', buyerName: '' });
        await refresh();
      }
    } catch (e) {
      console.error('[Messages] create failed', e);
    }
  }

  async function send() {
    if (!active || !draft.trim()) return;
    setSending(true);
    try {
      const r = await lensRun('marketplace', 'messages-send', {
        id: active.id,
        text: draft.trim(),
        from,
      });
      if (r.data?.ok) {
        setActive((r.data.result?.thread as Thread) || null);
        setDraft('');
        await refresh();
      }
    } catch (e) {
      console.error('[Messages] send failed', e);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-[#0d1117] border border-orange-500/15 rounded-lg overflow-hidden flex h-[34rem]">
      {/* Thread list */}
      <div className="w-56 border-r border-white/10 flex flex-col flex-shrink-0">
        <header className="px-3 py-2.5 border-b border-white/10 flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-semibold text-gray-200">Messages</span>
          <button
            onClick={() => setShowNew((v) => !v)}
            className="ml-auto p-1 rounded bg-orange-500/15 text-orange-300 border border-orange-500/30 hover:bg-orange-500/25"
            aria-label="New conversation"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </header>
        {showNew && (
          <div className="p-2 border-b border-white/10 space-y-1.5">
            <input
              value={newThread.subject}
              onChange={(e) => setNewThread({ ...newThread, subject: e.target.value })}
              placeholder="Subject"
              className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            />
            <select
              value={newThread.orderId}
              onChange={(e) => setNewThread({ ...newThread, orderId: e.target.value })}
              className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            >
              <option value="">No order</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.number} — {o.buyerName}
                </option>
              ))}
            </select>
            <input
              value={newThread.buyerName}
              onChange={(e) => setNewThread({ ...newThread, buyerName: e.target.value })}
              placeholder="Buyer name"
              className="w-full px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            />
            <button
              onClick={createThread}
              className="w-full px-2 py-1 text-xs rounded bg-orange-500 text-black font-bold hover:bg-orange-400"
            >
              Start
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : threads.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-gray-400">No conversations.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {threads.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => openThread(t.id)}
                    className={cn(
                      'w-full text-left px-3 py-2 hover:bg-white/[0.03]',
                      active?.id === t.id && 'bg-orange-500/10',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-white truncate flex-1">{t.subject}</span>
                      {t.unread && <span className="w-2 h-2 rounded-full bg-orange-400" />}
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      {t.buyerName} · {t.messageCount} msg
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Conversation */}
      <div className="flex-1 flex flex-col">
        {active ? (
          <>
            <header className="px-4 py-2.5 border-b border-white/10">
              <div className="text-sm font-semibold text-gray-200">{active.subject}</div>
              <div className="text-[10px] text-gray-400">
                {active.number} · {active.buyerName}
              </div>
            </header>
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2">
              {active.messages.length === 0 ? (
                <div className="text-center text-xs text-gray-400 py-8">
                  No messages yet — say hello.
                </div>
              ) : (
                active.messages.map((m) => (
                  <div
                    key={m.id}
                    className={cn('flex', m.from === 'seller' ? 'justify-end' : 'justify-start')}
                  >
                    <div
                      className={cn(
                        'max-w-[75%] rounded-lg px-3 py-1.5 text-xs',
                        m.from === 'seller'
                          ? 'bg-orange-500/20 text-orange-100 border border-orange-500/30'
                          : 'bg-white/5 text-gray-200 border border-white/10',
                      )}
                    >
                      <div>{m.text}</div>
                      <div className="text-[9px] text-gray-400 mt-0.5">
                        {m.from} · {new Date(m.at).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="p-3 border-t border-white/10 flex items-center gap-2">
              <select
                value={from}
                onChange={(e) => setFrom(e.target.value as 'buyer' | 'seller')}
                className="text-[10px] px-1.5 py-1.5 bg-lattice-deep border border-lattice-border rounded text-white"
              >
                <option value="seller">As seller</option>
                <option value="buyer">As buyer</option>
              </select>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send();
                }}
                placeholder="Type a message…"
                className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              />
              <button
                onClick={send}
                disabled={sending || !draft.trim()}
                className="p-1.5 rounded bg-orange-500 text-black hover:bg-orange-400 disabled:opacity-40"
                aria-label="Send message"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-gray-400">
            <div className="text-center">
              <MessageSquare className="w-7 h-7 mx-auto mb-2 opacity-30" />
              Select a conversation or start a new one.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MessagesPanel;
