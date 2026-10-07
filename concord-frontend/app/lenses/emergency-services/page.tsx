'use client';

import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { EmergencyWorkspace } from '@/components/emergency-services/EmergencyWorkspace';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

export default function EmergencyServicesLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  return (
    <LensShell lensId="emergency-services" asMain={false}>
      <FirstRunTour lensId="emergency-services" />
      <DepthBadge lensId="emergency-services" size="sm" className="ml-2" />
      <EmergencyWorkspace who={who} />
    </LensShell>
  );
}
