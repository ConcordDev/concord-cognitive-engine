'use client';

/**
 * FmInboxPanel — thread-subscription inbox: unread notifications plus
 * the list of threads the caller is watching. Backed by the `forum`
 * notification-* and subscription-* macros.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Bell, BellRing, Check, CheckCheck, Lock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Notification {
  id: string; kind: string; topicId: string; topicTitle: string;
  message: string; read: boolean; createdAt: string;
}
interface Subscription { topicId: string; topicTitle: string; locked: boolean; createdAt: string }

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function FmInboxPanel({ onChange, onOpenTopic }: {
  onChange?: () => void;
  onOpenTopic?: (id: string) => void;
}) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [n, s] = await Promise.all([
      lensRun('forum', 'notification-list', {}),
      lensRun('forum', 'subscription-list', {}),
    ]);
    setNotifications((n.data?.result?.notifications as Notification[]) || []);
    setUnread((n.data?.result?.unread as number) || 0);
    setSubscriptions((s.data?.result?.subscriptions as Subscription[]) || []);
    setLoading(false);
    onChange?.();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const markOne = async (id: string) => {
    await lensRun('forum', 'notification-read', { id });
    await refresh();
  };
  const markAll = async () => {
    await lensRun('forum', 'notification-read', {});
    await refresh();
  };
  const unsubscribe = async (topicId: string) => {
    await lensRun('forum', 'thread-subscribe', { topicId });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      <section>
        <div className="flex items-center gap-2 mb-2">
          <Bell className="w-4 h-4 text-orange-400" />
          <h3 className="text-xs font-semibold text-zinc-200">Notifications</h3>
          {unread > 0 && (
            <span className="text-[10px] font-bold text-white bg-orange-600 rounded-full px-1.5 py-0.5">{unread}</span>
          )}
          <div className="flex-1" />
          {unread > 0 && (
            <button type="button" onClick={markAll}
              className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-orange-300">
              <CheckCheck className="w-3 h-3" /> Mark all read
            </button>
          )}
        </div>
        {notifications.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-4 text-center">No notifications yet. Subscribe to a thread to get reply alerts.</p>
        ) : (
          <ul className="space-y-1.5">
            {notifications.map((n) => (
              <li key={n.id}
                className={cn('flex items-start gap-2 border rounded-lg px-3 py-2',
                  n.read ? 'bg-zinc-900/40 border-zinc-800' : 'bg-orange-950/30 border-orange-900/50')}>
                <BellRing className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', n.read ? 'text-zinc-600' : 'text-orange-400')} />
                <button type="button" onClick={() => onOpenTopic?.(n.topicId)}
                  className="flex-1 text-left min-w-0">
                  <p className="text-[11px] text-zinc-200">{n.message}</p>
                  <p className="text-[10px] text-zinc-400">{timeAgo(n.createdAt)}</p>
                </button>
                {!n.read && (
                  <button type="button" onClick={() => markOne(n.id)}
                    className="text-zinc-400 hover:text-orange-300" aria-label="Mark read">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-xs font-semibold text-zinc-200 mb-2">Watched threads</h3>
        {subscriptions.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic py-4 text-center">Not subscribed to any threads.</p>
        ) : (
          <ul className="space-y-1.5">
            {subscriptions.map((s) => (
              <li key={s.topicId} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <button type="button" onClick={() => onOpenTopic?.(s.topicId)} className="flex-1 text-left min-w-0">
                  <p className="text-[11px] text-zinc-200 flex items-center gap-1 truncate">
                    {s.locked && <Lock className="w-3 h-3 text-zinc-400" />}
                    {s.topicTitle}
                  </p>
                  <p className="text-[10px] text-zinc-400">subscribed {timeAgo(s.createdAt)}</p>
                </button>
                <button type="button" onClick={() => unsubscribe(s.topicId)}
                  className="text-[10px] text-zinc-400 hover:text-rose-300">Unsubscribe</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
