'use client';

import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { EmergencyWorkspace } from '@/components/emergency-services/EmergencyWorkspace';

export default function EmergencyServicesLensPage() {

  return (
    <LensShell lensId="emergency-services" asMain={false}>

      <DepthBadge lensId="emergency-services" size="sm" className="ml-2" />
      <EmergencyWorkspace />
    </LensShell>
  );
}
