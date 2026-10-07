'use client';

import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { EnergyWorkspace } from '@/components/energy/EnergyWorkspace';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

export default function EnergyLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  return (
    <LensShell lensId="energy" asMain={false}>
      <FirstRunTour lensId="energy" />
      <DepthBadge lensId="energy" size="sm" className="ml-2" />
      <EnergyWorkspace who={who} />
    </LensShell>
  );
}
