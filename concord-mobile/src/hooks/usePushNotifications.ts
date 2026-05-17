// concord-mobile/src/hooks/usePushNotifications.ts
//
// Phase 12 — Expo push notifications.
//
// Closes the "push registers but nothing arrives on mobile" gap.
//
// Flow on mount (post-auth):
//   1. Request notification permission via expo-notifications.
//   2. If granted, fetch the Expo push token (projectId-aware).
//   3. POST it to /api/push/register on the Concord server as
//      { token, platform: 'expo', deviceLabel }.
//   4. Subscribe to inbound notification events (foreground + tap).
//   5. On unmount: unregister token via /api/push/unregister so it
//      doesn't keep collecting pushes for a logged-out user.
//
// Honest semantics:
//   - When permission is denied, returns `{ status: 'denied' }` and
//     never posts anywhere. No retry-spam.
//   - When expo-notifications isn't installed (typecheck or fresh
//     clone before `npm install`), `require()` throws — we catch it
//     and return `{ status: 'unavailable' }` so the calling component
//     can still mount.

import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export type PushStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable' | 'error';

export interface PushInfo {
  status: PushStatus;
  token: string | null;
  error: string | null;
}

export interface UsePushNotificationsOptions {
  /** Endpoint to POST { token, platform, deviceLabel }. */
  registerEndpoint: string;
  /** Endpoint to POST { token } on unmount / logout. */
  unregisterEndpoint?: string;
  /** Auth token getter for the bearer header. */
  getAuthToken?: () => string | null | undefined;
  /** Called when a notification is received in the foreground. */
  onForeground?: (notification: unknown) => void;
  /** Called when the user taps a notification (foreground or background). */
  onTap?: (response: unknown) => void;
  /** When false the hook is dormant — useful before auth is ready. */
  enabled?: boolean;
}

interface ExpoNotificationsAPI {
  requestPermissionsAsync: () => Promise<{ status: string; granted?: boolean }>;
  getPermissionsAsync: () => Promise<{ status: string; granted?: boolean }>;
  getExpoPushTokenAsync: (config?: { projectId?: string }) => Promise<{ data: string }>;
  setNotificationHandler: (handler: { handleNotification: () => Promise<{ shouldShowAlert: boolean; shouldPlaySound: boolean; shouldSetBadge: boolean }> }) => void;
  addNotificationReceivedListener: (cb: (n: unknown) => void) => { remove(): void };
  addNotificationResponseReceivedListener: (cb: (n: unknown) => void) => { remove(): void };
  setNotificationChannelAsync?: (id: string, channel: Record<string, unknown>) => Promise<unknown>;
  AndroidImportance?: { DEFAULT: number };
}

interface ExpoDeviceAPI {
  modelName?: string | null;
  isDevice?: boolean;
}

interface ExpoConstantsAPI {
  expoConfig?: { extra?: { eas?: { projectId?: string } } };
  easConfig?: { projectId?: string };
}

function tryRequire<T>(modulePath: string): T | null {
  try {
    // The cast intermediary avoids a typecheck error when the package
    // isn't yet installed in the workspace (fresh clone) — we treat
    // that as `unavailable` at runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(modulePath) as T;
    return mod || null;
  } catch {
    return null;
  }
}

export function usePushNotifications(opts: UsePushNotificationsOptions): PushInfo {
  const {
    registerEndpoint, unregisterEndpoint, getAuthToken,
    onForeground, onTap, enabled = true,
  } = opts;

  const [info, setInfo] = useState<PushInfo>({ status: 'idle', token: null, error: null });
  const tokenRef = useRef<string | null>(null);
  const listenersRef = useRef<Array<{ remove(): void }>>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const Notifications = tryRequire<ExpoNotificationsAPI>('expo-notifications');
    const Device = tryRequire<ExpoDeviceAPI>('expo-device');
    const Constants = tryRequire<ExpoConstantsAPI>('expo-constants');
    if (!Notifications) {
      setInfo({ status: 'unavailable', token: null, error: 'expo-notifications not installed' });
      return;
    }

    // Foreground notifications should still surface a banner instead of
    // being suppressed by Expo's default policy.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });

    (async () => {
      try {
        // Android needs at least one channel before tokens can be issued.
        if (Platform.OS === 'android' && Notifications.setNotificationChannelAsync) {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'Concord',
            importance: Notifications.AndroidImportance?.DEFAULT ?? 3,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#00d4ff',
          });
        }

        setInfo({ status: 'requesting', token: null, error: null });
        const existing = await Notifications.getPermissionsAsync();
        let granted = existing.granted ?? existing.status === 'granted';
        if (!granted) {
          const ask = await Notifications.requestPermissionsAsync();
          granted = ask.granted ?? ask.status === 'granted';
        }
        if (!granted) {
          if (!cancelled) setInfo({ status: 'denied', token: null, error: null });
          return;
        }

        // Real device only — simulators don't get tokens.
        if (Device && Device.isDevice === false) {
          if (!cancelled) setInfo({ status: 'unavailable', token: null, error: 'simulator_no_token' });
          return;
        }

        const projectId =
          Constants?.expoConfig?.extra?.eas?.projectId ||
          Constants?.easConfig?.projectId ||
          undefined;
        const tokenRes = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
        const token = tokenRes?.data;
        if (!token) {
          if (!cancelled) setInfo({ status: 'error', token: null, error: 'no_token_returned' });
          return;
        }
        tokenRef.current = token;

        // Register with the Concord server. Failures here are visible
        // (status='error') so an operator can see misconfigured backends.
        try {
          const headers: Record<string, string> = { 'content-type': 'application/json' };
          const auth = getAuthToken?.();
          if (auth) headers['authorization'] = `Bearer ${auth}`;
          const body = JSON.stringify({
            token,
            platform: 'expo',
            deviceLabel: Device?.modelName || Platform.OS,
          });
          const r = await fetch(registerEndpoint, { method: 'POST', headers, body });
          if (!r.ok) {
            if (!cancelled) setInfo({ status: 'error', token, error: `register_${r.status}` });
            return;
          }
        } catch (err) {
          if (!cancelled) setInfo({ status: 'error', token, error: String((err as Error)?.message || err) });
          return;
        }

        if (!cancelled) setInfo({ status: 'granted', token, error: null });

        // Subscribe to runtime listeners.
        const sub1 = Notifications.addNotificationReceivedListener((n) => {
          try { onForeground?.(n); } catch { /* keep stream resilient */ }
        });
        const sub2 = Notifications.addNotificationResponseReceivedListener((resp) => {
          try { onTap?.(resp); } catch { /* keep stream resilient */ }
        });
        listenersRef.current.push(sub1, sub2);
      } catch (err) {
        if (!cancelled) setInfo({ status: 'error', token: null, error: String((err as Error)?.message || err) });
      }
    })();

    return () => {
      cancelled = true;
      for (const l of listenersRef.current) { try { l.remove(); } catch { /* */ } }
      listenersRef.current = [];

      // Best-effort unregister on logout / unmount. Fire-and-forget so
      // a slow network doesn't block the unmount path.
      if (unregisterEndpoint && tokenRef.current) {
        const t = tokenRef.current;
        const auth = getAuthToken?.();
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        if (auth) headers['authorization'] = `Bearer ${auth}`;
        fetch(unregisterEndpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ token: t }),
        }).catch(() => { /* swallow */ });
      }
    };
  }, [enabled, registerEndpoint, unregisterEndpoint, getAuthToken, onForeground, onTap]);

  return info;
}

export default usePushNotifications;
