'use client';

/**
 * useSocialNotificationToast — surfaces incoming social:notification
 * socket events as transient toasts.
 *
 * Phase 11 (Item 4): NotificationBell polls every 60s; this hook
 * pulls the same events down via Socket.io so the toast lands within
 * ~500ms of the action instead of waiting on the poll.
 *
 * No fake data — fires only on real socket events from the
 * substrate.  Dedupes against the local in-memory id set so the
 * same notification doesn't double-toast on the poll+socket race.
 *
 * Mount once at the app shell.  Returns nothing.
 */

import { useEffect, useRef } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { useUIStore } from '@/store/ui';

interface SocialNotificationPayload {
  notification?: {
    id?: string;
    type?: string;
    fromUserId?: string | null;
    postId?: string | null;
    content?: string;
    createdAt?: string;
  };
}

const TYPE_TO_TONE: Record<string, 'success' | 'info' | 'warning' | 'error'> = {
  like: 'success',
  reaction: 'success',
  comment: 'info',
  share: 'info',
  follow: 'info',
  mention: 'info',
  dm: 'info',
};

export function useSocialNotificationToast() {
  const addToast = useUIStore((s) => s.addToast);
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = subscribe<SocialNotificationPayload>(
      'social:notification',
      (data) => {
        const n = data?.notification;
        const id = n?.id;
        if (!id) return;
        if (seenRef.current.has(id)) return;
        seenRef.current.add(id);
        // Soft cap so the dedupe set doesn't grow without bound.
        if (seenRef.current.size > 500) {
          const arr = Array.from(seenRef.current);
          seenRef.current = new Set(arr.slice(-300));
        }

        const message = n?.content?.trim() || `New ${n?.type || 'notification'}`;
        addToast({
          type: TYPE_TO_TONE[n?.type || ''] || 'info',
          message,
          duration: 5000,
        });
      },
    );
    return unsubscribe;
  }, [addToast]);
}

export default useSocialNotificationToast;
