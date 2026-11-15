'use client';

/**
 * /onboarding/brain-mode — the Private Mode / High Power Mode choice,
 * kept as a post-signup step by founder ruling (GB-1536 amendment,
 * 2026-11-14): a NEW account routes here once, carrying the return-to,
 * and after the choice the user hard-lands back exactly where they
 * were (default /hub), draft restored, nothing submitted for them.
 *
 * Login never routes here — existing accounts go straight to the
 * return-to. The step is a signup-flow step only, NOT a probe on
 * /api/auth/me (the needsOnboarding chain stays removed). If the
 * screen is abandoned mid-signup the account already exists and the
 * DB default 'private' governs; nothing re-prompts later. The same
 * choice lives in Settings (profile → Settings, beside
 * UniverseSettings) for anyone who wants to change it.
 *
 * See components/onboarding/ChooseYourBrain.tsx for the rationale and
 * the approved disclosure copy.
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChooseYourBrain } from '@/components/onboarding/ChooseYourBrain';
import { validateReturnTo } from '@/lib/return-to';

function BrainModeForm() {
  const searchParams = useSearchParams();
  const returnTo = validateReturnTo(searchParams.get('from'));
  return (
    <ChooseYourBrain
      onComplete={() => {
        window.location.href = returnTo;
      }}
    />
  );
}

export default function OnboardingBrainModePage() {
  return (
    <Suspense fallback={null}>
      <BrainModeForm />
    </Suspense>
  );
}
