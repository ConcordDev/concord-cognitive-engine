'use client';

import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { DefenseWorkspace } from '@/components/defense/DefenseWorkspace';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { LensShell } from '@/components/lens/LensShell';
import { useAuth } from '@/hooks/useAuth';

export default function DefenseLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  return (
    <LensShell lensId="defense" asMain={false}>
      <FirstRunTour lensId="defense" />
      <DepthBadge lensId="defense" size="sm" className="ml-2" />
      <DefenseWorkspace who={who} />
    </LensShell>
  );
}
