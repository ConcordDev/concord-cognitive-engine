'use client';

/**
 * MentorshipMessagesPanel — direct messaging between mentor and mentee.
 * Inbox of threads + a conversation view. All data from `mentorship` macros:
 * message-inbox, message-thread, message-send.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2, MessageSquare, Send, ChevronLeft, Plus, X,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface ThreadSummary {
  partnerId: string;
  threadKey: string;
  lastMessage: string;
  lastFrom: string;
  lastAt: string;
  messageCount: number;
}
interface Message {
  id: string;
  fromId: string;
  toId: string;
  fromName: string;
  body: string;
  at: string;
}

export function MentorshipMessagesPanel() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activePartner, setActivePartner] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [fromName, setFromName] = useState('');
  const [busy, setBusy] = useState(false);

  const [showNew, setShowNew] = useState(false);
  const [newPartner, setNewPartner] = useState('');

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const refreshInbox = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('mentorship', 'message-inbox', {});
    if (r.data?.ok === false) { setError(r.data.error || 'Failed to load inbox.'); }
    else { setThreads(r.data?.result?.threads || []); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { void refreshInbox(); }, [refreshInbox]);

  const openThread = useCallback(async (partnerId: string) => {
    setActivePartner(partnerId);
    setMessages([]);
    const r = await lensRun('mentorship', 'message-thread', { partnerId });
    if (r.data?.ok === false) { setError(r.data.error || 'Failed to load thread.'); }
    else { setMessages(r.data?.result?.messages || []); setError(null); }
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const send = async () => {
    if (!activePartner || !draft.trim()) return;
    setBusy(true);
    const r = await lensRun('mentorship', 'message-send', {
      toId: activePartner, body: draft, fromName: fromName || 'User',
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data.error || 'Send failed.'); return; }
    setDraft('');
    await openThread(activePartner);
    void refreshInbox();
  };

  if (activePartner) {
    return (
      <div className="space-y-3">
        <button onClick={() => { setActivePartner(null); void refreshInbox(); }} className="flex items-center gap-1 text-sm text-zinc-400 hover:text-white">
          <ChevronLeft className="w-4 h-4" /> Back to inbox
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
        <div className="panel p-4">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-neon-blue" /> Conversation
          </h4>
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <p className="text-xs text-zinc-500 text-center py-4">No messages yet. Say hello.</p>
            ) : messages.map((m) => (
              <div key={m.id} className="lens-card text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-xs text-neon-cyan">{m.fromName}</span>
                  <span className="text-[10px] text-zinc-500">{new Date(m.at).toLocaleString()}</span>
                </div>
                <p className="text-zinc-200">{m.body}</p>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>
        <div className="panel p-3 space-y-2">
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Your display name" className="input-lattice w-full" />
          <div className="flex gap-2">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} placeholder="Type a message..." className="input-lattice flex-1" />
            <button onClick={send} disabled={busy || !draft.trim()} className="btn-neon" aria-label="Send message">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><MessageSquare className="w-4 h-4 text-neon-blue" /> Messages</h3>
        <button onClick={() => setShowNew(!showNew)} className="btn-neon text-sm">
          {showNew ? <X className="w-4 h-4 inline" /> : <Plus className="w-4 h-4 inline" />} {showNew ? 'Cancel' : 'New thread'}
        </button>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {showNew && (
        <div className="panel p-3 space-y-2">
          <input value={newPartner} onChange={(e) => setNewPartner(e.target.value)} placeholder="Partner user ID" className="input-lattice w-full" />
          <button onClick={() => { if (newPartner.trim()) { setShowNew(false); void openThread(newPartner.trim()); } }} className="btn-neon green w-full text-sm">
            Open conversation
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-zinc-500" /></div>
      ) : threads.length === 0 ? (
        <p className="text-sm text-zinc-500 text-center py-8">No conversations yet. Start a new thread with a mentor or mentee.</p>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <button key={t.threadKey} onClick={() => openThread(t.partnerId)} className="lens-card text-left w-full hover:border-neon-blue transition-colors">
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{t.partnerId}</span>
                <span className="text-[10px] text-zinc-500">{new Date(t.lastAt).toLocaleDateString()}</span>
              </div>
              <p className="text-xs text-zinc-400 truncate">
                <span className="text-zinc-500">{t.lastFrom}:</span> {t.lastMessage}
              </p>
              <p className="text-[10px] text-zinc-500">{t.messageCount} message(s)</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
