'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageCircle,
  Send,
  ArrowLeft,
  Search,
  Plus,
  CheckCheck,
  Check,
  Link2,
  Loader2,
  X,
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { getSocket, subscribe, SocketEvent } from '@/lib/realtime/socket';

/** Sanitize user-provided URLs — only allow http: and https: schemes. */
function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url;
    }
  } catch {
    // invalid URL
  }
  return '';
}

// ── Types ────────────────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  participantId: string;
  participantName: string;
  participantAvatar?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
  isOnline?: boolean;
}

interface Message {
  id: string;
  conversationId: string;
  fromUserId: string;
  toUserId: string;
  content: string;
  mediaUrl?: string;
  createdAt: string;
  read: boolean;
  readAt?: string;
}

interface UserSearchResult {
  id: string;
  username: string;
  displayName?: string;
  avatar?: string;
}

// ── Conversation List Item ──────────────────────────────────────────────────

function ConversationItem({
  conversation,
  isActive,
  onClick,
}: {
  conversation: Conversation;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-lattice-border/50',
        isActive
          ? 'bg-neon-cyan/[0.05] border-l-2 border-l-neon-cyan'
          : 'hover:bg-lattice-deep/50'
      )}
    >
      {/* Avatar with online indicator */}
      <div className="relative flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-neon-purple to-neon-blue flex items-center justify-center text-sm font-bold text-white">
          {conversation.participantAvatar ? (
            <Image
              src={conversation.participantAvatar}
              alt={conversation.participantName}
              width={40}
              height={40}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            conversation.participantName.charAt(0).toUpperCase()
          )}
        </div>
        {conversation.isOnline && (
          <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-400 border-2 border-lattice-surface" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span
            className={cn(
              'text-sm font-medium truncate',
              conversation.unreadCount > 0 ? 'text-white' : 'text-gray-300'
            )}
          >
            {conversation.participantName}
          </span>
          {conversation.lastMessageAt && (
            <span className="text-xs text-gray-500 flex-shrink-0 ml-2">
              {formatRelativeTime(conversation.lastMessageAt)}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p
            className={cn(
              'text-xs truncate',
              conversation.unreadCount > 0 ? 'text-gray-300' : 'text-gray-500'
            )}
          >
            {conversation.lastMessage || 'No messages yet'}
          </p>
          {conversation.unreadCount > 0 && (
            <span className="flex-shrink-0 ml-2 min-w-[20px] h-5 px-1.5 rounded-full bg-neon-cyan text-[10px] text-white font-bold flex items-center justify-center">
              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ── Message Bubble ──────────────────────────────────────────────────────────

function MessageBubble({
  message,
  isOwn,
  senderName,
}: {
  message: Message;
  isOwn: boolean;
  senderName?: string;
}) {
  // Detect URLs in content for media display
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const urls = message.content.match(urlRegex) || [];
  const imageUrls = urls.filter((u) =>
    /\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i.test(u)
  );
  const textContent = message.content.replace(urlRegex, '').trim();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex mb-3', isOwn ? 'justify-end' : 'justify-start')}
    >
      <div className={cn('flex items-end gap-2 max-w-[75%]', isOwn && 'flex-row-reverse')}>
        {/* Avatar */}
        {!isOwn && (
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-neon-purple to-neon-blue flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
            {senderName?.charAt(0).toUpperCase() || '?'}
          </div>
        )}

        {/* Bubble */}
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5',
            isOwn
              ? 'bg-neon-cyan/20 border border-neon-cyan/30 text-white rounded-br-sm'
              : 'bg-lattice-elevated border border-lattice-border text-gray-200 rounded-bl-sm'
          )}
        >
          {/* Media URL preview */}
          {message.mediaUrl && sanitizeUrl(message.mediaUrl) && (
            <div className="mb-2 rounded-lg overflow-hidden">
              <Image
                src={sanitizeUrl(message.mediaUrl)}
                alt="Shared media"
                width={400}
                height={240}
                className="max-w-full max-h-60 object-contain rounded-lg w-auto h-auto"
              />
            </div>
          )}

          {/* Inline image URLs from content */}
          {imageUrls.map((url, i) => {
            const safe = sanitizeUrl(url);
            if (!safe) return null;
            return (
              <div key={i} className="mb-2 rounded-lg overflow-hidden">
                <Image
                  src={safe}
                  alt="Shared image"
                  width={400}
                  height={240}
                  className="max-w-full max-h-60 object-contain rounded-lg w-auto h-auto"
                />
              </div>
            );
          })}

          {/* Non-image URLs as links */}
          {urls
            .filter((u) => !imageUrls.includes(u))
            .map((url, i) => {
              const safe = sanitizeUrl(url);
              if (!safe) return null;
              return (
                <a
                  key={i}
                  href={safe}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-neon-cyan hover:text-neon-blue text-xs mb-1 break-all"
                >
                  <Link2 className="w-3 h-3 flex-shrink-0" />
                  {url}
                </a>
              );
            })}

          {/* Text content */}
          {(textContent || (!message.mediaUrl && imageUrls.length === 0)) && (
            <p className="text-sm whitespace-pre-wrap break-words">
              {textContent || message.content}
            </p>
          )}

          {/* Timestamp + read receipt */}
          <div
            className={cn(
              'flex items-center gap-1 mt-1',
              isOwn ? 'justify-end' : 'justify-start'
            )}
          >
            <span className="text-[10px] text-gray-500">
              {new Date(message.createdAt).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {isOwn && (
              <span className={cn('flex-shrink-0', message.read ? 'text-neon-cyan' : 'text-gray-500')}>
                {message.read ? (
                  <CheckCheck className="w-3.5 h-3.5" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
              </span>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ── New Conversation Modal ──────────────────────────────────────────────────

function NewConversationModal({
  onSelect,
  onClose,
}: {
  onSelect: (user: UserSearchResult) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');

  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['user-search', search],
    queryFn: async () => {
      if (search.length < 2) return [];
      const res = await api.get('/api/social/users/search', {
        params: { q: search, limit: 10 },
      });
      return (res.data.users || res.data || []) as UserSearchResult[];
    },
    enabled: search.length >= 2,
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
          <h3 className="text-white font-semibold">New Message</h3>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users..."
              className="w-full pl-10 pr-4 py-2.5 bg-lattice-deep border border-lattice-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
            </div>
          )}

          {!isLoading && search.length >= 2 && (searchResults?.length ?? 0) === 0 && (
            <div className="text-center py-8 text-gray-500 text-sm">
              No users found
            </div>
          )}

          {!isLoading && search.length < 2 && (
            <div className="text-center py-8 text-gray-500 text-sm">
              Type at least 2 characters to search
            </div>
          )}

          {searchResults?.map((user) => (
            <button
              key={user.id}
              onClick={() => onSelect(user)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-lattice-deep/50 transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-neon-purple to-neon-blue flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
                {user.avatar ? (
                  <Image
                    src={user.avatar}
                    alt={user.displayName || user.username}
                    width={36}
                    height={36}
                    className="w-9 h-9 rounded-full object-cover"
                  />
                ) : (
                  (user.displayName || user.username).charAt(0).toUpperCase()
                )}
              </div>
              <div>
                <p className="text-sm text-white font-medium">
                  {user.displayName || user.username}
                </p>
                {user.displayName && (
                  <p className="text-xs text-gray-500">@{user.username}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Main Messages Page ──────────────────────────────────────────────────────

export default function MessagesPage() {
  const queryClient = useQueryClient();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get current user
  const { data: userData } = useQuery({
    queryKey: ['auth-me'],
    queryFn: () => api.get('/api/auth/me').then((r) => r.data).catch(() => null),
    staleTime: 60000,
    retry: false,
  });

  const currentUserId = userData?.id || userData?._id || '';

  // Fetch conversation list
  const { data: conversationsData, isLoading: conversationsLoading } = useQuery({
    queryKey: ['dm-conversations', currentUserId],
    queryFn: async () => {
      const res = await api.get('/api/social/dm/conversations', {
        params: { userId: currentUserId },
      });
      return (res.data.conversations || res.data || []) as Conversation[];
    },
    enabled: !!currentUserId,
    refetchInterval: 30000,
  });

  const conversations = useMemo(() => conversationsData || [], [conversationsData]);

  // Get active conversation metadata
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId),
    [conversations, activeConversationId]
  );

  // Fetch messages for active conversation
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: ['dm-messages', activeConversationId],
    queryFn: async () => {
      const res = await api.get(`/api/social/dm/${activeConversationId}`, {
        params: { limit: 50 },
      });
      return (res.data.messages || res.data || []) as Message[];
    },
    enabled: !!activeConversationId,
    refetchInterval: 10000,
  });

  const messages = messagesData || [];

  // Mark conversation as read when opened
  const markReadMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      await api.post(`/api/social/dm/${conversationId}/read`, {
        userId: currentUserId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dm-conversations', currentUserId] });
      queryClient.invalidateQueries({
        queryKey: ['dm-conversations-count', currentUserId],
      });
    },
  });

  // Send message
  const sendMutation = useMutation({
    mutationFn: async ({
      toUserId,
      content,
    }: {
      toUserId: string;
      content: string;
    }) => {
      const res = await api.post('/api/social/dm', {
        fromUserId: currentUserId,
        toUserId,
        content,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['dm-messages', activeConversationId],
      });
      queryClient.invalidateQueries({
        queryKey: ['dm-conversations', currentUserId],
      });
      setMessageInput('');
      // Scroll to bottom after send
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    },
  });

  // Open a conversation
  const openConversation = useCallback(
    (conversationId: string) => {
      setActiveConversationId(conversationId);
      setMobileShowThread(true);
      // Mark as read
      markReadMutation.mutate(conversationId);
    },
    [markReadMutation]
  );

  // Start new conversation from user search
  const handleNewConversation = useCallback(
    async (user: UserSearchResult) => {
      setShowNewConversation(false);

      // Check if a conversation already exists with this user
      const existing = conversations.find((c) => c.participantId === user.id);
      if (existing) {
        openConversation(existing.id);
        return;
      }

      // Send an initial empty handshake or just open a new thread
      // The conversation will be created server-side on first message
      // For now, set up a temporary conversation state
      setActiveConversationId(`new:${user.id}`);
      setMobileShowThread(true);
      inputRef.current?.focus();
    },
    [conversations, openConversation]
  );

  // Handle send
  const handleSend = useCallback(() => {
    if (!messageInput.trim()) return;

    let toUserId = '';
    if (activeConversationId?.startsWith('new:')) {
      toUserId = activeConversationId.replace('new:', '');
    } else if (activeConversation) {
      toUserId = activeConversation.participantId;
    }

    if (!toUserId) return;

    sendMutation.mutate({ toUserId, content: messageInput.trim() });
  }, [messageInput, activeConversationId, activeConversation, sendMutation]);

  // Handle Enter key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Real-time socket subscription for new DM messages
  useEffect(() => {
    try {
      const socket = getSocket();
      if (!socket) return;

      const unsub = subscribe('queue:notifications:new' as SocketEvent, (data: unknown) => {
        const payload = data as { type?: string; conversationId?: string };
        if (payload?.type === 'dm' || payload?.type === 'message') {
          queryClient.invalidateQueries({ queryKey: ['dm-conversations', currentUserId] });
          if (payload.conversationId === activeConversationId) {
            queryClient.invalidateQueries({
              queryKey: ['dm-messages', activeConversationId],
            });
          }
        }
      });

      return unsub;
    } catch {
      // Socket not available
    }
  }, [currentUserId, activeConversationId, queryClient]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-3.5rem)] lg:h-[calc(100vh-4rem)] bg-lattice-deep">
      {/* Left sidebar: Conversation list */}
      <div
        className={cn(
          'w-full md:w-80 lg:w-96 bg-lattice-surface border-r border-lattice-border flex flex-col flex-shrink-0',
          mobileShowThread && 'hidden md:flex'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-5 h-5 text-neon-cyan" />
            <h2 className="text-white font-semibold">Messages</h2>
          </div>
          <button
            onClick={() => setShowNewConversation(true)}
            className="p-2 text-gray-400 hover:text-neon-cyan hover:bg-neon-cyan/10 rounded-lg transition-colors"
            title="New message"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {conversationsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
            </div>
          ) : conversations.length > 0 ? (
            conversations.map((conversation) => (
              <ConversationItem
                key={conversation.id}
                conversation={conversation}
                isActive={activeConversationId === conversation.id}
                onClick={() => openConversation(conversation.id)}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-16 px-4">
              <MessageCircle className="w-12 h-12 text-gray-600 mb-3" />
              <p className="text-gray-400 text-sm font-medium">No conversations yet</p>
              <p className="text-gray-500 text-xs mt-1 text-center">
                Start a new conversation by clicking the + button
              </p>
              <button
                onClick={() => setShowNewConversation(true)}
                className="mt-4 px-4 py-2 bg-neon-cyan/10 text-neon-cyan rounded-lg text-sm font-medium hover:bg-neon-cyan/20 transition-colors"
              >
                New Message
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Right panel: Message thread */}
      <div
        className={cn(
          'flex-1 flex flex-col',
          !mobileShowThread && 'hidden md:flex'
        )}
      >
        {activeConversationId ? (
          <>
            {/* Thread header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-lattice-border bg-lattice-surface">
              {/* Mobile back button */}
              <button
                onClick={() => {
                  setMobileShowThread(false);
                  setActiveConversationId(null);
                }}
                className="md:hidden p-1.5 text-gray-400 hover:text-white rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>

              {/* Participant info */}
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-neon-purple to-neon-blue flex items-center justify-center text-sm font-bold text-white">
                  {activeConversation?.participantAvatar ? (
                    <Image
                      src={activeConversation.participantAvatar}
                      alt={activeConversation.participantName}
                      width={36}
                      height={36}
                      className="w-9 h-9 rounded-full object-cover"
                    />
                  ) : (
                    (activeConversation?.participantName || '?').charAt(0).toUpperCase()
                  )}
                </div>
                {activeConversation?.isOnline && (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-lattice-surface" />
                )}
              </div>
              <div>
                <p className="text-sm text-white font-medium">
                  {activeConversation?.participantName || 'New Conversation'}
                </p>
                {activeConversation?.isOnline && (
                  <p className="text-xs text-green-400">Online</p>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {messagesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
                </div>
              ) : messages.length > 0 ? (
                <>
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      isOwn={message.fromUserId === currentUserId}
                      senderName={
                        message.fromUserId === currentUserId
                          ? undefined
                          : activeConversation?.participantName
                      }
                    />
                  ))}
                  <div ref={messagesEndRef} />
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-12">
                  <MessageCircle className="w-10 h-10 text-gray-600 mb-3" />
                  <p className="text-gray-400 text-sm">
                    No messages yet. Send the first one!
                  </p>
                </div>
              )}
            </div>

            {/* Message input */}
            <div className="px-4 py-3 border-t border-lattice-border bg-lattice-surface">
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    className="w-full px-4 py-2.5 bg-lattice-deep border border-lattice-border rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-neon-cyan/50 pr-10"
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={!messageInput.trim() || sendMutation.isPending}
                  className={cn(
                    'p-2.5 rounded-xl transition-colors',
                    messageInput.trim()
                      ? 'bg-neon-cyan text-white hover:bg-neon-cyan/80'
                      : 'bg-lattice-elevated text-gray-500 cursor-not-allowed'
                  )}
                >
                  {sendMutation.isPending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Empty state when no conversation is selected */
          <div className="hidden md:flex flex-1 items-center justify-center">
            <div className="text-center">
              <MessageCircle className="w-16 h-16 text-gray-600 mx-auto mb-4" />
              <h3 className="text-lg text-gray-400 font-medium">
                Select a conversation
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Choose a conversation from the sidebar or start a new one
              </p>
            </div>
          </div>
        )}
      </div>

      {/* New conversation modal */}
      <AnimatePresence>
        {showNewConversation && (
          <NewConversationModal
            onSelect={handleNewConversation}
            onClose={() => setShowNewConversation(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
