'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { WhiteboardStudio } from '@/components/whiteboard/WhiteboardStudio';

/**
 * Whiteboard lens per docs/lens-northstar/14: the canvas is the page.
 * Drawing, boards, templates, analyze/collab and export live in WhiteboardStudio.
 */
export default function WhiteboardLensPage() {
  useLensNav('whiteboard');
  useLensIdentity('whiteboard');
  const [workbenchOpen, setWorkbenchOpen] = useState(false);

  useLensCommand(
    [
      { id: 'whiteboard-help', keys: '?', description: 'Lens help', category: 'navigation', action: () => { /* surfaced via tooltip */ } },
      { id: 'whiteboard-workbench', keys: 'w', description: 'Open Whiteboard Workbench', category: 'navigation', action: () => setWorkbenchOpen(true) },
    ],
    { lensId: 'whiteboard' },
  );

  return (
    <LensShell lensId="whiteboard" asMain={false}>
      <WhiteboardStudio
        workbenchOpen={workbenchOpen}
        onWorkbenchOpen={() => setWorkbenchOpen(true)}
        onWorkbenchClose={() => setWorkbenchOpen(false)}
      />
    </LensShell>
  );
}
