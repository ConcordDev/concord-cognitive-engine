'use client';

/**
 * ConKay — the full engineering workspace (concept: docs/lens-northstar).
 * Chat's ConKay mode, the ⌘J overlay's "Open workspace" and every cross-lens
 * "Open in ConKay" land here, on the same per-workspace study state.
 */

import { Suspense } from 'react';
import { Bot } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ConKayWorkspace } from '@/components/conkay/workspace/ConKayWorkspace';

export default function ConKayLensPage() {
  useLensNav('conkay');
  useLensIdentity('conkay');
  return (
    <LensShell lensId="conkay" asMain={false} disableAgentFab={true}>
      <div data-lens-theme="conkay" className="h-full min-h-0 flex flex-col">
        <header className="sr-only">
          <h1>
            <Bot className="inline w-5 h-5 mr-2" aria-hidden />
            ConKay
          </h1>
        </header>
        <Suspense fallback={null}>
          <ConKayWorkspace />
        </Suspense>
      </div>
    </LensShell>
  );
}
