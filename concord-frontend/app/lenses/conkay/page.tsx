'use client';

/**
 * /lenses/conkay — ConKay, the Workshop (components/conkay/workshop).
 * Chat's ConKay mode, the ⌘J overlay's "Open workspace" and every
 * cross-lens "Open in ConKay" land here. Signed-out visits get the same
 * workshop in guest mode (nothing stored).
 */

import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useGuest } from '@/lib/guest';
import { Workshop } from '@/components/conkay/workshop/Workshop';

export default function ConKayLensPage() {
  useLensNav('conkay');
  useLensIdentity('conkay');
  const guest = useGuest();
  return (
    <LensShell lensId="conkay" asMain={false} disableAgentFab={true}>
      <h1 className="sr-only">ConKay</h1>
      <Workshop guest={guest} />
    </LensShell>
  );
}
