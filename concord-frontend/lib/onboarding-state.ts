// Shared first-run sequencing gate.
//
// On first load several onboarding surfaces could fire at once — the 7-step
// "Welcome to Concord" wizard, per-lens FirstRunTour coachmarks, and the
// FirstWinWizard auto-pop — which stacks into clutter. The wizard is the PRIMARY
// entry; the secondary surfaces gate on it being done, so they fire only AFTER
// the welcome tour is dismissed/completed (which sets ONBOARDING_COMPLETE_KEY).
//
// SSR / locked-down env → returns true (don't suppress on the server; the client
// effect re-checks). First run (key absent) → false, so secondary surfaces wait.

export const ONBOARDING_COMPLETE_KEY = 'concord-onboarding-completed';

export function isOnboardingComplete(): boolean {
  try {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(ONBOARDING_COMPLETE_KEY) === 'true';
  } catch {
    return true;
  }
}
