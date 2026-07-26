'use client';

/**
 * OfflineBanner — the single shell-wide "you are offline" banner.
 *
 * 2026-07-23 maturity-audit fix (item #10): offline handling existed
 * (`components/pwa/OfflineFallback.tsx`, `components/common/OfflineIndicator.tsx`,
 * `lib/offline/db.ts`) but was scattered with no single shell-wide
 * convention. This component IS that convention: it's mounted exactly
 * once, in `components/shell/AppShell.tsx`, in place of the previous
 * `<OfflineFallback />` mount (see AppShell's diff — a one-line swap, not
 * an additional banner stacked on top of it; running both would have
 * shown two near-identical "you're offline" banners at once).
 *
 * Detection is NOT reimplemented here — it reuses
 * `useOnlineStatus()` from `components/common/OfflineIndicator.tsx` (the
 * same `navigator.onLine` + `online`/`offline` window-event hook that file
 * already exported and already has test coverage for), so there is exactly
 * one piece of code in the app that decides "is the browser online."
 *
 * Honest-by-construction: this reflects REAL `navigator.onLine` /
 * `online`/`offline` event state — never a simulated or forced offline
 * look. It renders nothing at all while online, and disappears the instant
 * the `online` event fires — no fake "reconnecting…" transition state.
 *
 * `components/pwa/OfflineFallback.tsx` and `components/common/OfflineIndicator.tsx`
 * are left in place, unmodified — both are still independently exported
 * (and still independently tested) for any caller that wants their fuller
 * feature set (OfflineIndicator's expandable pending-changes/sync-status
 * popover; OfflineFallback as a standalone drop-in for a page that isn't
 * routed through AppShell). This component is deliberately the thin,
 * shell-chrome-only slice of that behavior.
 */

import { WifiOff, RefreshCw } from 'lucide-react';
import { Z_INDEX } from '@/lib/ui/z-index';
import { useOnlineStatus } from '@/components/common/OfflineIndicator';

export function OfflineBanner() {
  const { isOnline } = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{ zIndex: Z_INDEX.ACTION_REQUIRED }}
      className="fixed top-0 left-0 right-0 bg-sovereignty-warning/90 text-black text-xs font-medium py-1.5 px-4 flex items-center justify-center gap-2"
    >
      <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
      <span>You are offline. Some features may be limited.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="ml-2 px-2 py-0.5 rounded bg-black/20 hover:bg-black/30 transition-colors flex items-center gap-1"
      >
        <RefreshCw className="w-3 h-3" aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}

export default OfflineBanner;
