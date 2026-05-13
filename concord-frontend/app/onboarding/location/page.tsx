'use client';

/**
 * /onboarding/location — step 2 of signup.
 *
 * After the universe-seeding mode picker at /onboarding, the user
 * lands here to declare their region, country, and primary lens.
 * These drive federation-tier scoping (regional/national DTUs are
 * only visible to people in the same region/country) and the
 * initial lens the dashboard highlights.
 *
 * Users can skip this step — if they do, their content stays local
 * by default until they come back to Settings and declare later.
 */

import { ChooseYourUniverse } from '@/components/onboarding/ChooseYourUniverse';
import { useRouter } from 'next/navigation';

export default function OnboardingLocationPage() {
  const router = useRouter();

  return (
    <ChooseYourUniverse
      onComplete={() => router.push('/onboarding/character')}
      onSkip={() => router.push('/onboarding/character')}
    />
  );
}
