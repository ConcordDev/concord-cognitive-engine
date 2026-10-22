'use client';

import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ElectricalWorkspace } from '@/components/electrical/ElectricalWorkspace';

export default function ElectricalLensPage() {

  return (
    <LensShell lensId="electrical" asMain={false}>

      <DepthBadge lensId="electrical" size="sm" className="ml-2" />
      <ElectricalWorkspace />
    </LensShell>
  );
}
