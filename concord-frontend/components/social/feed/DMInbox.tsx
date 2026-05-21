'use client';

/**
 * DMInbox — full direct-message inbox + conversation view.
 *
 * Backlog item 3: calls social.inbox / social.conversation / social.sendMessage.
 * Two-pane master/detail layout. No fake data — empty states everywhere.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail, Loader2, Send, ArrowLeft, MessageCirclePlus } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import type { DMThreadSummary, DMMessage } from './types';

function relTime(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return 'now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface DMInboxProps {
  currentUserId: string;
}

export function DMInbox({ currentUserId }: DMInboxProps) {
  const [threads, setThreads] = useState<DMThreadSummary[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [activeWith, setActiveWith] = useState<string | null>(null);
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [newRecipient, setNewRecipient] = useState('');
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadInbox = useCallback(async () => {
    setLoadingInbox(true);
    const r = await lensRun<{ threads: DMThreadSummary[] }>('social', 'inbox', {});
    setLoadingInbox(false);
    if (r.data?.ok && r.data.result) setThreads(r.data.result.threads || []);
  }, []);

  const openThread = useCallback(async (key: string | null, withUser: string) => {
    setActiveKey(key);
    setActiveWith(withUser);
    setComposing(false);
    setLoadingThread(true);
    const r = await lensRun<{ messages: DMMessage[]; threadKey: string; with: string }>(
      'social', 'conversation', key ? { threadKey: key } : { with: withUser },
    );
    setLoadingThread(false);
    if (r.data?.ok && r.data.result) {
      setMessages(r.data.result.messages || []);
      if (r.data.result.threadKey) setActiveKey(r.data.result.threadKey);
    }
  }, []);

  const send = useCallback(async () => {
    const trimmed = draft.trim();
    const to = activeWith;
    if (!trimmed || !to) return;
    setSending(true);
    setError(null);
    const r = await lensRun<{ message: DMMessage; threadKey: string }>('social', 'sendMessage', {
      to, body: trimmed,
    });
    setSending(false);
    if (r.data?.ok && r.data.result) {
      setDraft('');
      setMessages((m) => [...m, r.data!.result!.message]);
      setActiveKey(r.data.result.threadKey);
      void loadInbox();
    } else {
      setError(r.data?.error || 'Failed to send message.');
    }
  }, [draft, activeWith, loadInbox]);

  useEffect(() => { void loadInbox(); }, [loadInbox]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-[260px_1fr] h-[28rem]">
        {/* thread list */}
        <div className={cn('border-r border-zinc-800 overflow-y-auto', (activeWith || composing) && 'hidden sm:block')}>
          <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <Mail className="w-4 h-4 text-indigo-300" />
            <span className="text-sm font-medium text-zinc-200">Messages</span>
            <button
              type="button"
              onClick={() => { setComposing(true); setActiveWith(null); setActiveKey(null); setMessages([]); }}
              className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-900 hover:text-indigo-300"
              aria-label="New message"
            >
              <MessageCirclePlus className="w-4 h-4" />
            </button>
          </div>
          {loadingInbox ? (
            <div className="flex items-center gap-2 p-4 text-xs text-zinc-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading inbox…
            </div>
          ) : threads.length === 0 ? (
            <p className="p-4 text-xs text-zinc-600 italic">No conversations yet. Start one with the + button.</p>
          ) : (
            <ul>
              {threads.map((t) => (
                <li key={t.threadKey}>
                  <button
                    type="button"
                    onClick={() => void openThread(t.threadKey, t.with)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 border-b border-zinc-900 px-3 py-2 text-left hover:bg-zinc-900/60',
                      activeKey === t.threadKey && 'bg-zinc-900/80',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-200">@{t.with}</span>
                      {t.unread > 0 && (
                        <span className="rounded-full bg-indigo-500 px-1.5 text-[10px] font-bold text-white">{t.unread}</span>
                      )}
                      <span className="ml-auto text-[10px] text-zinc-600">
                        {t.lastMessage ? relTime(t.lastMessage.createdAt) : ''}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-zinc-500">
                      {t.lastMessage?.body || 'No messages'}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* conversation pane */}
        <div className={cn('flex flex-col', !activeWith && !composing && 'hidden sm:flex')}>
          {!activeWith && !composing ? (
            <div className="flex flex-1 items-center justify-center text-xs text-zinc-600">
              Select a conversation.
            </div>
          ) : composing && !activeWith ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4">
              <p className="text-xs text-zinc-400">Start a new conversation</p>
              <input
                value={newRecipient}
                onChange={(e) => setNewRecipient(e.target.value)}
                placeholder="Recipient user ID"
                className="w-56 rounded bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none"
              />
              <button
                type="button"
                onClick={() => { if (newRecipient.trim()) void openThread(null, newRecipient.trim()); }}
                className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
              >
                Open conversation
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                <button
                  type="button"
                  onClick={() => { setActiveWith(null); setActiveKey(null); }}
                  className="rounded p-0.5 text-zinc-400 hover:text-zinc-200 sm:hidden"
                  aria-label="Back to inbox"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-medium text-zinc-200">@{activeWith}</span>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {loadingThread ? (
                  <div className="flex items-center gap-2 text-xs text-zinc-500">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
                  </div>
                ) : messages.length === 0 ? (
                  <p className="text-xs text-zinc-600 italic">No messages yet — say hello.</p>
                ) : (
                  messages.map((m) => {
                    const mine = m.from === currentUserId;
                    return (
                      <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                        <div className={cn(
                          'max-w-[75%] rounded-lg px-2.5 py-1.5 text-xs',
                          mine ? 'bg-indigo-600 text-white' : 'bg-zinc-800 text-zinc-200',
                        )}>
                          <p className="whitespace-pre-wrap">{m.body}</p>
                          <p className={cn('mt-0.5 text-[9px]', mine ? 'text-indigo-200' : 'text-zinc-500')}>
                            {relTime(m.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={endRef} />
              </div>
              {error && <p className="px-3 pb-1 text-[11px] text-rose-400">{error}</p>}
              <div className="flex items-center gap-1.5 border-t border-zinc-800 p-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 2000))}
                  placeholder="Message…"
                  className="flex-1 rounded bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder-zinc-600 outline-none"
                  onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
                />
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={sending}
                  className="rounded bg-indigo-600 p-1.5 text-white hover:bg-indigo-500 disabled:opacity-50"
                  aria-label="Send message"
                >
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
