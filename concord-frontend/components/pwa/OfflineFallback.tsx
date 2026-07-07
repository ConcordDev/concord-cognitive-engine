'use client';

import { useState, useEffect } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { Z_INDEX } from '@/lib/ui/z-index';

/**
 * Offline indicator banner.
 *
 * Shows a thin bar at the top of the app when the browser goes offline.
 * Disappears when connectivity is restored.
 */
export function OfflineFallback() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);

    // Check initial state
    if (!navigator.onLine) setIsOffline(true);

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ zIndex: Z_INDEX.ACTION_REQUIRED }}
      className="fixed top-0 left-0 right-0 bg-sovereignty-warning/90 text-black text-xs font-medium py-1.5 px-4 flex items-center justify-center gap-2"
    >
      <WifiOff className="w-3.5 h-3.5" />
      <span>You are offline. Some features may be limited.</span>
      <button
        onClick={() => window.location.reload()}
        className="ml-2 px-2 py-0.5 rounded bg-black/20 hover:bg-black/30 transition-colors flex items-center gap-1"
      >
        <RefreshCw className="w-3 h-3" />
        Retry
      </button>
    </div>
  );
}
