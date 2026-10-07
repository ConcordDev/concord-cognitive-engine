'use client';

import { LensShell } from '@/components/lens/LensShell';
import { DebugWorkspace } from '@/components/debug/DebugWorkspace';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

export default function DebugLensPage() {
  useLensNav('debug');
  const { user } = useAuth();

  return (
    <LensShell lensId="debug" asMain={false}>
      <DebugWorkspace who={titleCaseDisplayName(user?.username)} />
    </LensShell>
  );
}
