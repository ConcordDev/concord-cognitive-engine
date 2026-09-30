'use client';

/**
 * useOnboarding — state hook for the platform-tour welcome wizard.
 *
 * Split out of OnboardingWizard.tsx (shell-diet pass) so callers that only
 * need the open/close STATE (e.g. AppShell, which must decide whether to
 * even mount the wizard's UI) don't have to statically pull in the wizard's
 * heavy render tree (framer-motion AnimatePresence, the 7-step content
 * array, lucide icons). AppShell keeps this hook import static and lazily
 * `next/dynamic`-imports the `OnboardingWizard` component itself, only once
 * `isOpen` first goes true.
 */

import { useState, useEffect } from 'react';
import { FIRST_RUN_ADVANCE, cookieAnswered, onboardingDoneLocally } from '@/lib/first-run';

export function useOnboarding() {
  const [isOpen, setIsOpen] = useState(false);
  const [hasCompleted, setHasCompleted] = useState(false);

  // Phase 17 polish-to-ten: server-confirmed wizard completion.
  // We do NOT optimistically open the modal — that caused it to FLASH on every
  // load for already-completed users (it popped open, then the async server
  // check closed it) and to pile on top of the cookie notice for new users.
  // Instead: a present local flag means done; otherwise we confirm with the
  // server, and only open for a genuinely-new user AND only once the cookie
  // notice has been answered (it sequences ahead of us). When the user answers
  // the cookie notice, CookieConsent fires `concord:first-run-advance` and we
  // re-evaluate.
  useEffect(() => {
    let cancelled = false;

    if (onboardingDoneLocally()) {
      setHasCompleted(true);
      return;
    }

    const path = typeof window !== 'undefined' ? window.location.pathname : '';
    const guestPublic =
      path === '/' ||
      path === '/explore' ||
      path.startsWith('/explore/') ||
      path === '/login' ||
      path === '/register' ||
      path === '/signup' ||
      path.startsWith('/legal/');
    if (guestPublic) {
      return;
    }

    const openIfNewAndCookieAnswered = () => {
      if (cancelled) return;
      if (!onboardingDoneLocally() && cookieAnswered()) setIsOpen(true);
    };

    (async () => {
      let serverCompleted = false;
      try {
        const res = await fetch('/api/onboarding/wizard-status', { credentials: 'same-origin' });
        if (res.ok) {
          const json = await res.json();
          serverCompleted = Boolean(json?.completed);
        }
      } catch { /* offline / unauthenticated — treat as not-completed (new user) */ }
      if (cancelled) return;
      if (serverCompleted) {
        try { localStorage.setItem('concord-onboarding-completed', 'true'); } catch { /* private mode */ }
        setHasCompleted(true);
        setIsOpen(false);
        return;
      }
      // Genuinely new (or offline-new): open once the cookie notice is answered.
      openIfNewAndCookieAnswered();
    })();

    window.addEventListener(FIRST_RUN_ADVANCE, openIfNewAndCookieAnswered);
    return () => {
      cancelled = true;
      window.removeEventListener(FIRST_RUN_ADVANCE, openIfNewAndCookieAnswered);
    };
  }, []);

  const complete = () => {
    localStorage.setItem('concord-onboarding-completed', 'true');
    setHasCompleted(true);
    setIsOpen(false);
    // Best-effort server sync — survives logout/login/cache-clear.
    fetch('/api/onboarding/wizard-complete', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => { /* server sync is best-effort */ });
  };

  // Dismiss/skip MUST persist. Previously close() only flipped isOpen=false, so
  // the welcome reopened on the next route change / first-run-advance and
  // "bled through" on every surface. Skipping the tour now sticks (the user can
  // replay it via reset()).
  const dismiss = () => {
    try { localStorage.setItem('concord-onboarding-completed', 'true'); } catch { /* private mode */ }
    setHasCompleted(true);
    setIsOpen(false);
    fetch('/api/onboarding/wizard-complete', {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(() => { /* server sync is best-effort */ });
  };

  const reset = () => {
    localStorage.removeItem('concord-onboarding-completed');
    setHasCompleted(false);
    setIsOpen(true);
  };

  return {
    isOpen,
    hasCompleted,
    open: () => setIsOpen(true),
    close: dismiss,
    complete,
    reset
  };
}
