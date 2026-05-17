'use client';

/**
 * useWebPush — request notification permission, register the service
 * worker, subscribe via VAPID, POST the subscription to
 * /api/push/register.  Phase 11 (Item 13).
 *
 * Strictly opt-in: the hook does nothing until the user calls
 * `enable()`.  Returns the current state so a Settings page can show
 * "Enable push notifications" / "Disable" toggle.
 *
 * No fake "enabled" state — the hook reports the live
 * Notification.permission + PushManager subscription truthfully.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api/client';

export type WebPushStatus =
  | 'unsupported'
  | 'not_subscribed'
  | 'subscribed'
  | 'denied'
  | 'pending';

interface VapidResponse {
  ok: boolean;
  publicKey?: string | null;
  reason?: string;
  hint?: string;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export interface UseWebPushReturn {
  status: WebPushStatus;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useWebPush(): UseWebPushReturn {
  const [status, setStatus] = useState<WebPushStatus>('pending');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setStatus('denied');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.getRegistration('/service-worker.js');
      if (!reg) { setStatus('not_subscribed'); return; }
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? 'subscribed' : 'not_subscribed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('not_subscribed');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const enable = useCallback(async () => {
    setError(null);
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }
    try {
      // 1. Permission
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setStatus(perm === 'denied' ? 'denied' : 'not_subscribed');
        return;
      }
      // 2. VAPID key
      const r = await api.get<VapidResponse>('/api/push/vapid-public-key');
      const data = r?.data;
      if (!data?.ok || !data.publicKey) {
        setError(data?.hint || data?.reason || 'vapid_unconfigured');
        setStatus('not_subscribed');
        return;
      }
      // 3. Service worker
      const reg = await navigator.serviceWorker.register('/service-worker.js');
      await navigator.serviceWorker.ready;
      // 4. Subscribe
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.publicKey).buffer as ArrayBuffer,
      });
      // 5. POST to server
      await api.post('/api/push/register', {
        token: JSON.stringify(sub.toJSON()),
        platform: 'web',
        deviceLabel: navigator.userAgent.slice(0, 80),
      });
      setStatus('subscribed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus('not_subscribed');
    }
  }, []);

  const disable = useCallback(async () => {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/service-worker.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api.post('/api/push/unregister', { token: JSON.stringify(sub.toJSON()) });
        await sub.unsubscribe();
      }
      setStatus('not_subscribed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return { status, error, enable, disable, refresh };
}

export default useWebPush;
