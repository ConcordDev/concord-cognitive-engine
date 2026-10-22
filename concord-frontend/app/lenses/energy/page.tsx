'use client';

import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { EnergyWorkspace } from '@/components/energy/EnergyWorkspace';

export default function EnergyLensPage() {

  return (
    <LensShell lensId="energy" asMain={false}>

      <DepthBadge lensId="energy" size="sm" className="ml-2" />
      <EnergyWorkspace />
    </LensShell>
  );
}
