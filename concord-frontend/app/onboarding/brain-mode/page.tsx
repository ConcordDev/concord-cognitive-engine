'use client';

/**
 * /onboarding/brain-mode — step 0 of signup, runs BEFORE the
 * universe-seeding mode picker at /onboarding.
 *
 * This is the Private Mode / High Power Mode choice — see
 * components/onboarding/ChooseYourBrain.tsx for the full rationale and
 * the approved disclosure copy. There's no "skip" here the way the
 * location step allows: every account needs a value in users.brain_mode,
 * and it already defaults to 'private' at the DB level, so continuing
 * with the pre-selected Private card IS the skip path — there's no
 * separate no-op action needed.
 */

import { ChooseYourBrain } from '@/components/onboarding/ChooseYourBrain';
import { useRouter } from 'next/navigation';

export default function OnboardingBrainModePage() {
  const router = useRouter();

  return (
    <ChooseYourBrain
      onComplete={() => router.push('/onboarding')}
    />
  );
}
