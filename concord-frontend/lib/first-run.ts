'use client';

import { useEffect, useState } from 'react';

// First-run overlay coordinator.
//
// Four surfaces used to fire on the first frame at once — the SplashScreen, the
// CookieConsent notice, the OnboardingWizard ("Welcome to Concord"), and the
// FirstWin pill — burying the actual app (and the 3D world) under a stack of
// modals. This module is the lightweight glue that lets them SEQUENCE instead
// of pile up, reusing the localStorage flags each one already owns. No new
// store, no rewrite: a surface reads these helpers to decide whether it's its
// turn, and calls advanceFirstRun() when it's dismissed so the next surface
// re-evaluates (localStorage writes don't notify other components on their own).

export const FIRST_RUN_ADVANCE = 'concord:first-run-advance';

export const COOKIE_CONSENT_KEY = 'concord_cookie_consent';
export const ONBOARDING_DONE_KEY = 'concord-onboarding-completed';
export const FIRST_WIN_DISMISSED_KEY = 'concord_first_win_dismissed';
export const FIRST_REPLY_KEY = 'concord_first_reply_done';

/** Notify all first-run surfaces that a step was just completed/dismissed. */
export function advanceFirstRun(): void {
  try {
    window.dispatchEvent(new Event(FIRST_RUN_ADVANCE));
  } catch {
    /* SSR / no window */
  }
}

/**
 * Has the user answered the cookie notice yet? Defaults to TRUE when storage is
 * unreadable (SSR/private mode) so we never wedge onboarding behind a notice we
 * can't render — fail open toward letting the app proceed.
 */
export function cookieAnswered(): boolean {
  try {
    return Boolean(localStorage.getItem(COOKIE_CONSENT_KEY));
  } catch {
    return true;
  }
}

/** Local (fast-path) flag that onboarding was completed on this device. */
export function onboardingDoneLocally(): boolean {
  try {
    return Boolean(localStorage.getItem(ONBOARDING_DONE_KEY));
  } catch {
    return false;
  }
}

/**
 * Reactive: is the CookieConsent notice currently occupying the bottom-left
 * corner? CookieConsent's own visibility is exactly `!cookieAnswered()` (see
 * its `useEffect`), and it calls `advanceFirstRun()` the moment the user
 * answers — so a passive bottom-left overlay (e.g. SystemStatus) can use this
 * hook to know when to step out of the way instead of being fully covered by
 * the higher-precedence consent banner. No coupling to CookieConsent's
 * internal component state needed; both derive from the same localStorage key.
 */
export function useCookieConsentVisible(): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(!cookieAnswered());
    const onAdvance = () => setVisible(!cookieAnswered());
    window.addEventListener(FIRST_RUN_ADVANCE, onAdvance);
    return () => window.removeEventListener(FIRST_RUN_ADVANCE, onAdvance);
  }, []);

  return visible;
}

/**
 * Has the user completed a first chat reply on this device? The Chat
 * panel marks it the moment an assistant reply exists in the thread
 * (Product Chat review S9: first-run overlays must sequence — the
 * install banner stays out of the composer zone until after the first
 * reply, instead of competing with the first conversation).
 */
export function firstReplyDone(): boolean {
  try {
    return Boolean(localStorage.getItem(FIRST_REPLY_KEY));
  } catch {
    return false;
  }
}

export function markFirstReplyDone(): void {
  try {
    localStorage.setItem(FIRST_REPLY_KEY, '1');
  } catch { /* storage unavailable */ }
  advanceFirstRun();
}

export function useFirstReplyDone(): boolean {
  const [done, setDone] = useState(false);

  useEffect(() => {
    setDone(firstReplyDone());
    const onAdvance = () => setDone(firstReplyDone());
    window.addEventListener(FIRST_RUN_ADVANCE, onAdvance);
    return () => window.removeEventListener(FIRST_RUN_ADVANCE, onAdvance);
  }, []);

  return done;
}
