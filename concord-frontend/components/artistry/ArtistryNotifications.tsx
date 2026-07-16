'use client';

/**
 * ArtistryNotifications — the in-lens notification feed panel.
 *
 * Closes docs/WAVE4_INVENTORY.md / docs/lens-specs/artistry-capability-map.md
 * item 14: "Notification feed (new follower, new comment, new appreciation)".
 * The backend side (`server/domains/artistry.js`) calls the platform-wide
 * notification substrate (`server/emergent/social-layer.js#createNotification`)
 * from `follow` / `commentAdd` / `appreciate`, which already produces a live
 * toast for free via `useSocialNotificationToast` (mounted once, globally, in
 * AppShell — no wiring needed here). This panel is the DURABLE, in-lens
 * "catch up on what you missed" half: a pull-based list against the new
 * `artistry.notifications-list` / `artistry.notifications-mark-read` macros,
 * cloned in shape from `components/household/MemberNotifications.tsx` (list +
 * unread badge + per-item mark-read + mark-all-read).
 *
 * Honest by construction: an empty feed says so plainly, a failed load shows
 * the real error (never a silently blank panel), and nothing here is
 * optimistic-without-reconciliation — every state reflects the last real
 * server response.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Bell, BellOff, Check, Heart, Loader2, MessageSquare, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ArtNotificationType = 'follow' | 'comment' | 'like';

export interface ArtNotification {
  id: string;
  type: ArtNotificationType;
  fromUserId: string | null;
  postId: string | null;
  content: string;
  read: boolean;
  createdAt: string;
}

interface NotifListPayload {
  notifications: ArtNotification[];
  count: number;
  unread: number;
}

const TYPE_ICON: Record<ArtNotificationType, typeof UserPlus> = {
  follow: UserPlus,
  comment: MessageSquare,
  like: Heart,
};
const TYPE_COLOR: Record<ArtNotificationType, string> = {
  follow: 'text-neon-cyan',
  comment: 'text-sky-400',
  like: 'text-neon-pink',
};

export function ArtistryNotifications() {
  const [notifs, setNotifs] = useState<ArtNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const refresh = useCallback(async (onlyUnread: boolean) => {
    setLoading(true);
    setError(null);
    const r = await lensRun<NotifListPayload>('artistry', 'notifications-list', { unreadOnly: onlyUnread, limit: 30 });
    if (r.data?.ok && r.data.result) {
      setNotifs(r.data.result.notifications || []);
      setUnread(r.data.result.unread ?? 0);
    } else {
      setError(r.data?.error || 'Could not load notifications.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(unreadOnly); }, [refresh, unreadOnly]);

  const markRead = useCallback(async (id: string) => {
    await lensRun('artistry', 'notifications-mark-read', { id });
    await refresh(unreadOnly);
  }, [refresh, unreadOnly]);

  const markAll = useCallback(async () => {
    await lensRun('artistry', 'notifications-mark-read', { all: true });
    await refresh(unreadOnly);
  }, [refresh, unreadOnly]);

  return (
    <div className="bg-white/5 border border-white/10 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Bell className="w-4 h-4 text-neon-pink" />
        <h3 className="text-sm font-semibold">Notifications</h3>
        {unread > 0 && (
          <span className="text-[10px] bg-neon-pink text-black rounded-full px-1.5 py-0.5 font-bold">{unread}</span>
        )}
        <label className="ml-auto flex items-center gap-1 text-[10px] text-gray-400">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
        {unread > 0 && (
          <button
            onClick={markAll}
            className="px-2 py-1 text-[10px] rounded-lg border border-white/10 text-gray-300 hover:bg-white/10 inline-flex items-center gap-1"
          >
            <BellOff className="w-3 h-3" /> Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6" aria-busy="true">
          <Loader2 className="w-4 h-4 animate-spin text-neon-pink" />
        </div>
      ) : error ? (
        <p className="text-xs text-red-400 py-2">{error}</p>
      ) : notifs.length === 0 ? (
        <p className="text-xs text-gray-400 italic py-2">
          No activity yet — new followers, comments, and appreciations on your projects will show up here.
        </p>
      ) : (
        <ul className="space-y-1.5 max-h-72 overflow-y-auto">
          {notifs.map((n) => {
            const Icon = TYPE_ICON[n.type] || Bell;
            return (
              <li
                key={n.id}
                className={cn(
                  'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
                  n.read ? 'border-white/5 bg-white/[0.02]' : 'border-neon-pink/30 bg-neon-pink/5',
                )}
              >
                <Icon className={cn('w-3.5 h-3.5 mt-0.5 shrink-0', TYPE_COLOR[n.type] || 'text-gray-400')} />
                <div className="min-w-0 flex-1">
                  <p className="text-gray-100 truncate">{n.content}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
                {!n.read && (
                  <button
                    onClick={() => markRead(n.id)}
                    aria-label="Mark read"
                    className="w-5 h-5 rounded-full bg-neon-pink/20 hover:bg-neon-pink/40 text-neon-pink flex items-center justify-center shrink-0"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default ArtistryNotifications;
