'use client';

import { LensShell } from '@/components/lens/LensShell';
import { HouseholdHome } from '@/components/household/HouseholdHome';

/** Thin shell. Homey/Apple Home lives in components/household/. */
export default function HouseholdLensPage() {
  return (
    <LensShell lensId="household" asMain={false}>
      <HouseholdHome />
    </LensShell>
  );
}
