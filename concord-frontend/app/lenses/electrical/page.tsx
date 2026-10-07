'use client';

import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ElectricalWorkspace } from '@/components/electrical/ElectricalWorkspace';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

export default function ElectricalLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  return (
    <LensShell lensId="electrical" asMain={false}>
      <FirstRunTour lensId="electrical" />
      <DepthBadge lensId="electrical" size="sm" className="ml-2" />
      <ElectricalWorkspace who={who} />
    </LensShell>
  );
}
