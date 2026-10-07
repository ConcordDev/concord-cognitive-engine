'use client';

import { LensShell } from '@/components/lens/LensShell';
import { ConsultingWorkspace } from '@/components/consulting/ConsultingWorkspace';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

export default function ConsultingLensPage() {
  const { user } = useAuth();

  return (
    <LensShell lensId="consulting" asMain={false}>
      <ConsultingWorkspace who={titleCaseDisplayName(user?.username)} />
    </LensShell>
  );
}
