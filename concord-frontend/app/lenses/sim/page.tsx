'use client';

import { LensShell } from '@/components/lens/LensShell';
import { SimConsole } from '@/components/sim/SimConsole';

/** Thin shell. AnyLogic-style console lives in components/sim/. */
export default function SimLensPage() {
  return (
    <LensShell lensId="sim" asMain={false}>
      <SimConsole />
    </LensShell>
  );
}
