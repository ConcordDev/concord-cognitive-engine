'use client';

/**
 * ConnectionStatus — Shows banner when backend is offline or serving stale data.
 * Checks /health every `poll.connectionStatusMs` (default 20s, server-tunable
 * via /api/config/client — see hooks/useClientConfig.ts) and shows a top
 * banner if offline.
 *
 * Was checking /api/brain/health, which is the wrong signal: that endpoint's
 * whole job is live-probing all 5 Ollama brain URLs (up to 8s each, capped by
 * Promise.all so worst case ~8s) — its own code comment already documents
 * this exact failure mode biting a DIFFERENT pair of callers ("concurrent
 * callers... filling the request-timeout window and triggering ECONNRESET").
 * Every page, for every user, polling that same expensive endpoint every 20s
 * with only a 5s client-side abort raced a legitimate multi-brain probe and
 * lost often — a slow/unreachable LLM brain (an expected, handled-elsewhere
 * degraded state; see CONCORD_DISABLE_BRAINS) got misreported as "Connection
 * lost. Working offline," which is only true of the app server itself. /health
 * is a cheap in-memory liveness probe (no external round-trips; ~a few ms
 * even under load) — the correct thing to gate "is my backend reachable" on.
 */

import { useState, useEffect } from 'react';
import { Z_INDEX } from '@/lib/ui/z-index';
import { useClientConfig } from '@/hooks/useClientConfig';

export function ConnectionStatus() {
  // Shell-diet: this mounts on every page for every user, so the cadence is
  // server-tunable without a rebuild via /api/config/client (see
  // hooks/useClientConfig.ts) instead of a hardcoded constant. Default
  // widened from the prior hardcoded 15000 to 20000 — still well inside a
  // "feels live" outage-detection window; see the default's own comment.
  const { poll } = useClientConfig();
  const [online, setOnline] = useState(true);
  const [stale, setStale] = useState(false);
  // OfflineFallback (components/pwa/OfflineFallback.tsx) renders its own
  // full-width banner at this exact same top strip whenever the BROWSER goes
  // offline — and a browser-level outage will almost always also fail the
  // `/api/brain/health` check below, so both banners can be visible at once.
  // OfflineFallback is the more fundamental of the two (nothing works if the
  // browser itself is offline) and outranks this one (see lib/ui/z-index.ts),
  // so rather than let this banner sit underneath it unseen, drop down below
  // OfflineFallback's height for as long as the browser reports offline.
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

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/health', {
          signal: AbortSignal.timeout(5000),
        });
        setOnline(res.ok);
        setStale(res.headers.get('X-Concord-Stale') === 'true');
      } catch {
        setOnline(false);
      }
    };

    check();
    const interval = setInterval(check, poll.connectionStatusMs);
    return () => clearInterval(interval);
  }, [poll.connectionStatusMs]);

  if (online && !stale) return null;

  return (
    <div
      style={{ zIndex: Z_INDEX.CONNECTION_BANNER }}
      className={`fixed left-0 right-0 bg-yellow-600/90 text-black text-center text-sm py-1 transition-[top] duration-300 ${
        browserOffline ? 'top-8' : 'top-0'
      }`}
    >
      {stale
        ? 'Showing cached data. Reconnecting...'
        : 'Connection lost. Working offline with cached data.'}
    </div>
  );
}

export default ConnectionStatus;
