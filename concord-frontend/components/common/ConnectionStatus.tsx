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

import { useState, useEffect } from 'react';
import { Z_INDEX } from '@/lib/ui/z-index';
import { useClientConfig } from '@/hooks/useClientConfig';
import { onConnectionLost, onReconnected } from '@/lib/realtime/socket';

export function ConnectionStatus() {
  // Shell-diet: this mounts on every page for every user, so the cadence is
  // server-tunable without a rebuild via /api/config/client (see
  // hooks/useClientConfig.ts) instead of a hardcoded constant.
  const { poll } = useClientConfig();
  const [socketDown, setSocketDown] = useState(false);
  const [healthOk, setHealthOk] = useState(true);
  const [stale, setStale] = useState(false);
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

  // Primary: confirmed socket loss / recovery.
  useEffect(() => {
    const offLost = onConnectionLost(() => setSocketDown(true));
    const offBack = onReconnected(() => setSocketDown(false));
    return () => {
      offLost();
      offBack();
    };
  }, []);

  // Secondary: stale-data header + fallback liveness.
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/health', {
          signal: AbortSignal.timeout(5000),
        });
        setHealthOk(res.ok);
        setStale(res.headers.get('X-Concord-Stale') === 'true');
      } catch {
        setHealthOk(false);
      }
    };

    check();
    const interval = setInterval(check, poll.connectionStatusMs);
    return () => clearInterval(interval);
  }, [poll.connectionStatusMs]);

  const online = !socketDown && healthOk;
  if (online && !stale) return null;

  return (
    <div
      style={{ zIndex: Z_INDEX.CONNECTION_BANNER }}
      className={`fixed left-0 right-0 bg-yellow-600/90 text-black text-center text-sm py-1 transition-[top] duration-300 ${
        browserOffline ? 'top-8' : 'top-0'
      }`}
    >
      {online && stale
        ? 'Showing cached data. Reconnecting...'
        : 'Connection lost. Working offline with cached data.'}
    </div>
  );
}

export default ConnectionStatus;
