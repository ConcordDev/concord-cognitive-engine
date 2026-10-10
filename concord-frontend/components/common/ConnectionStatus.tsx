'use client';

/**
 * ConnectionStatus — Shows banner when backend is offline or serving stale data.
 *
 * PRIMARY signal (audit 2026-07-27): the realtime socket's confirmed
 * connection-loss lifecycle (lib/realtime/socket.ts onConnectionLost /
 * onReconnected — already grace-debounced 6s so a Wi-Fi flap doesn't flash
 * the banner). The previous /health-poll-only version was decorative in any
 * topology where a proxy answers /health itself — the old nginx config
 * literally did `location /health { return 200 "healthy" }`, so the banner
 * said "online" while the backend was dead. The socket signal cannot be
 * faked by an intermediary: it is the actual working channel to the backend.
 *
 * SECONDARY signal: a cheap /health poll, kept for the X-Concord-Stale
 * header and as a fallback detector on pages/topologies where the socket is
 * unavailable. (The canonical cloudflared ingress now routes /health
 * directly to the backend — see infra/cloudflare/cloudflared.yml.example.)
 *
 * History: was checking /api/brain/health, which live-probes all 5 Ollama
 * brains (up to ~8s) — a slow LLM brain got misreported as "Connection
 * lost." /health is a cheap in-memory liveness probe.
 */

import { useState, useEffect, useCallback } from 'react';
import { Z_INDEX } from '@/lib/ui/z-index';
import { useClientConfig } from '@/hooks/useClientConfig';
import { onConnectionLost, onReconnected } from '@/lib/realtime/socket';
import {
  clearServerBusy,
  getServerBusy,
  isServiceOverloadedPayload,
  noteServerBusy,
  onServerBusy,
  type ServerBusyDetail,
} from '@/lib/realtime/server-busy';
import { useSmartPolling } from '@/hooks/useSmartPolling';

const HEALTH_TIMEOUT_MS = 15_000;

function isStallTimeout(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name || '';
  const message = String((err as { message?: string }).message || '');
  return name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(message);
}

export function ConnectionStatus() {
  // Shell-diet: this mounts on every page for every user, so the cadence is
  // server-tunable without a rebuild via /api/config/client (see
  // hooks/useClientConfig.ts) instead of a hardcoded constant.
  const { poll } = useClientConfig();
  const [socketDown, setSocketDown] = useState(false);
  const [healthOk, setHealthOk] = useState(true);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState<ServerBusyDetail | null>(null);
  // OfflineFallback (components/pwa/OfflineFallback.tsx) renders its own
  // full-width banner at this exact same top strip whenever the BROWSER goes
  // offline. OfflineFallback is the more fundamental of the two and outranks
  // this one (see lib/ui/z-index.ts), so drop below its height while the
  // browser reports offline.
  const [browserOffline, setBrowserOffline] = useState(
    typeof navigator !== 'undefined' ? !navigator.onLine : false
  );

  useEffect(() => {
    const goOffline = () => setBrowserOffline(true);
    const goOnline = () => setBrowserOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  // Primary: confirmed socket loss / recovery. The grace period in
  // lib/realtime/socket.ts is long enough that a several-second stall
  // does not land here.
  useEffect(() => {
    const offLost = onConnectionLost(() => setSocketDown(true));
    const offBack = onReconnected(() => setSocketDown(false));
    return () => {
      offLost();
      offBack();
    };
  }, []);

  // 503 service_overloaded is "server busy", including when it arrives on
  // some other request (the API client notes it). /health itself is never
  // shed, so this subscription is what a lens-run 503 actually drives.
  useEffect(() => {
    setBusy(getServerBusy());
    return onServerBusy(setBusy);
  }, []);

  // Secondary: stale-data header + fallback liveness. Audit fix
  // (2026-07-27): this mounts on every page for every user — useSmartPolling
  // pauses it while the tab is hidden (a backgrounded tab was still pinging
  // /health forever) and jitters against other components sharing the same
  // server-tuned poll.connectionStatusMs.
  const check = useCallback(async () => {
    try {
      const res = await fetch('/health', {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (res.status === 503) {
        const body = await res.clone().json().catch(() => null);
        if (isServiceOverloadedPayload(body)) {
          const retryAfterS = body && typeof body === 'object' && typeof (body as { retryAfterS?: number }).retryAfterS === 'number'
            ? (body as { retryAfterS: number }).retryAfterS
            : undefined;
          noteServerBusy({
            retryAfterS,
            message: 'Server busy. Retrying…',
          });
          setHealthOk(true);
          setStale(false);
          return;
        }
      }
      if (res.ok) clearServerBusy();
      setHealthOk(res.ok);
      setStale(res.headers.get('X-Concord-Stale') === 'true');
    } catch (err) {
      // One stalled probe is not a disconnect. A hard network error is.
      if (isStallTimeout(err)) return;
      setHealthOk(false);
    }
  }, []);

  useSmartPolling(check, poll.connectionStatusMs);

  const online = !socketDown && healthOk;
  if (!busy && online && !stale) return null;

  const message = busy
    ? `Server busy. Retrying in ${busy.retryAfterS}s…`
    : online && stale
      ? 'Showing cached data. Reconnecting...'
      : 'Connection lost. Working offline with cached data.';

  return (
    <div
      style={{ zIndex: Z_INDEX.CONNECTION_BANNER }}
      className={`fixed left-0 right-0 bg-yellow-600/90 text-black text-center text-sm py-1 transition-[top] duration-300 ${
        browserOffline ? 'top-8' : 'top-0'
      }`}
      role="status"
    >
      {message}
    </div>
  );
}

export default ConnectionStatus;
