'use client';

/**
 * ConnectionStatus — Shows banner when backend is offline or serving stale data.
 * Checks /api/brain/health every 15s and shows a top banner if offline.
 */

import { useState, useEffect } from 'react';
import { Z_INDEX } from '@/lib/ui/z-index';

export function ConnectionStatus() {
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
        const res = await fetch('/api/brain/health', {
          signal: AbortSignal.timeout(5000),
        });
        setOnline(res.ok);
        setStale(res.headers.get('X-Concord-Stale') === 'true');
      } catch {
        setOnline(false);
      }
    };

    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, []);

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
