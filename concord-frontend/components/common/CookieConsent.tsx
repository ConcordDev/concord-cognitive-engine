'use client';

import { useState, useEffect } from 'react';

const CONSENT_KEY = 'concord_cookie_consent';
// Suppress the cookie banner until the user is past the initial
// onboarding wizard — otherwise the banner overlaps the modal and
// competes with the welcome flow. The wizard writes this key when
// dismissed or completed (see OnboardingWizard.tsx).
const ONBOARDING_DONE_KEY = 'concord_onboarding_complete';

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const consent = localStorage.getItem(CONSENT_KEY);
      if (consent) return;
      // Defer until onboarding is done. Re-check every 2s; cheap and
      // means we don't need a global event bus.
      const check = () => {
        const onboardingDone = localStorage.getItem(ONBOARDING_DONE_KEY) === 'true';
        if (onboardingDone) setVisible(true);
      };
      check();
      const id = setInterval(check, 2000);
      return () => clearInterval(id);
    } catch {
      // SSR or localStorage unavailable
    }
  }, []);

  const accept = () => {
    try { localStorage.setItem(CONSENT_KEY, 'accepted'); } catch {}
    setVisible(false);
  };

  const reject = () => {
    try { localStorage.setItem(CONSENT_KEY, 'rejected'); } catch {}
    setVisible(false);
  };

  if (!visible) return null;

  return (
    // Bottom-center toast. Bottom-right is the home of the
    // FirstWinWizard + toast queue; bottom-left is INSIDE the 256px
    // sidebar (verified via the collision audit). Center-bottom keeps
    // the banner clear of both. Defer rendering until onboarding is
    // dismissed so it doesn't overlap the centered welcome modal.
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] max-w-md animate-in slide-in-from-bottom-2">
      <div className="rounded-xl border border-white/10 bg-zinc-900/95 backdrop-blur-lg p-3.5 shadow-2xl">
        <div className="flex flex-col gap-2.5">
          <div>
            <p className="text-sm text-white/90 font-medium">Cookie Notice</p>
            <p className="text-xs text-white/60 mt-1 leading-relaxed">
              Concord uses essential cookies for auth + sessions. No tracking, no data sales.{' '}
              <a href="/legal/privacy" className="text-neon-cyan/80 hover:text-neon-cyan underline underline-offset-2">
                Privacy Policy
              </a>
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={reject}
              className="px-3 py-1.5 text-xs text-white/60 hover:text-white/90 border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
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
