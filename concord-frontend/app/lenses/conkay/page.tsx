'use client';

/**
 * ConKay — the full engineering workspace (concept: docs/lens-northstar).
 * Chat's ConKay mode, the ⌘J overlay's "Open workspace" and every cross-lens
 * "Open in ConKay" land here, on the same per-workspace study state.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import { Bot, Play } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useGuest } from '@/lib/guest';
import { ConKayWorkspace } from '@/components/conkay/workspace/ConKayWorkspace';

export default function ConKayLensPage() {
  useLensNav('conkay');
  useLensIdentity('conkay');
  // GB-1536: signed-out visits render the lens itself in guest mode
  // (no more bounce to the demo) — with the no-login demo one click
  // away, prominently, for a visitor who wants to run a real study.
  const guest = useGuest();
  return (
    <LensShell lensId="conkay" asMain={false} disableAgentFab={true}>
      <div data-lens-theme="conkay" className="h-full min-h-0 flex flex-col">
        <header className="sr-only">
          <h1>
            <Bot className="inline w-5 h-5 mr-2" aria-hidden />
            ConKay
          </h1>
        </header>
        {guest && (
          <div className="flex flex-wrap items-center gap-3 border-b border-lattice-border bg-lattice-surface px-4 py-2.5">
            <p className="text-sm text-zinc-300">
              You&apos;re browsing ConKay as a guest — look around freely.
            </p>
            <Link
              href="/conkay/demo"
              className="inline-flex items-center gap-1.5 rounded-lg bg-neon-blue px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neon-blue/80"
            >
              <Play className="h-4 w-4" aria-hidden />
              Run the no-login demo
            </Link>
          </div>
        )}
        <Suspense fallback={null}>
          <ConKayWorkspace />
        </Suspense>
      </div>
    </LensShell>
  );
}
