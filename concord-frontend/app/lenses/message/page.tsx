'use client';

/**
 * /lenses/message — direct messaging lens.
 *
 * Wired to the social DM substrate (/api/social/dm/*). Previously
 * relied on a hardcoded thread fixture, which made the cartographer
 * flag this as an orphan lens (no_backend_evidence_in_page_tsx).
 * Now reads from
 *   GET  /api/social/dm/conversations
 *   GET  /api/social/dm/:conversationId
 *   POST /api/social/dm
 *   POST /api/social/dm/:conversationId/read
 * and persists compose-and-send sessions as 'sent-message' artifacts
 * for cross-lens discovery.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { InboxShell, type InboxThread } from '@/components/message/InboxShell';
import { api } from '@/lib/api/client';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { Loader2, Send } from 'lucide-react';

interface Conversation {
  id: string;
  participantIds?: string[];
  otherUserId?: string;
  otherDisplayName?: string;
  lastMessage?: { content?: string; at?: string | number };
  unreadCount?: number;
  starred?: boolean;
}

interface Message {
  id: string;
  fromUserId: string;
  content: string;
  createdAt?: string | number;
  read?: boolean;
}

export default function MessageLensPage() {
  useLensNav('message');

  const [activeLabelId, setActiveLabelId] = useState('inbox');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composing, setComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const sentLog = useArtifacts<{ to: string; at: string }>('message', { type: 'sent-message', limit: 5 });
  const recordSent = useCreateArtifact<{ to: string; at: string }>('message');

  const refreshConversations = useCallback(async () => {
    setLoadingConvos(true);
    try {
      const r = await api.get('/api/social/dm/conversations');
      const list = (r.data?.conversations ?? r.data ?? []) as Conversation[];
      setConversations(Array.isArray(list) ? list : []);
    } catch {
      setConversations([]);
    } finally {
      setLoadingConvos(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const r = await api.get(`/api/social/dm/${encodeURIComponent(conversationId)}`);
      const list = (r.data?.messages ?? r.data?.items ?? r.data ?? []) as Message[];
      setMessages(Array.isArray(list) ? list : []);
      // mark conversation read (best-effort)
      api.post(`/api/social/dm/${encodeURIComponent(conversationId)}/read`).catch(() => {});
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => { refreshConversations(); }, [refreshConversations]);
  useEffect(() => {
    if (activeConversationId) loadMessages(activeConversationId);
  }, [activeConversationId, loadMessages]);

  async function sendMessage() {
    setSendError(null);
    if (!composeTo.trim() || !composeBody.trim()) {
      setSendError('Recipient + body required.');
      return;
    }
    setSending(true);
    try {
      const r = await api.post('/api/social/dm', {
        toUserId: composeTo.trim(),
        content: composeBody.trim(),
      });
      if (r.data?.ok === false) {
        setSendError(r.data?.error ?? 'send failed');
      } else {
        recordSent.mutate({
          type: 'sent-message',
          title: `to ${composeTo.trim()}`,
          data: { to: composeTo.trim(), at: new Date().toISOString() },
          meta: { tags: ['message', 'dm'], status: 'completed', visibility: 'private' },
        });
        setComposeTo(''); setComposeBody('');
        setComposing(false);
        refreshConversations();
      }
    } catch (e: unknown) {
      type AxiosLike = { response?: { data?: { error?: string } }; message?: string };
      const ax = e as AxiosLike;
      setSendError(ax.response?.data?.error ?? ax.message ?? 'send failed');
    } finally {
      setSending(false);
    }
  }

  useLensCommand(
    [
      { id: 'goto-inbox',   keys: 'g i', description: 'Inbox',   category: 'navigation', action: () => setActiveLabelId('inbox') },
      { id: 'goto-starred', keys: 'g s', description: 'Starred', category: 'navigation', action: () => setActiveLabelId('starred') },
      { id: 'goto-sent',    keys: 'g t', description: 'Sent',    category: 'navigation', action: () => setActiveLabelId('sent') },
      { id: 'compose',      keys: 'c',   description: 'Compose', category: 'actions',    action: () => setComposing(true) },
    ],
    { lensId: 'message' }
  );

  // Map backend conversations into the InboxThread shape the silhouette expects.
  const threads: InboxThread[] = useMemo(() => {
    return conversations.map((c) => ({
      id: c.id,
      from: c.otherDisplayName ?? c.otherUserId ?? 'Unknown',
      subject: c.lastMessage?.content?.slice(0, 80) ?? '(no recent message)',
      snippet: c.lastMessage?.content ?? '',
      timestamp: c.lastMessage?.at
        ? (typeof c.lastMessage.at === 'number'
          ? new Date(c.lastMessage.at).toISOString()
          : new Date(c.lastMessage.at).toISOString())
        : new Date().toISOString(),
      unread: (c.unreadCount ?? 0) > 0,
      starred: !!c.starred,
      labels: ['inbox'],
    }));
  }, [conversations]);

  const activeThread = threads.find((t) => t.id === activeConversationId);

  return (
    <LensShell lensId="message" asMain={false}>
      <ManifestActionBar />
      <div className="h-[calc(100vh-6rem)]">
        <InboxShell
          labels={[
            { id: 'inbox',   label: 'Inbox',   count: threads.filter((t) => t.unread).length, icon: 'inbox' },
            { id: 'starred', label: 'Starred', count: threads.filter((t) => t.starred).length, icon: 'starred' },
            { id: 'snoozed', label: 'Snoozed', icon: 'snoozed' },
            { id: 'sent',    label: 'Sent',    count: sentLog.data?.artifacts?.length ?? 0, icon: 'sent' },
            { id: 'archive', label: 'Archive', icon: 'archive' },
            { id: 'trash',   label: 'Trash',   icon: 'trash' },
          ]}
          activeLabelId={activeLabelId}
          threads={threads}
          activeThreadId={activeConversationId ?? undefined}
          onSelectLabel={(label) => setActiveLabelId(label.id)}
          onSelectThread={(t) => setActiveConversationId(t.id)}
        >
          {composing ? (
            <article className="space-y-3">
              <h1 className="text-xl font-semibold">New message</h1>
              <input
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                placeholder="Recipient userId"
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm font-mono"
              />
              <textarea
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={6}
                placeholder="Body…"
                className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm"
              />
              {sendError && <p className="text-xs text-rose-300">{sendError}</p>}
              <div className="flex items-center gap-2">
                <button
                  onClick={sendMessage}
                  disabled={sending}
                  className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1"
                >
                  {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  Send
                </button>
                <button
                  onClick={() => { setComposing(false); setSendError(null); }}
                  className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded"
                >
                  Cancel
                </button>
              </div>
            </article>
          ) : loadingMessages ? (
            <p className="text-sm text-gray-500 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading messages…</p>
          ) : activeThread ? (
            <article className="prose dark:prose-invert max-w-none">
              <header className="mb-4 not-prose">
                <h1 className="text-xl font-semibold">{activeThread.subject}</h1>
                <div className="text-sm text-gray-500 mt-1">
                  From {activeThread.from} · {new Date(activeThread.timestamp).toLocaleString()}
                </div>
              </header>
              {messages.length === 0 ? (
                <p>{activeThread.snippet}</p>
              ) : (
                <div className="space-y-2 not-prose">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className="border border-white/10 rounded p-3 bg-white/5"
                    >
                      <div className="text-xs text-gray-500 mb-1">{m.fromUserId}</div>
                      <div className="text-sm text-gray-200 whitespace-pre-wrap">{m.content}</div>
                      {m.createdAt && (
                        <div className="text-[10px] text-gray-600 mt-1">
                          {typeof m.createdAt === 'number'
                            ? new Date(m.createdAt).toLocaleString()
                            : new Date(m.createdAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </article>
          ) : loadingConvos ? (
            <p className="text-sm text-gray-500 inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading conversations…
            </p>
          ) : conversations.length === 0 ? (
            <div className="text-sm text-gray-500">
              <p>No conversations yet.</p>
              <button
                onClick={() => setComposing(true)}
                className="mt-3 px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 rounded text-white inline-flex items-center gap-1"
              >
                <Send className="w-3 h-3" /> Start a conversation
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Select a conversation from the inbox.</p>
          )}
        </InboxShell>
      </div>
    </LensShell>
  );
}
