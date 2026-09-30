'use client';

/**
 * Education — one LMS / Khan+Coursera learning desk.
 *
 * Single ModeTab union + category strip live in EducationSection (extracted
 * from the former welded page). This file is the thin LensShell wrapper.
 */

import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { EducationSection } from '@/components/education/EducationSection';

export default function EducationLensPage() {
  useLensNav('education');
  useLensIdentity('education');

  return (
    <LensShell lensId="education" asMain={false}>
      <FirstRunTour lensId="education" />
      <DepthBadge lensId="education" size="sm" className="ml-2" />
      <EducationSection />
    </LensShell>
  );
}
