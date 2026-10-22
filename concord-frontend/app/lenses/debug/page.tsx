'use client';

import { LensShell } from '@/components/lens/LensShell';
import { DebugWorkspace } from '@/components/debug/DebugWorkspace';
import { useLensNav } from '@/hooks/useLensNav';

export default function DebugLensPage() {
  useLensNav('debug');

  return (
    <LensShell lensId="debug" asMain={false}>
      <DebugWorkspace />
    </LensShell>
  );
}
