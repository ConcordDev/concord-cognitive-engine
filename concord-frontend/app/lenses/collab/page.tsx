'use client';

import { LensShell } from '@/components/lens/LensShell';
import { CollabHub } from '@/components/collab/CollabHub';

/** Thin shell. Figma/Notion-style collab hub lives in components/collab/. */
export default function CollabLensPage() {
  return (
    <LensShell lensId="collab" asMain={false}>
      <CollabHub />
    </LensShell>
  );
}
