'use client';

import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { Download, X } from 'lucide-react';
import { Z_INDEX } from '@/lib/ui/z-index';
import { useUIStore } from '@/store/ui';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * PWA install prompt banner.
 *
 * Shows when the browser fires the `beforeinstallprompt` event,
 * indicating the app is installable. Dismissed if user declines
 * or has already installed. Dismissal is stored in localStorage.
 *
 * Hidden on `/lenses/studio` — the toast sits over the mixer and device
 * rack (same music-only hide as Topbar's health chip).
 *
 * While showing, the banner publishes its real viewport footprint to the
 * UI store (`installBannerFootprint`): the global Help launcher lifts
 * above it (at phone width the launcher used to sit exactly on this
 * banner's X close button) and AppShell's <main> reserves matching
 * bottom padding so page content + the footer scroll fully into view.
 * The footprint is cleared to 0 whenever the banner hides or unmounts.
 */
export function InstallPrompt() {
  const pathname = usePathname();
  const studioWorkspace = !!pathname && /^\/lenses\/studio(\/|$)/.test(pathname);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const bannerRef = useRef<HTMLDivElement | null>(null);
  const setInstallBannerFootprint = useUIStore((s) => s.setInstallBannerFootprint);
  const showing = !studioWorkspace && !!deferredPrompt && !dismissed;

  useEffect(() => {
    // Don't capture the one-shot beforeinstallprompt on Studio: preventDefault
    // would swallow it, then navigating away would never show the toast.
    if (studioWorkspace) return;

    const handler = (e: Event) => {
      e.preventDefault();
      if (localStorage.getItem('concord_pwa_dismissed')) return;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, [studioWorkspace]);

  // Publish the measured footprint whenever the banner shows, hides,
  // resizes, or unmounts. (jsdom reports a zero-height rect — treat that
  // as "no banner" so headless tests stay honest instead of reserving
  // padding for a phantom banner.)
  useLayoutEffect(() => {
    if (!showing) {
      setInstallBannerFootprint(0);
      return;
    }
    const el = bannerRef.current;
    const measure = () => {
      if (!el) { setInstallBannerFootprint(0); return; }
      const rect = el.getBoundingClientRect();
      if (rect.height <= 0) { setInstallBannerFootprint(0); return; }
      setInstallBannerFootprint(Math.max(0, window.innerHeight - rect.top));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      setInstallBannerFootprint(0);
    };
  }, [showing, setInstallBannerFootprint]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
    localStorage.setItem('concord_pwa_dismissed', '1');
    setDismissed(true);
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('concord_pwa_dismissed', '1');
    setDeferredPrompt(null);
  };

  if (!showing) return null;

  return (
    <div
      ref={bannerRef}
      role="banner"
      style={{ zIndex: Z_INDEX.INSTALL_PROMPT }}
      className="fixed left-1/2 -translate-x-1/2 flex items-center gap-4 rounded-xl border border-neon-cyan/30 bg-lattice-surface p-4 shadow-lg shadow-neon-cyan/10 max-w-md w-[calc(100%-2rem)] bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-4"
    >
      <div className="w-10 h-10 rounded-lg bg-neon-cyan/20 flex items-center justify-center flex-shrink-0">
        <Download className="w-5 h-5 text-neon-cyan" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">Install Concord</p>
        <p className="text-xs text-gray-400 truncate">Install Concord as an app</p>
      </div>
      <button
        onClick={handleInstall}
        className="px-4 py-2 bg-neon-cyan/20 border border-neon-cyan/50 rounded-lg text-neon-cyan text-sm font-medium hover:bg-neon-cyan/30 transition-colors flex-shrink-0"
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        className="p-1.5 text-gray-400 hover:text-gray-300 transition-colors flex-shrink-0"
        aria-label="Dismiss install prompt"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
