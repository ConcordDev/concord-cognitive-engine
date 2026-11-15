'use client';

/**
 * GuestBanner — GB-1536 §1/§3a.
 *
 * One slim, dismissible line under the topbar telling a guest the
 * terms: you're looking around, it's read-only, signup is free and
 * takes seconds. Copy follows VisitorFrame's visitor-note pattern;
 * VisitorFrame's own header is retired in the same change — this
 * banner (in the normal shell) is the one guest chrome now.
 */

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useGuestAuth } from '@/lib/guest';

const DISMISS_KEY = 'concord_guest_banner_dismissed';

export function GuestBanner() {
  const { openAuth } = useGuestAuth();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* dismissal is per-render then; harmless */
    }
  };

  return (
    <div
      role="note"
      data-testid="guest-banner"
      className="flex items-center gap-3 border-b border-lattice-border bg-lattice-surface px-4 py-2 text-sm text-zinc-300"
    >
      <p className="min-w-0 flex-1">
        You&apos;re looking around as a guest — everything here is read-only.{' '}
        <span className="text-zinc-400">Sign up free to save, run or post.</span>
      </p>
      <button
        type="button"
        onClick={() => openAuth('signin')}
        className="shrink-0 text-zinc-300 underline-offset-2 transition-colors hover:text-white hover:underline"
      >
        Log in
      </button>
      <button
        type="button"
        onClick={() => openAuth('signup')}
        className="shrink-0 rounded-lg bg-neon-blue px-3 py-1.5 font-medium text-white transition-colors hover:bg-neon-blue/80"
      >
        Sign up
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss guest banner"
        className="shrink-0 rounded-md p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
