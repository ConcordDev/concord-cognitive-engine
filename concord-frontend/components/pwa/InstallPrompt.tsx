'use client';

import { useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * PWA install prompt banner.
 *
 * Shows when the browser fires the `beforeinstallprompt` event,
 * indicating the app is installable. Dismissed if user declines
 * or has already installed.
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if user already dismissed
    if (localStorage.getItem('concord_pwa_dismissed')) {
      setDismissed(true);
      return;
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
    setDismissed(true);
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem('concord_pwa_dismissed', '1');
    setDeferredPrompt(null);
  };

  if (!deferredPrompt || dismissed) return null;

  return (
    <div
      role="banner"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-lattice-surface border border-neon-cyan/30 rounded-xl p-4 shadow-lg shadow-neon-cyan/10 flex items-center gap-4 max-w-md w-[calc(100%-2rem)]"
    >
      <div className="w-10 h-10 rounded-lg bg-neon-cyan/20 flex items-center justify-center flex-shrink-0">
        <Download className="w-5 h-5 text-neon-cyan" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">Install Concord</p>
        <p className="text-xs text-gray-400 truncate">Use Concord offline as a desktop app</p>
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
