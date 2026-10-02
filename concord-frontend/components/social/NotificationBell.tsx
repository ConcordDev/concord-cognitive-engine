'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { getSocket, subscribe, SocketEvent } from '@/lib/realtime/socket';
import { NotificationCenter } from './NotificationCenter';

interface NotificationBellProps {
  userId?: string;
  placement?: 'below' | 'side';
  className?: string;
}

export function NotificationBell({ userId, className, placement = 'below' }: NotificationBellProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch unread count with 30s polling
  const { data: countData } = useQuery({
    queryKey: ['notification-count', userId],
    queryFn: async () => {
      try {
        const res = await api.get('/api/social/notifications/count', {
          params: { userId },
        });
        return res.data as { count: number };
      } catch {
        // Fallback: fetch full list and count unread
        try {
          const res = await api.get('/api/social/notifications', {
            params: { userId, limit: 50, unreadOnly: true },
          });
          const notifications = res.data.notifications || [];
          return { count: notifications.length };
        } catch {
          return { count: 0 };
        }
      }
    },
    refetchInterval: 30000,
    enabled: !!userId,
  });

  const unreadCount = countData?.count ?? 0;

  // Real-time updates via socket
  useEffect(() => {
    try {
      const socket = getSocket();
      if (!socket) return;

      const unsub = subscribe('queue:notifications:new' as SocketEvent, () => {
        queryClient.invalidateQueries({ queryKey: ['notification-count', userId] });
        queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
      });

      return unsub;
    } catch {
      // Socket not available
    }
  }, [userId, queryClient]);

  // Close on outside click and Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const handleNavigateToUser = useCallback(
    (uid: string) => {
      setIsOpen(false);
      router.push(`/lenses/social?user=${uid}`);
    },
    [router]
  );

  const handleNavigateToContent = useCallback(
    (contentId: string) => {
      setIsOpen(false);
      router.push(`/lenses/all?dtu=${contentId}`);
    },
    [router]
  );

  return (
    <div className={cn('relative', className)} ref={containerRef}>
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'relative p-2 rounded-lg transition-colors',
          isOpen
            ? 'bg-neon-cyan/10 text-neon-cyan'
            : 'text-gray-400 hover:text-white hover:bg-lattice-elevated'
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell className="w-5 h-5" />
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              key="badge"
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

      {userId && (
        <NotificationCenter
          userId={userId}
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onNavigateToUser={handleNavigateToUser}
          onNavigateToContent={handleNavigateToContent}
          mode="dropdown"
          placement={placement}
        />
      )}
    </div>
  );
}

export default NotificationBell;
