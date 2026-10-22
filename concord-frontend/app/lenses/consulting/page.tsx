'use client';

import { LensShell } from '@/components/lens/LensShell';
import { ConsultingWorkspace } from '@/components/consulting/ConsultingWorkspace';

export default function ConsultingLensPage() {

  return (
    <LensShell lensId="consulting" asMain={false}>
      <ConsultingWorkspace />
    </LensShell>
  );
}
