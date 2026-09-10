'use client';

import { useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { WhiteboardStudio } from '@/components/whiteboard/WhiteboardStudio';

/**
 * Whiteboard lens — FigJam/Miro-shaped canvas + inspector.
 * All drawing, collab, analyze, session, and tooling lives in WhiteboardStudio.
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
      <FirstRunTour lensId="whiteboard" />
      <DepthBadge lensId="whiteboard" size="sm" className="ml-2" />
      <ShellPreview lensId="whiteboard" defaultOpen={false} />
      <WhiteboardStudio
        workbenchOpen={workbenchOpen}
        onWorkbenchOpen={() => setWorkbenchOpen(true)}
        onWorkbenchClose={() => setWorkbenchOpen(false)}
      />
      <CrossLensRecentsPanel lensId="whiteboard" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
