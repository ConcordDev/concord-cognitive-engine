'use client';

/**
 * useChannelInboundToast — surfaces incoming `channel:inbound` socket
 * events (server/routes/channels.js's Telegram/Discord/email inbound-
 * webhook bridge, server/channels/{telegram,discord,email}.js) as a
 * transient toast.
 *
 * DET-C batch 10: this event previously had zero frontend consumers at
 * all — no channel-linking or inbox UI exists anywhere in
 * concord-frontend for the external bridge, so the broadcast (which was
 * also, at the time, an unscoped global emit rather than being scoped
 * to the recipient's own room) went into the void. This is the minimal,
 * real fix: the server now scopes the emit to the recipient's own
 * `user:<id>` room (see the realtimeEmit call sites in channels.js), and
 * this hook — the direct sibling of useSocialNotificationToast — turns
 * that into a real, visible "you got a message via X" toast. A full
 * channel-linking settings page / inbound-message inbox view remains a
 * separate, larger, and still-undone feature; this only closes the
 * broadcast-into-the-void gap.
 *
 * No fake data — fires only on the real socket event the webhook routes
 * actually emit once a message is genuinely routed through the chat
 * pipeline.
 *
 * Mount once at the app shell, alongside useSocialNotificationToast.
 * Returns nothing.
 */

import { useEffect } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { useUIStore } from '@/store/ui';

interface ChannelInboundPayload {
  channel?: 'telegram' | 'discord' | 'email' | string;
  userId?: string;
  actionType?: string;
}

const CHANNEL_LABEL: Record<string, string> = {
  telegram: 'Telegram',
  discord: 'Discord',
  email: 'email',
};

export function useChannelInboundToast() {
  const addToast = useUIStore((s) => s.addToast);

  useEffect(() => {
    const unsubscribe = subscribe<ChannelInboundPayload>('channel:inbound', (data) => {
      if (!data?.channel) return;
      const label = CHANNEL_LABEL[data.channel] || data.channel;
      const message = data.actionType
        ? `New message via ${label} (${data.actionType.replace(/_/g, ' ')})`
        : `New message via ${label}`;
      addToast({ type: 'info', message, duration: 5000 });
    });
    return unsubscribe;
  }, [addToast]);
}

export default useChannelInboundToast;
