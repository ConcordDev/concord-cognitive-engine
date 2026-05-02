'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  BellOff,
  Heart,
  MessageCircle,
  UserPlus,
  Quote,
  Coins,
  Megaphone,
  CheckCheck,
  Trash2,
  X,
  Filter,
  Loader2,
  Star,
  AlertCircle,
} from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import { api } from '@/lib/api/client';
import { getSocket, subscribe, SocketEvent } from '@/lib/realtime/socket';

// ── Types ────────────────────────────────────────────────────────────────────

type NotificationType =
  | 'follow'
  | 'like'
  | 'comment'
  | 'citation'
  | 'tip'
  | 'mention'
  | 'system'
  | 'achievement'
  | 'content_update';

type NotificationFilter = 'all' | 'unread' | NotificationType;

interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  actorId?: string;
  actorName?: string;
  targetId?: string;
  targetTitle?: string;
  amount?: number;
  read: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

interface GroupedNotification extends Notification {
  groupedActors?: Array<{ id: string; name: string }>;
  groupCount?: number;
}

interface NotificationCenterProps {
  userId: string;
  isOpen?: boolean;
  onClose?: () => void;
  onNavigateToUser?: (userId: string) => void;
  onNavigateToContent?: (contentId: string) => void;
  mode?: 'panel' | 'dropdown';
  className?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const NOTIFICATION_CONFIG: Record<
  NotificationType,
  {
    icon: typeof Bell;
    color: string;
    bgColor: string;
  }
> = {
  follow: {
    icon: UserPlus,
    color: 'text-neon-cyan',
    bgColor: 'bg-neon-cyan/10',
  },
  like: {
    icon: Heart,
    color: 'text-neon-pink',
    bgColor: 'bg-neon-pink/10',
  },
  comment: {
    icon: MessageCircle,
    color: 'text-neon-blue',
    bgColor: 'bg-neon-blue/10',
  },
  citation: {
    icon: Quote,
    color: 'text-neon-purple',
    bgColor: 'bg-neon-purple/10',
  },
  tip: {
    icon: Coins,
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
  },
  mention: {
    icon: Star,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-400/10',
  },
  system: {
    icon: Megaphone,
    color: 'text-gray-400',
    bgColor: 'bg-gray-400/10',
  },
  achievement: {
    icon: Star,
    color: 'text-amber-400',
    bgColor: 'bg-amber-400/10',
  },
  content_update: {
    icon: AlertCircle,
    color: 'text-neon-blue',
    bgColor: 'bg-neon-blue/10',
  },
};

const FILTER_OPTIONS: Array<{ id: NotificationFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'follow', label: 'Follows' },
  { id: 'like', label: 'Likes' },
  { id: 'comment', label: 'Comments' },
  { id: 'citation', label: 'Citations' },
  { id: 'tip', label: 'Tips' },
  { id: 'system', label: 'System' },
];

// ── Grouping Logic ──────────────────────────────────────────────────────────

function groupNotifications(notifications: Notification[]): GroupedNotification[] {
  // Group by type + targetId within a 24-hour window
  const groupMap = new Map<string, Notification[]>();
  const ungroupable: Notification[] = [];

  for (const n of notifications) {
    // Only group likes, comments, follows (not tips, system, achievements)
    if (['like', 'comment', 'follow'].includes(n.type) && n.targetId) {
      const key = `${n.type}:${n.targetId}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(n);
    } else if (n.type === 'follow' && !n.targetId) {
      const key = 'follow:no-target';
      if (!groupMap.has(key)) {
        groupMap.set(key, []);
      }
      groupMap.get(key)!.push(n);
    } else {
      ungroupable.push(n);
    }
  }

  const result: GroupedNotification[] = [];

  for (const [, group] of groupMap) {
    if (group.length === 1) {
      result.push(group[0]);
    } else {
      // Use most recent as the base notification
      const sorted = group.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      const base = sorted[0];
      const actors = sorted
        .filter((n) => n.actorId && n.actorName)
        .map((n) => ({ id: n.actorId!, name: n.actorName! }));

      // Deduplicate actors
      const uniqueActors = Array.from(new Map(actors.map((a) => [a.id, a])).values());

      const othersCount = uniqueActors.length - 1;
      let groupMessage = base.message;
      if (othersCount > 0 && uniqueActors.length > 0) {
        const verb =
          base.type === 'like'
            ? 'liked your post'
            : base.type === 'comment'
              ? 'commented on your post'
              : 'started following you';
        groupMessage =
          othersCount === 1
            ? `and ${uniqueActors[1]?.name || '1 other'} ${verb}`
            : `and ${othersCount} others ${verb}`;
      }

      result.push({
        ...base,
        message: groupMessage,
        read: sorted.every((n) => n.read),
        groupedActors: uniqueActors,
        groupCount: uniqueActors.length,
      });
    }
  }

  // Add ungroupable notifications
  result.push(...ungroupable);

  // Sort all by date descending
  result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return result;
}

// ── Single Notification Item ─────────────────────────────────────────────────

function NotificationItem({
  notification,
  onMarkRead,
  onDelete,
  onNavigateToUser,
  onNavigateToContent,
}: {
  notification: GroupedNotification;
  onMarkRead: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigateToUser?: (userId: string) => void;
  onNavigateToContent?: (contentId: string) => void;
}) {
  const config = NOTIFICATION_CONFIG[notification.type] || NOTIFICATION_CONFIG.system;
  const Icon = config.icon;
  const [showActions, setShowActions] = useState(false);

  const handleClick = useCallback(() => {
    if (!notification.read) {
      onMarkRead(notification.id);
    }
    if (notification.targetId) {
      onNavigateToContent?.(notification.targetId);
    } else if (notification.actorId) {
      onNavigateToUser?.(notification.actorId);
    }
  }, [notification, onMarkRead, onNavigateToUser, onNavigateToContent]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10, height: 0 }}
      layout
      onClick={handleClick}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
      className={cn(
        'flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-lattice-border/50 last:border-b-0 relative group',
        notification.read
          ? 'hover:bg-lattice-deep/50'
          : 'bg-neon-cyan/[0.02] hover:bg-neon-cyan/[0.05]'
      )}
    >
      {/* Icon */}
      <div className={cn('p-2 rounded-lg flex-shrink-0 mt-0.5', config.bgColor)}>
        <Icon className={cn('w-4 h-4', config.color)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Actor + action */}
            <p className="text-sm">
              {notification.actorName && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateToUser?.(notification.actorId!);
                  }}
                  className="font-medium text-white hover:text-neon-cyan transition-colors"
                >
                  {notification.actorName}
                </button>
              )}
              {notification.actorName && ' '}
              <span className="text-gray-400">{notification.message}</span>
            </p>

            {/* Grouped actors preview */}
            {notification.groupCount &&
              notification.groupCount > 1 &&
              notification.groupedActors && (
                <div className="flex items-center gap-1 mt-1">
                  {notification.groupedActors.slice(0, 4).map((actor, i) => (
                    <div
                      key={actor.id}
                      className="w-5 h-5 rounded-full bg-gradient-to-br from-neon-purple to-neon-blue flex items-center justify-center text-[8px] text-white font-bold"
                      style={{ marginLeft: i > 0 ? '-4px' : 0, zIndex: 4 - i }}
                      title={actor.name}
                    >
                      {actor.name.charAt(0).toUpperCase()}
                    </div>
                  ))}
                  {notification.groupCount > 4 && (
                    <span className="text-xs text-gray-500 ml-1">
                      +{notification.groupCount - 4}
                    </span>
                  )}
                </div>
              )}

            {/* Target */}
            {notification.targetTitle && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{notification.targetTitle}</p>
            )}

            {/* Tip amount */}
            {notification.type === 'tip' && notification.amount && (
              <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-amber-400/10 text-amber-400 text-xs font-medium">
                <Coins className="w-3 h-3" />
                {notification.amount} coins
              </span>
            )}

            {/* System messages show full text */}
            {(notification.type === 'system' || notification.type === 'achievement') &&
              !notification.actorName && (
                <p className="text-sm text-gray-300 mt-0.5">{notification.message}</p>
              )}
          </div>

          {/* Unread indicator + actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {showActions && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(notification.id);
                }}
                className="p-1 text-gray-500 hover:text-red-400 rounded transition-colors"
                title="Delete notification"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            {!notification.read && <div className="w-2 h-2 rounded-full bg-neon-cyan mt-0.5" />}
          </div>
        </div>

        {/* Timestamp */}
        <p className="text-xs text-gray-600 mt-1">{formatRelativeTime(notification.createdAt)}</p>
      </div>
    </motion.div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

function NotificationCenter({
  userId,
  isOpen = true,
  onClose,
  onNavigateToUser,
  onNavigateToContent,
  mode = 'panel',
  className,
}: NotificationCenterProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [showFilters, setShowFilters] = useState(false);

  // ── Data fetching ────────────────────────────────────────────────────

  const notificationsQuery = useQuery({
    queryKey: ['notifications', userId],
    queryFn: async () => {
      const params: Record<string, unknown> = { userId, limit: 50 };
      if (filter === 'unread') {
        params.unreadOnly = true;
      }
      const res = await api.get('/api/social/notifications', { params });
      return (res.data.notifications || res.data || []) as Notification[];
    },
    refetchInterval: 30000,
  });

  const notifications = useMemo(() => notificationsQuery.data || [], [notificationsQuery.data]);

  // ── Real-time socket subscription ───────────────────────────────────

  useEffect(() => {
    try {
      const socket = getSocket();
      if (!socket) return;

      const unsub = subscribe('queue:notifications:new' as SocketEvent, () => {
        queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
        queryClient.invalidateQueries({ queryKey: ['notification-count', userId] });
      });

      return unsub;
    } catch {
      // Socket not available
    }
  }, [userId, queryClient]);

  // ── Filtering + Grouping ────────────────────────────────────────────

  const filteredNotifications = useMemo(() => {
    let filtered = notifications;
    if (filter === 'unread') {
      filtered = notifications.filter((n) => !n.read);
    } else if (filter !== 'all') {
      filtered = notifications.filter((n) => n.type === filter);
    }
    return groupNotifications(filtered);
  }, [notifications, filter]);

  const unreadCount = useMemo(() => notifications.filter((n) => !n.read).length, [notifications]);

  // ── Mutations ────────────────────────────────────────────────────────

  const markReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      await api.post(`/api/social/notifications/${notificationId}/read`, { userId });
    },
    onMutate: async (notificationId: string) => {
      await queryClient.cancelQueries({ queryKey: ['notifications', userId] });
      queryClient.setQueryData(['notifications', userId], (old: Notification[] | undefined) => {
        if (!old) return [];
        return old.map((n) => (n.id === notificationId ? { ...n, read: true } : n));
      });
      // Also update count cache
      queryClient.setQueryData(
        ['notification-count', userId],
        (old: { count: number } | undefined) => ({
          count: Math.max(0, (old?.count ?? 1) - 1),
        })
      );
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await api.post('/api/social/notifications/read-all', { userId });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['notifications', userId] });
      queryClient.setQueryData(['notifications', userId], (old: Notification[] | undefined) => {
        if (!old) return [];
        return old.map((n) => ({ ...n, read: true }));
      });
      queryClient.setQueryData(['notification-count', userId], { count: 0 });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications', userId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      await api.delete(`/api/social/notifications/${notificationId}`);
    },
    onMutate: async (notificationId: string) => {
      await queryClient.cancelQueries({ queryKey: ['notifications', userId] });
      const previous = queryClient.getQueryData<Notification[]>(['notifications', userId]);
      queryClient.setQueryData(['notifications', userId], (old: Notification[] | undefined) => {
        if (!old) return [];
        return old.filter((n) => n.id !== notificationId);
      });
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['notifications', userId], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-count', userId] });
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: async () => {
      await api.post('/api/social/notifications/read-all', { userId });
    },
    onMutate: async () => {
      queryClient.setQueryData(['notifications', userId], []);
      queryClient.setQueryData(['notification-count', userId], { count: 0 });
    },
  });

  const handleMarkRead = useCallback(
    (id: string) => {
      markReadMutation.mutate(id);
    },
    [markReadMutation]
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteMutation.mutate(id);
    },
    [deleteMutation]
  );

  // ── Render ───────────────────────────────────────────────────────────

  const content = (
    <div
      className={cn('flex flex-col', mode === 'dropdown' ? 'max-h-[480px]' : 'h-full', className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-lattice-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-neon-cyan" />
          <h2 className="text-white font-semibold">Notifications</h2>
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-neon-cyan/20 text-neon-cyan text-xs font-bold">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={() => markAllReadMutation.mutate()}
              className="p-1.5 text-gray-400 hover:text-neon-cyan rounded-lg transition-colors"
              title="Mark all as read"
            >
              <CheckCheck className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setShowFilters((prev) => !prev)}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              showFilters ? 'text-neon-cyan bg-neon-cyan/10' : 'text-gray-400 hover:text-white'
            )}
            title="Filter notifications"
          >
            <Filter className="w-4 h-4" />
          </button>
          {notifications.length > 0 && (
            <button
              onClick={() => clearAllMutation.mutate()}
              className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg transition-colors"
              title="Clear all"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-white rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-b border-lattice-border flex-shrink-0"
          >
            <div className="flex flex-wrap gap-1.5 px-4 py-2">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setFilter(opt.id)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs font-medium transition-all border',
                    filter === opt.id
                      ? 'bg-neon-cyan/10 text-neon-cyan border-neon-cyan/30'
                      : 'text-gray-400 border-transparent hover:text-white hover:bg-lattice-deep'
                  )}
                >
                  {opt.label}
                  {opt.id === 'unread' && unreadCount > 0 && (
                    <span className="ml-1 text-neon-cyan">({unreadCount})</span>
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Notification list */}
      <div className="flex-1 overflow-y-auto">
        {notificationsQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-neon-cyan animate-spin" />
          </div>
        ) : filteredNotifications.length > 0 ? (
          <AnimatePresence mode="popLayout">
            {filteredNotifications.map((notification) => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                onMarkRead={handleMarkRead}
                onDelete={handleDelete}
                onNavigateToUser={onNavigateToUser}
                onNavigateToContent={onNavigateToContent}
              />
            ))}
          </AnimatePresence>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <BellOff className="w-10 h-10 text-gray-600 mb-3" />
            <p className="text-gray-400 text-sm font-medium">
              {filter === 'unread' ? 'All caught up!' : 'No notifications'}
            </p>
            <p className="text-gray-500 text-xs mt-1 text-center">
              {filter === 'unread'
                ? 'You have no unread notifications.'
                : filter === 'all'
                  ? 'Notifications will appear here when you receive them.'
                  : `No ${filter} notifications.`}
            </p>
          </div>
        )}
      </div>

      {/* Footer */}
      {filteredNotifications.length > 0 && mode === 'dropdown' && (
        <div className="border-t border-lattice-border px-4 py-2 flex-shrink-0">
          <button className="w-full text-center text-sm text-neon-cyan hover:text-neon-cyan/80 transition-colors py-1">
            View all notifications
          </button>
        </div>
      )}
    </div>
  );

  // For dropdown mode, wrap in positioned container
  if (mode === 'dropdown') {
    if (!isOpen) return null;

    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -10, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.95 }}
          className="absolute right-0 top-full mt-2 w-[400px] bg-lattice-surface border border-lattice-border rounded-xl shadow-2xl shadow-black/30 z-50 overflow-hidden"
        >
          {content}
        </motion.div>
      </AnimatePresence>
    );
  }

  // Panel mode
  return (
    <div
      className={cn(
        'bg-lattice-surface border border-lattice-border rounded-xl overflow-hidden',
        className
      )}
    >
      {content}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedNotificationCenter = withErrorBoundary(NotificationCenter);
export { _WrappedNotificationCenter as NotificationCenter };
export default _WrappedNotificationCenter;
