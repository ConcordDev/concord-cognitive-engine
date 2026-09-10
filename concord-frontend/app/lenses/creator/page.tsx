'use client';

// Creator lens — one YouTube-Studio / Patreon-shaped app.
// Left rail is the only view-state machine. Every former inline tab and
// the hidden "Creator Studio" accordion now live as panels under
// components/creator/. Data is react-query via CreatorProvider.

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import KnowledgeEntrepreneurBadge from '@/components/creator/KnowledgeEntrepreneurBadge';
import { CreatorNav, CREATOR_COMMANDS } from '@/components/creator/CreatorNav';
import { CreatorProvider, useCreator } from '@/components/creator/CreatorProvider';
import { CreatorWorkPane } from '@/components/creator/CreatorWorkPane';
import type { CreatorView } from '@/components/creator/types';
import { ds } from '@/lib/design-system';

function CreatorChrome() {
  const { view, setView, me, refreshAll } = useCreator();
  useLensIdentity('creator');
  useLensCommand(
    CREATOR_COMMANDS.map((c) => ({
      id: c.id,
      keys: c.keys,
      description: c.description,
      category: 'navigation' as const,
      action: () => setView(c.view),
    })),
    { lensId: 'creator' },
  );

  return (
    <>
      <FirstRunTour lensId="creator" />
      <header className="px-4 pt-4 pb-3 flex items-start justify-between gap-3 flex-wrap border-b border-lattice-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-amber-200">Creator Studio</h1>
            <DepthBadge lensId="creator" size="sm" />
          </div>
          <p className="text-sm text-white/45 mt-0.5">
            Pipeline, listings, audience, and the royalty cascade — one desk.
          </p>
          {me?.userId && <KnowledgeEntrepreneurBadge userId={me.userId} />}
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className={ds.btnGhost + ' text-xs'}
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </header>
      <div className="flex flex-col lg:flex-row gap-4 p-4">
        <CreatorNav view={view} onSelect={setView} />
        <CreatorWorkPane />
      </div>
      <div className="px-4 pb-8">
        <CrossLensRecentsPanel lensId="creator" sinceDays={7} limit={6} hideWhenEmpty />
      </div>
      <LensAgentFab
        lensId="creator"
        lensPrompt="You're inside Concord's Creator Studio — royalty cascade, listings, pipeline, audience. Prefer expert_mode for growth research, run_lens_action for listing/profile updates, create_dtu to save analysis."
      />
    </>
  );
}

export default function CreatorDashboardPage() {
  const [view, setView] = useState<CreatorView>('home');
  return (
    <LensShell lensId="creator" asMain={false} disableAgentFab={true}>
      <CreatorProvider view={view} setView={setView}>
        <CreatorChrome />
      </CreatorProvider>
    </LensShell>
  );
}
