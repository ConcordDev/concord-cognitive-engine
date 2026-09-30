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
 *
 * This is the LAST signup step. It lands in /hub — NOT the World lens.
 * Character creation + entering Concordia is deferred to when the user
 * chooses to open the World lens (it has its own first-visit flow and
 * renders a default avatar until then); it is no longer forced on
 * every new account.
 */

import { ChooseYourUniverse } from '@/components/onboarding/ChooseYourUniverse';
import { useRouter } from 'next/navigation';

export default function OnboardingLocationPage() {
  const router = useRouter();

  return (
    <ChooseYourUniverse
      onComplete={() => router.push('/hub')}
      onSkip={() => router.push('/hub')}
    />
  );
}
