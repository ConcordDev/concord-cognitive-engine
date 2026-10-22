'use client';

import { DefenseWorkspace } from '@/components/defense/DefenseWorkspace';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensShell } from '@/components/lens/LensShell';

export default function DefenseLensPage() {

  return (
    <LensShell lensId="defense" asMain={false}>

      <DepthBadge lensId="defense" size="sm" className="ml-2" />
      <DefenseWorkspace />
    </LensShell>
  );
}
