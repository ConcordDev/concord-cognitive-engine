'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { getSocket, subscribe, SocketEvent } from '@/lib/realtime/socket';

interface DMIndicatorProps {
  userId?: string;
  className?: string;
}

interface Conversation {
  id: string;
  unreadCount?: number;
  hasUnread?: boolean;
}

function DMIndicator({ userId, className }: DMIndicatorProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Fetch conversations to get unread count, poll every 30s
  const { data: conversationsData } = useQuery({
    queryKey: ['dm-conversations-count', userId],
    queryFn: async () => {
      try {
        const res = await api.get('/api/social/dm/conversations', {
          params: { userId },
        });
        const conversations: Conversation[] = res.data.conversations || res.data || [];
        const totalUnread = conversations.reduce((sum, c) => {
          return sum + (c.unreadCount || (c.hasUnread ? 1 : 0));
        }, 0);
        return { count: totalUnread };
      } catch {
        return { count: 0 };
      }
    },
    refetchInterval: 30000,
    enabled: !!userId,
  });

  const unreadCount = conversationsData?.count ?? 0;

  // Real-time socket updates for new DMs
  useEffect(() => {
    try {
      const socket = getSocket();
      if (!socket) return;

      // Listen for generic notification events that may include DM notifications
      const unsub = subscribe('queue:notifications:new' as SocketEvent, (data: unknown) => {
        const payload = data as { type?: string };
        if (payload?.type === 'dm' || payload?.type === 'message') {
          queryClient.invalidateQueries({ queryKey: ['dm-conversations-count', userId] });
          queryClient.invalidateQueries({ queryKey: ['dm-conversations', userId] });
        }
      });

      return unsub;
    } catch {
      // Socket not available
    }
  }, [userId, queryClient]);

  return (
    <button
      onClick={() => router.push('/messages')}
      className={cn(
        'relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-lattice-elevated transition-colors',
        className
      )}
      aria-label={`Messages${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
    >
      <MessageCircle className="w-5 h-5" />
      <AnimatePresence>
        {unreadCount > 0 && (
          <motion.span
            key="dm-badge"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-neon-pink text-[10px] text-white font-bold flex items-center justify-center leading-none"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedDMIndicator = withErrorBoundary(DMIndicator);
export { _WrappedDMIndicator as DMIndicator };
export default _WrappedDMIndicator;
