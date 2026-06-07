'use client';

import { useState, useEffect } from 'react';
import { COOKIE_CONSENT_KEY as CONSENT_KEY, advanceFirstRun } from '@/lib/first-run';

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const consent = localStorage.getItem(CONSENT_KEY);
      if (!consent) setVisible(true);
    } catch {
      // SSR or localStorage unavailable
    }
  }, []);

  const accept = () => {
    try { localStorage.setItem(CONSENT_KEY, 'accepted'); } catch {}
    setVisible(false);
    // The cookie notice sequences AHEAD of onboarding — tell the welcome wizard
    // it may open now (it waited for this answer instead of stacking on top).
    advanceFirstRun();
  };

  const reject = () => {
    try { localStorage.setItem(CONSENT_KEY, 'rejected'); } catch {}
    setVisible(false);
    advanceFirstRun();
  };

  if (!visible) return null;

  // Compact bottom-LEFT card (was a full-width centered z-200 bar that collided
  // with the bottom-right coachmark/First-Win cluster + sat above onboarding
  // modals). Lower z so modals layer above it.
  return (
    <div className="fixed bottom-4 left-4 z-[60] w-[22rem] max-w-[calc(100vw-2rem)] animate-in slide-in-from-bottom">
      <div className="rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur-lg p-4 shadow-2xl">
        <div className="flex flex-col gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white/80 font-medium">Cookie Notice</p>
            <p className="text-xs text-white/50 mt-1">
              Concord uses essential cookies for authentication and session management.
              We do not use tracking cookies or sell your data. See our{' '}
              <a href="/legal/privacy" className="text-neon-cyan/70 hover:text-neon-cyan underline">
                Privacy Policy
              </a>{' '}
              for details.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={reject}
              className="px-3 py-1.5 text-xs text-white/50 hover:text-white/80 border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
            >
              Reject
            </button>
            <button
              onClick={accept}
              className="px-4 py-1.5 text-xs font-medium text-black bg-neon-cyan rounded-lg hover:bg-neon-cyan/90 transition-colors"
            >
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
