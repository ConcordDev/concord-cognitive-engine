// First-run overlay sequencing — the secondary surfaces (coachmark, First-Win
// auto-pop) gate on the welcome wizard being done, so they don't stack on it.
import { describe, it, expect, beforeEach } from 'vitest';
import { isOnboardingComplete, ONBOARDING_COMPLETE_KEY } from '@/lib/onboarding-state';

describe('onboarding sequencing gate', () => {
  beforeEach(() => { window.localStorage.clear(); });

  it('first run (flag absent) → NOT complete → secondary surfaces suppressed', () => {
    expect(isOnboardingComplete()).toBe(false);
  });

  it('after the welcome tour completes/dismisses (flag set) → complete → surfaces allowed', () => {
    window.localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    expect(isOnboardingComplete()).toBe(true);
  });

  it('uses the same key the OnboardingWizard writes on complete/dismiss', () => {
    // Contract: the wizard's completion key and this gate's key must match,
    // or the secondary surfaces would never un-gate.
    expect(ONBOARDING_COMPLETE_KEY).toBe('concord-onboarding-completed');
  });
});
