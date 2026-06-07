'use client';

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
