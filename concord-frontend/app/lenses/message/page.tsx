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
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { MessagingRepos } from '@/components/message/MessagingRepos';
import { LabelManagerPanel } from '@/components/message/LabelManagerPanel';
import { ThreadLabelBar } from '@/components/message/ThreadLabelBar';
import { RecipientSearchInput } from '@/components/message/RecipientSearchInput';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { InboxShell, type InboxThread } from '@/components/message/InboxShell';
import { api } from '@/lib/api/client';
import { useArtifacts, useCreateArtifact } from '@/lib/hooks/use-lens-artifacts';
import { Skeleton, EmptyState, ErrorState } from '@/components/ui';
import { ds } from '@/lib/design-system';
import { Loader2, Send, MailPlus } from 'lucide-react';
import MessageWorkbench from '@/components/message/MessageWorkbench';
import { SlackSection } from '@/components/message/SlackSection';
import { GmailSection } from '@/components/message/GmailSection';

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
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [convoError, setConvoError] = useState<string | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composing, setComposing] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // In-thread reply state — separate from the new-thread composer
  // because Gmail / Slack users expect to reply inline without losing
  // their place in the thread.
  const [replyBody, setReplyBody] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const sentLog = useArtifacts<{ to: string; at: string }>('message', { type: 'sent-message', limit: 5 });
  const recordSent = useCreateArtifact<{ to: string; at: string }>('message');

  const refreshConversations = useCallback(async () => {
    setLoadingConvos(true);
    setConvoError(null);
    try {
      const r = await api.get('/api/social/dm/conversations');
      const list = (r.data?.conversations ?? r.data ?? []) as Conversation[];
      setConversations(Array.isArray(list) ? list : []);
    } catch (e: unknown) {
      type AxiosLike = { response?: { data?: { error?: string } }; message?: string };
      const ax = e as AxiosLike;
      setConversations([]);
      setConvoError(ax.response?.data?.error ?? ax.message ?? 'Could not load conversations.');
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

  // Send a reply to the active conversation — uses the same /api/social/dm
  // endpoint as compose, but routes the toUserId from the current
  // conversation's participants so the user doesn't have to retype it.
  const sendReply = useCallback(async () => {
    setReplyError(null);
    const conv = conversations.find((c) => c.id === activeConversationId);
    const to = conv?.otherUserId
      ?? (conv?.participantIds || []).find((id) => id);
    const body = replyBody.trim();
    if (!to || !body) {
      setReplyError(!to ? 'No recipient resolved for this thread.' : 'Body required.');
      return;
    }
    setReplying(true);
    try {
      const r = await api.post('/api/social/dm', {
        toUserId: to,
        content: body,
        conversationId: activeConversationId ?? undefined,
      });
      if (r.data?.ok === false) {
        setReplyError(r.data?.error ?? 'send failed');
      } else {
        recordSent.mutate({
          type: 'sent-message',
          title: `to ${to}`,
          data: { to, at: new Date().toISOString() },
          meta: { tags: ['message', 'dm', 'reply'], status: 'completed', visibility: 'private' },
        });
        setReplyBody('');
        if (activeConversationId) loadMessages(activeConversationId);
        refreshConversations();
      }
    } catch (e: unknown) {
      type AxiosLike = { response?: { data?: { error?: string } }; message?: string };
      const ax = e as AxiosLike;
      setReplyError(ax.response?.data?.error ?? ax.message ?? 'send failed');
    } finally {
      setReplying(false);
    }
  }, [activeConversationId, conversations, replyBody, recordSent, loadMessages, refreshConversations]);

  useLensCommand(
    [
      { id: 'goto-inbox',   keys: 'g i', description: 'Inbox',   category: 'navigation', action: () => setActiveLabelId('inbox') },
      { id: 'goto-starred', keys: 'g s', description: 'Starred', category: 'navigation', action: () => setActiveLabelId('starred') },
      { id: 'goto-sent',    keys: 'g t', description: 'Sent',    category: 'navigation', action: () => setActiveLabelId('sent') },
      { id: 'compose',      keys: 'c',   description: 'Compose', category: 'actions',    action: () => setComposing(true) },
      { id: 'reply',        keys: 'r',   description: 'Reply to thread', category: 'actions',
        action: () => { if (activeConversationId) requestAnimationFrame(() => (document.getElementById('msg-reply-textarea') as HTMLTextAreaElement | null)?.focus()); } },
    ],
    { lensId: 'message' }
  );

  // Map backend conversations into the InboxThread shape the silhouette expects.
  const allThreads: InboxThread[] = useMemo(() => {
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

  // Apply the active label filter — `inbox` shows everything, `starred`
  // narrows to threads the user starred, `sent` is empty for now (we'd
  // need a separate "where I'm the sender" query) but the filter
  // doesn't crash when selected.
  const threads: InboxThread[] = useMemo(() => {
    if (activeLabelId === 'starred') return allThreads.filter((t) => t.starred);
    if (activeLabelId === 'sent')    return [];
    if (activeLabelId === 'archive' || activeLabelId === 'trash') return [];
    return allThreads;
  }, [allThreads, activeLabelId]);

  const activeThread = threads.find((t) => t.id === activeConversationId);

  return (
    <LensShell lensId="message" asMain={false}>
      <FirstRunTour lensId="message" />
      <ManifestActionBar />
      <DepthBadge lensId="message" size="sm" className="ml-2" />
      <div className="px-4 mt-3 space-y-3">
        <GmailSection />
        <SlackSection />
      </div>
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
              <h1 className="text-xl font-semibold text-white">New message</h1>
              <RecipientSearchInput value={composeTo} onChange={setComposeTo} />
              <textarea
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={6}
                placeholder="Body…"
                className={`${ds.textarea} text-sm`}
              />
              {sendError && <p className="text-xs text-red-400">{sendError}</p>}
              <div className="flex items-center gap-2">
                <button
                  onClick={sendMessage}
                  disabled={sending}
                  className={`${ds.btnPrimary} px-3 py-1.5 text-xs inline-flex items-center gap-1`}
                >
                  {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  Send
                </button>
                <button
                  onClick={() => { setComposing(false); setSendError(null); }}
                  className={`${ds.btnSecondary} px-3 py-1.5 text-xs`}
                >
                  Cancel
                </button>
              </div>
            </article>
          ) : loadingMessages ? (
            <div className="space-y-3 not-prose" aria-busy="true">
              <Skeleton variant="line" width="40%" height="1.25rem" />
              <Skeleton variant="block" height="4rem" />
              <Skeleton variant="block" height="4rem" className="w-3/4" />
              <Skeleton variant="block" height="4rem" />
            </div>
          ) : activeThread ? (
            <article className="prose dark:prose-invert max-w-none">
              <header className="mb-4 not-prose">
                <h1 className="text-xl font-semibold text-white">{activeThread.subject}</h1>
                <div className="text-sm text-gray-400 mt-1">
                  From <span className="text-gray-300">{activeThread.from}</span>
                  {' · '}
                  <span className="font-mono tabular-nums text-gray-500">{new Date(activeThread.timestamp).toLocaleString()}</span>
                </div>
                <ThreadLabelBar threadId={activeThread.id} className="mt-2" />
              </header>
              {messages.length === 0 ? (
                <p className="text-gray-300">{activeThread.snippet}</p>
              ) : (
                <div className="space-y-2 not-prose">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className="border border-lattice-border rounded-lg p-3 sm:p-5 bg-lattice-surface"
                    >
                      <div className="text-xs font-mono text-gray-500 mb-1">{m.fromUserId}</div>
                      <div className="text-sm text-gray-200 whitespace-pre-wrap">{m.content}</div>
                      {m.createdAt && (
                        <div className="text-[10px] font-mono tabular-nums text-gray-500 mt-1">
                          {typeof m.createdAt === 'number'
                            ? new Date(m.createdAt).toLocaleString()
                            : new Date(m.createdAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Inline reply composer — Gmail / Slack idiom.  Doesn't
                  block the thread view; the user can scroll back up to
                  re-read while typing. */}
              <div className="mt-4 not-prose border-t border-lattice-border pt-4">
                <div className="text-xs text-gray-400 mb-2 flex items-center justify-between">
                  <span>
                    Replying to <span className="text-gray-300 font-medium">{activeThread.from}</span>
                  </span>
                  <kbd className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-lattice-elevated border border-lattice-border text-gray-400">⌘⏎ send</kbd>
                </div>
                <textarea
                  id="msg-reply-textarea"
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); } }}
                  rows={3}
                  placeholder="Write a reply…"
                  disabled={replying}
                  className={`${ds.textarea} text-sm`}
                />
                {replyError && <p className="text-xs text-red-400 mt-1">{replyError}</p>}
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={sendReply}
                    disabled={replying || !replyBody.trim()}
                    className={`${ds.btnPrimary} px-3 py-1.5 text-xs inline-flex items-center gap-1`}
                  >
                    {replying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    {replying ? 'Sending…' : 'Reply'}
                  </button>
                  {replyBody && (
                    <button
                      onClick={() => { setReplyBody(''); setReplyError(null); }}
                      disabled={replying}
                      className="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      Discard
                    </button>
                  )}
                </div>
              </div>
            </article>
          ) : loadingConvos ? (
            <div className="not-prose divide-y divide-lattice-border/60" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="py-2.5 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Skeleton variant="line" width="35%" height="0.9rem" />
                    <Skeleton variant="line" width="3rem" height="0.7rem" className="ml-auto" />
                  </div>
                  <Skeleton variant="line" width="70%" height="0.9rem" />
                  <Skeleton variant="line" width="55%" height="0.75rem" />
                </div>
              ))}
            </div>
          ) : convoError ? (
            <ErrorState
              message={convoError}
              title="Couldn't load conversations."
              onRetry={refreshConversations}
              retrying={loadingConvos}
            />
          ) : conversations.length === 0 ? (
            <EmptyState
              icon={<MailPlus className="h-5 w-5" />}
              title="No messages yet."
              description="Your direct messages will show up here. Start a conversation to begin."
              action={{ label: 'Compose', onClick: () => setComposing(true) }}
            />
          ) : (
            <p className="text-sm text-gray-400">Select a conversation from the inbox.</p>
          )}
        </InboxShell>
      </div>
    

      {/* 2026 parity workbench — saved, search, voice, reactions */}
      <button
        type="button"
        onClick={() => setWorkbenchOpen(true)}
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-neon-blue text-lattice-void font-semibold hover:bg-neon-blue/90 shadow-lg text-sm transition-colors duration-150"
        title="Message Workbench — saved/starred, search, voice notes, reactions"
      >
        Message Workbench
      </button>
      <MessageWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />
      <LabelManagerPanel className="mt-6" />
      <section className="mt-6 rounded-xl border border-lattice-border bg-lattice-surface/40 p-4">
        <MessagingRepos />
      </section>
          <RecentMineCard domain="message" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="message" hideWhenEmpty className="mt-3" />
          <CrossLensRecentsPanel lensId="message" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
