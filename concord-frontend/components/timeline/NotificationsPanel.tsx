'use client';

// NotificationsPanel — reaction/comment/reply/tag/share alerts.
// Wires timeline.notifications-list and notifications-mark-read.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, ThumbsUp, MessageCircle, CornerDownRight, AtSign, Share2, Loader2, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import type { Notification } from './types';

interface NotifResult {
  notifications: Notification[];
  total: number;
  unread: number;
}

const ICONS: Record<Notification['type'], { icon: typeof Bell; color: string; verb: string }> = {
  reaction: { icon: ThumbsUp, color: 'text-blue-400', verb: 'reacted to your post' },
  comment: { icon: MessageCircle, color: 'text-green-400', verb: 'commented on your post' },
  reply: { icon: CornerDownRight, color: 'text-cyan-400', verb: 'replied to your comment' },
  tag: { icon: AtSign, color: 'text-purple-400', verb: 'tagged you in a post' },
  share: { icon: Share2, color: 'text-orange-400', verb: 'shared your post' },
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function NotificationsPanel() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['timeline-notifications'],
    queryFn: async () => {
      const r = await lensRun<NotifResult>('timeline', 'notifications-list', {});
      return r.data.result ?? { notifications: [], total: 0, unread: 0 };
    },
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => lensRun('timeline', 'notifications-mark-read', ids ? { ids } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['timeline-notifications'] }),
  });

  return (
    <div className="space-y-3">
      <div className="bg-[#242526] rounded-lg p-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold text-white">Notifications</h3>
          {(data?.unread ?? 0) > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-red-500 text-white text-[11px] font-bold">
              {data?.unread}
            </span>
          )}
        </div>
        {(data?.unread ?? 0) > 0 && (
          <button
            onClick={() => markRead.mutate(undefined)}
            disabled={markRead.isPending}
            className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1"
          >
            {markRead.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
            Mark all read
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="bg-[#242526] rounded-lg p-6 text-center text-sm text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mx-auto" />
        </div>
      ) : (data?.total ?? 0) === 0 ? (
        <div className="bg-[#242526] rounded-lg p-8 text-center text-gray-400">
          <Bell className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No notifications. Reactions, comments and tags will show up here.</p>
        </div>
      ) : (
        <div className="bg-[#242526] rounded-lg divide-y divide-gray-700/60">
          {(data?.notifications ?? []).map((n) => {
            const meta = ICONS[n.type];
            const Icon = meta.icon;
            return (
              <button
                key={n.id}
                onClick={() => !n.read && markRead.mutate([n.id])}
                className={cn(
                  'w-full flex items-start gap-3 p-3 text-left hover:bg-[#3a3b3c] transition-colors',
                  !n.read && 'bg-blue-500/5',
                )}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500" />
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#242526] flex items-center justify-center">
                    <Icon className={cn('w-3 h-3', meta.color)} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200">
                    <span className="font-semibold text-white">{n.actorId}</span> {meta.verb}
                  </p>
                  {n.preview && <p className="text-xs text-gray-400 truncate">&ldquo;{n.preview}&rdquo;</p>}
                  <p className="text-[11px] text-gray-400 mt-0.5">{timeAgo(n.at)}</p>
                </div>
                {!n.read && <span className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0 mt-1" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
